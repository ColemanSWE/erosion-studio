import type { PlatformPath } from "node:path";

/**
 * Decides which filesystem paths the renderer may touch through IPC and the
 * `media://` protocol. The renderer is treated as untrusted: it can only
 *
 * - read media files and `.eron` projects (by extension, anywhere on disk),
 * - write `.eron` projects,
 * - write a file the user picked in a save dialog this session (once),
 * - write PNG frames into, and delete, temp dirs the main process created.
 *
 * Pure logic: the `path` module is passed in (no Electron or Node imports), so
 * tests can run Windows and POSIX rules on any OS with `path.win32` /
 * `path.posix`.
 */

export const MEDIA_MIME_TYPES: Readonly<Record<string, string>> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export const PROJECT_EXTENSION = ".eron";

/** Temp dirs are created with this prefix (see `createTempDir`). */
export const TEMP_DIR_PREFIX = "erosion-export-";

const FRAME_FILE = /^frame_\d{6}\.png$/;

export class PathPolicy {
  private readonly writeGrants = new Set<string>();
  private readonly tempDirs = new Set<string>();
  private readonly caseInsensitive: boolean;

  constructor(private readonly p: PlatformPath) {
    this.caseInsensitive = p.sep === "\\";
  }

  /** Canonical comparison key for an absolute path, or null if unusable. */
  private key(file: unknown): string | null {
    if (typeof file !== "string" || file.length === 0 || file.includes("\0")) return null;
    if (!this.p.isAbsolute(file)) return null;
    const resolved = this.p.resolve(file);
    return this.caseInsensitive ? resolved.toLowerCase() : resolved;
  }

  private ext(file: string): string {
    return this.p.extname(file).toLowerCase();
  }

  isMediaFile(file: unknown): file is string {
    // Extensions always start with ".", so prototype keys can't match.
    return this.key(file) !== null && this.ext(file as string) in MEDIA_MIME_TYPES;
  }

  isProjectFile(file: unknown): file is string {
    return this.key(file) !== null && this.ext(file as string) === PROJECT_EXTENSION;
  }

  /** Record a path the user chose in a save dialog. */
  grantWrite(file: unknown): void {
    const k = this.key(file);
    if (k) this.writeGrants.add(k);
  }

  /** True (and consumes the grant) if the user picked this path to save to. */
  takeWriteGrant(file: unknown): file is string {
    const k = this.key(file);
    return k !== null && this.writeGrants.delete(k);
  }

  addTempDir(dir: string): void {
    const k = this.key(dir);
    if (k) this.tempDirs.add(k);
  }

  isTempDir(dir: unknown): dir is string {
    const k = this.key(dir);
    return k !== null && this.tempDirs.has(k);
  }

  removeTempDir(dir: string): void {
    const k = this.key(dir);
    if (k) this.tempDirs.delete(k);
  }

  /** A `frame_NNNNNN.png` directly inside one of our temp dirs. */
  isTempFrame(file: unknown): file is string {
    if (this.key(file) === null) return false;
    const resolved = this.p.resolve(file as string);
    return FRAME_FILE.test(this.p.basename(resolved)) && this.isTempDir(this.p.dirname(resolved));
  }
}
