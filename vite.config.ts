import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";
import { build as esbuild } from "esbuild";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Plugin } from "vite";

/**
 * MediaPipe's wasm runtime ships with the app instead of loading from a CDN.
 * Served at /mediapipe/ in dev and emitted to dist/mediapipe/ on build; the
 * face model lives in public/mediapipe/. Only the SIMD build is copied
 * (Electron's Chromium always supports wasm SIMD).
 */
function mediapipeAssets(): Plugin {
  const dir = fileURLToPath(new URL("node_modules/@mediapipe/tasks-vision/wasm", import.meta.url));
  const files = ["vision_wasm_internal.js", "vision_wasm_internal.wasm"];
  const type = (f: string) => (f.endsWith(".wasm") ? "application/wasm" : "text/javascript");
  return {
    name: "mediapipe-assets",
    configureServer(server) {
      server.middlewares.use("/mediapipe", (req, res, next) => {
        const name = (req.url ?? "").replace(/^\//, "").split("?")[0];
        if (!files.includes(name)) return next();
        res.setHeader("Content-Type", type(name));
        fs.createReadStream(path.join(dir, name)).pipe(res);
      });
    },
    generateBundle() {
      for (const f of files) {
        this.emitFile({ type: "asset", fileName: `mediapipe/${f}`, source: fs.readFileSync(path.join(dir, f)) });
      }
    },
  };
}

/**
 * Content Security Policy for the renderer. Scripts and wasm only come from
 * the app itself; local media arrives over media://; Google Fonts are the only
 * remote resource (styles and font files, no scripts). Dev adds what Vite's
 * HMR client and React Refresh preamble need.
 */
function contentSecurityPolicy(): Plugin {
  let dev = false;
  return {
    name: "content-security-policy",
    configResolved(config) {
      dev = config.command === "serve";
    },
    transformIndexHtml() {
      const directives = [
        "default-src 'self'",
        `script-src 'self' 'wasm-unsafe-eval'${dev ? " 'unsafe-inline'" : ""}`,
        "worker-src 'self' blob:",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: blob: media:",
        "media-src 'self' blob: media:",
        `connect-src 'self' data: blob: media:${dev ? " ws: http://localhost:*" : ""}`,
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ];
      return [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: directives.join("; ") },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    mediapipeAssets(),
    contentSecurityPolicy(),
    electron([
      {
        entry: "electron/main.ts",
        vite: {
          build: {
            outDir: "dist-electron",
          },
        },
      },
      {
        // vite-plugin-electron with "type":"module" always emits ESM for electron
        // externals regardless of rollupOptions.output.format, which crashes the
        // Electron preload loader (CJS require() only). We bypass its build for
        // the preload entirely and use esbuild directly to produce preload.cjs.
        entry: "electron/preload.ts",
        async onstart(options) {
          fs.mkdirSync("dist-electron", { recursive: true });
          await esbuild({
            entryPoints: ["electron/preload.ts"],
            bundle: true,
            platform: "node",
            format: "cjs",
            external: ["electron"],
            outfile: path.join("dist-electron", "preload.cjs"),
          });
          options.reload();
        },
        vite: {
          build: {
            outDir: "dist-electron",
            plugins: [
              // Production build: closeBundle runs after the main Vite build.
              // Re-run esbuild here since onstart is only called in dev/watch mode.
              {
                name: "preload-esbuild-cjs",
                async closeBundle() {
                  fs.mkdirSync("dist-electron", { recursive: true });
                  await esbuild({
                    entryPoints: ["electron/preload.ts"],
                    bundle: true,
                    platform: "node",
                    format: "cjs",
                    external: ["electron"],
                    outfile: path.join("dist-electron", "preload.cjs"),
                  });
                },
              },
            ],
          },
        },
      },
    ]),
    renderer(),
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "electron/**/*.test.ts"],
  },
});
