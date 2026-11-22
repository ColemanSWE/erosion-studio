import { ipcMain, app } from "electron";
import fs from "fs";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { createRequire } from "module";
import { TEMP_DIR_PREFIX, type PathPolicy } from "./path-policy";

const _require = createRequire(import.meta.url);

/** Resolve the path to the bundled ffmpeg binary from ffmpeg-static. */
function getFFmpegPath(): string {
  let ffmpegPath: string;
  try {
    ffmpegPath = _require("ffmpeg-static") as string;
  } catch {
    ffmpegPath = "ffmpeg"; // fallback to system ffmpeg
  }
  // In production builds the binary lives outside the asar archive
  if (ffmpegPath?.includes("app.asar")) {
    ffmpegPath = ffmpegPath.replace("app.asar", "app.asar.unpacked");
  }
  return ffmpegPath;
}

interface StreamSession {
  process: ChildProcess;
  exitPromise: Promise<{ success: boolean; error?: string }>;
  stderrBuffer: string;
}

const streamSessions = new Map<string, StreamSession>();

type ExportQuality = "low" | "medium" | "high";

/** Constant-rate-factor per codec and quality (lower = better / larger). */
const CRF: Record<"mp4" | "webm", Record<ExportQuality, number>> = {
  mp4: { low: 28, medium: 23, high: 18 },
  webm: { low: 40, medium: 31, high: 20 },
};

const DENIED = { success: false, error: "Access denied" } as const;

const isInt = (n: unknown, min: number, max: number): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;
const isFps = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 240;

/** Run ffmpeg to completion, rejecting with the tail of stderr on failure. */
function runFFmpeg(args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn(getFFmpegPath(), args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
    });
    proc.on("error", reject);
  });
}

/**
 * FFmpeg and binary-file IPC. Every path the renderer sends is checked against
 * `policy`: probes only read media files, encodes only read our own temp dirs
 * and only write paths the user picked in a save dialog.
 */
export function setupFFmpegHandlers(policy: PathPolicy) {
  // ── Get real video info via ffprobe-style probing ─────────────────────────
  ipcMain.handle("ffmpeg:getVideoInfo", async (_, videoPath: string) => {
    if (!policy.isMediaFile(videoPath)) return DENIED;
    try {
      const ffmpegPath = getFFmpegPath();
      // Use ffmpeg to probe video info  (ffprobe may not be bundled)
      return await new Promise<{
        success: boolean;
        duration?: number;
        width?: number;
        height?: number;
        fps?: number;
        error?: string;
      }>((resolve) => {
        const args = [
          "-i", videoPath,
          "-hide_banner",
        ];
        const proc = spawn(ffmpegPath, args, { stdio: ["pipe", "pipe", "pipe"] });
        let stderr = "";
        proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
        proc.on("close", () => {
          // Parse duration from stderr: "Duration: HH:MM:SS.ss"
          const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
          let duration: number | undefined;
          if (durMatch) {
            duration =
              parseInt(durMatch[1]) * 3600 +
              parseInt(durMatch[2]) * 60 +
              parseInt(durMatch[3]) +
              parseFloat(`0.${durMatch[4]}`);
          }
          // Parse resolution: "1920x1080" or similar
          const resMatch = stderr.match(/(\d{2,5})x(\d{2,5})/);
          const width = resMatch ? parseInt(resMatch[1]) : undefined;
          const height = resMatch ? parseInt(resMatch[2]) : undefined;
          // Parse fps: "30 fps" or "29.97 fps"
          const fpsMatch = stderr.match(/([\d.]+)\s*fps/);
          const fps = fpsMatch ? parseFloat(fpsMatch[1]) : undefined;

          resolve({ success: true, duration, width, height, fps });
        });
        proc.on("error", (err) => {
          resolve({ success: false, error: String(err) });
        });
        // No stdin needed — just close it so ffmpeg exits after probing
        proc.stdin.end();
      });
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // ── Encode a temp dir of PNG frames into a video file ─────────────────────
  ipcMain.handle(
    "ffmpeg:encodeVideo",
    async (
      _,
      framesDir: string,
      outputPath: string,
      fps = 30,
      format: "mp4" | "webm" | "gif" = "mp4"
    ) => {
      if (!policy.isTempDir(framesDir) || !isFps(fps) || !["mp4", "webm", "gif"].includes(format)) return DENIED;
      if (!policy.takeWriteGrant(outputPath)) return DENIED;
      try {
        const args: string[] = [
          "-y",                        // overwrite
          "-framerate", String(fps),   // input framerate
          "-i", path.join(framesDir, "frame_%06d.png"),
        ];

        if (format === "mp4") {
          args.push(
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",       // compatibility
            "-crf", "18",                // high quality
            "-preset", "fast",
          );
        } else if (format === "webm") {
          args.push(
            "-c:v", "libvpx-vp9",
            "-crf", "20",
            "-b:v", "0",
            "-pix_fmt", "yuv420p",
          );
        } else if (format === "gif") {
          // Two-pass palettegen for high quality GIF
          const palettePath = path.join(framesDir, "_palette.png");
          await runFFmpeg([
            "-y",
            "-framerate", String(fps),
            "-i", path.join(framesDir, "frame_%06d.png"),
            "-vf", "palettegen=max_colors=256:stats_mode=full",
            palettePath,
          ]);
          args.push(
            "-i", palettePath,
            "-lavfi", "paletteuse=dither=floyd_steinberg",
          );
        }

        args.push(outputPath);
        await runFFmpeg(args);
        return { success: true, outputPath };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );

  // ── Temp directory for frames ─────────────────────────────────────────────
  ipcMain.handle("ffmpeg:createTempDir", async () => {
    try {
      const tmpDir = await fs.promises.mkdtemp(path.join(app.getPath("temp"), TEMP_DIR_PREFIX));
      policy.addTempDir(tmpDir);
      return { success: true, path: tmpDir };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Only directories created by createTempDir can be removed.
  ipcMain.handle("ffmpeg:cleanupTempDir", async (_, dirPath: string) => {
    if (!policy.isTempDir(dirPath)) return DENIED;
    try {
      await fs.promises.rm(dirPath, { recursive: true, force: true });
      policy.removeTempDir(dirPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // ── Rawvideo streaming export (MP4 / WebM — avoids per-frame PNG encode) ──
  ipcMain.handle(
    "ffmpeg:startStreamExport",
    async (
      _,
      sessionId: string,
      opts: { width: number; height: number; fps: number; format: "mp4" | "webm"; outputPath: string; quality?: ExportQuality },
    ) => {
      const { width, height, fps, format, outputPath } = opts ?? {};
      const quality = opts?.quality ?? "high";
      if (
        typeof sessionId !== "string" || streamSessions.has(sessionId) ||
        !isInt(width, 1, 16384) || !isInt(height, 1, 16384) || !isFps(fps) ||
        !(format in CRF) || !(quality in CRF.mp4)
      ) {
        return { success: false, error: "Invalid export options" };
      }
      if (!policy.takeWriteGrant(outputPath)) return DENIED;
      try {
        const ffmpegPath = getFFmpegPath();
        const crf = String(CRF[format][quality]);

        const args: string[] = [
          "-y",
          "-f", "rawvideo",
          "-pix_fmt", "rgba",
          "-s", `${width}x${height}`,
          "-r", String(fps),
          "-i", "pipe:0",
        ];

        if (format === "mp4") {
          args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", crf, "-preset", "fast");
        } else {
          args.push("-c:v", "libvpx-vp9", "-crf", crf, "-b:v", "0", "-pix_fmt", "yuv420p");
        }

        args.push(outputPath);

        const proc = spawn(ffmpegPath, args, { stdio: ["pipe", "pipe", "pipe"] });
        let stderrBuffer = "";
        proc.stderr?.on("data", (d: Buffer) => { stderrBuffer += d.toString(); });

        const exitPromise = new Promise<{ success: boolean; error?: string }>((resolve) => {
          proc.on("close", (code) => {
            streamSessions.delete(sessionId);
            if (code === 0) resolve({ success: true });
            else resolve({ success: false, error: `FFmpeg exited with code ${code}: ${stderrBuffer.slice(-500)}` });
          });
          proc.on("error", (err) => {
            streamSessions.delete(sessionId);
            resolve({ success: false, error: String(err) });
          });
        });

        streamSessions.set(sessionId, { process: proc, exitPromise, stderrBuffer });
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle(
    "ffmpeg:writeFrame",
    async (_, sessionId: string, data: Uint8Array) => {
      const session = streamSessions.get(sessionId);
      if (!session || !session.process.stdin) return { success: false, error: "Session not found" };
      if (!(data instanceof Uint8Array)) return { success: false, error: "Invalid frame data" };

      return new Promise<{ success: boolean; error?: string }>((resolve) => {
        const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        const canContinue = session.process.stdin!.write(buf);
        if (canContinue) {
          resolve({ success: true });
        } else {
          session.process.stdin!.once("drain", () => resolve({ success: true }));
        }
      });
    },
  );

  ipcMain.handle("ffmpeg:endStreamExport", async (_, sessionId: string) => {
    const session = streamSessions.get(sessionId);
    if (!session) return { success: false, error: "Session not found" };
    session.process.stdin?.end();
    return session.exitPromise;
  });

  // ── Binary writes: exported stills (save-dialog path) and GIF temp frames ─
  ipcMain.handle(
    "file:writeBinary",
    async (_, filePath: string, data: Uint8Array | number[]) => {
      if (!policy.isTempFrame(filePath) && !policy.takeWriteGrant(filePath)) return DENIED;
      try {
        await fs.promises.writeFile(filePath, Buffer.from(data));
        return { success: true, filePath };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );
}
