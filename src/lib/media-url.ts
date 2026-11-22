/**
 * Turn a media path from a project (absolute file path, legacy file:// URL,
 * blob:/data:/http(s): URL) into something the renderer can load.
 *
 * Local files go through the app's `media://` protocol (see
 * electron/media-protocol.ts), which serves them with range + CORS support.
 */
export function toMediaUrl(path: string): string {
  if (/^(blob:|data:|https?:|media:)/.test(path)) return path;

  let filePath = path;
  if (filePath.startsWith("file://")) filePath = decodeURI(filePath.slice("file://".length));
  filePath = filePath.replace(/\\/g, "/");
  if (!filePath.startsWith("/")) filePath = `/${filePath}`; // Windows "C:/..." → "/C:/..."

  return `media://local${filePath.split("/").map(encodeURIComponent).join("/")}`;
}

/** Whether a URL needs `crossOrigin = "anonymous"` so canvas reads stay untainted. */
export function needsCrossOrigin(url: string): boolean {
  return /^(https?:|media:)/.test(url);
}

/** Inverse of `toMediaUrl` for local files (used by the main-process handler). */
export function mediaUrlToPath(url: string): string {
  const { pathname } = new URL(url);
  const decoded = pathname.split("/").map(decodeURIComponent).join("/");
  // Windows: "/C:/Users/..." → "C:/Users/..."
  return /^\/[A-Za-z]:\//.test(decoded) ? decoded.slice(1) : decoded;
}

/** Parse an HTTP Range header against a file size; null = no/invalid range. */
export function parseByteRange(header: string | null, size: number): { start: number; end: number } | null {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    // Suffix range: the last N bytes.
    const n = parseInt(match[2], 10);
    return n > 0 ? { start: Math.max(0, size - n), end: size - 1 } : null;
  }
  const start = parseInt(match[1], 10);
  const end = match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1;
  return start <= end && start < size ? { start, end } : null;
}
