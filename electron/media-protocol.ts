import { protocol, type CustomScheme } from "electron";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { mediaUrlToPath, parseByteRange } from "../src/lib/media-url";
import { MEDIA_MIME_TYPES } from "./path-policy";

/**
 * `media://local/<absolute path>` serves files from disk to the renderer.
 *
 * This replaces `webSecurity: false`: the renderer keeps the normal web
 * security model, and the only local files it can read are ones this handler
 * agrees to serve. It supports HTTP Range requests (required for video
 * seeking) and sends CORS headers so frames drawn into a canvas don't taint it
 * (effects and export read pixels back).
 */
export const MEDIA_SCHEME = "media";

export const mediaScheme: CustomScheme = {
  scheme: MEDIA_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
};

export function handleMediaProtocol(isAllowedPath: (filePath: string) => boolean): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const cors = { "Access-Control-Allow-Origin": "*" };
    let filePath: string;
    try {
      filePath = path.normalize(mediaUrlToPath(request.url));
    } catch {
      return new Response("Bad request", { status: 400, headers: cors });
    }
    if (!path.isAbsolute(filePath) || !isAllowedPath(filePath)) {
      return new Response("Forbidden", { status: 403, headers: cors });
    }

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) throw new Error("not a file");
    } catch {
      return new Response("Not found", { status: 404, headers: cors });
    }

    const headers: Record<string, string> = {
      ...cors,
      "Accept-Ranges": "bytes",
      "Content-Type": MEDIA_MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
    };

    const rangeHeader = request.headers.get("Range");
    const range = parseByteRange(rangeHeader, stat.size);
    if (rangeHeader && !range) {
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${stat.size}` } });
    }

    const { start, end } = range ?? { start: 0, end: stat.size - 1 };
    const body = Readable.toWeb(fs.createReadStream(filePath, { start, end })) as unknown as ReadableStream;
    headers["Content-Length"] = String(end - start + 1);
    if (range) headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
    return new Response(body, { status: range ? 206 : 200, headers });
  });
}
