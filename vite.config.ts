import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";
import { build as esbuild } from "esbuild";
import fs from "fs";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
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
    include: ["src/**/*.test.ts"],
  },
});
