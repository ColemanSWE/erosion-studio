import { net, protocol, type CustomScheme } from "electron";
import path from "path";
import { pathToFileURL } from "url";

/**
 * `app://bundle/<path>` serves the built renderer (the `dist/` folder).
 *
 * Loading the UI from a privileged standard scheme instead of `file://` gives
 * the page a real origin, so `'self'` in the CSP means "files shipped with the
 * app", and `fetch()` works for bundled assets (MediaPipe's wasm and model;
 * Chromium's fetch refuses `file://`).
 */
export const APP_SCHEME = "app";
export const APP_ORIGIN = `${APP_SCHEME}://bundle`;

export const appScheme: CustomScheme = {
  scheme: APP_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
};

export function handleAppProtocol(rootDir: string): void {
  const root = path.resolve(rootDir);
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url);
    if (url.host !== "bundle") return new Response("Not found", { status: 404 });

    let relative: string;
    try {
      relative = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    const filePath = path.resolve(root, `.${relative === "/" ? "/index.html" : relative}`);
    if (!filePath.startsWith(root + path.sep)) return new Response("Forbidden", { status: 403 });

    return net.fetch(pathToFileURL(filePath).toString());
  });
}
