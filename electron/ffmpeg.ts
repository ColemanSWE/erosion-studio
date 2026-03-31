import { ipcMain, app } from "electron";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { spawn } from "child_process";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const unlink = promisify(fs.unlink);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

/** Resolve the path to the bundled ffmpeg binary from ffmpeg-static. */
function getFFmpegPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  let ffmpegPath: string;
  try {
    ffmpegPath = require("ffmpeg-static") as string;
  } catch {
    ffmpegPath = "ffmpeg"; // fallback to system ffmpeg
  }
  // In production builds, asar-unpacked path may be needed
  if (ffmpegPath && ffmpegPath.includes("app.asar")) {
    ffmpegPath = ffmpegPath.replace("app.asar", "app.asar.unpacked");
  }
  return ffmpegPath;
}

export function setupFFmpegHandlers() {
  // ── Get real video info via ffprobe-style probing ─────────────────────────
  ipcMain.handle("ffmpeg:getVideoInfo", async (_, videoPath: string) => {
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

  // ── Encode frames directory into a video file ─────────────────────────────
  ipcMain.handle(
    "ffmpeg:encodeVideo",
    async (
      _,
      framesDir: string,
      outputPath: string,
      fps = 30,
      format: "mp4" | "webm" | "gif" = "mp4"
    ) => {
      try {
        const ffmpegPath = getFFmpegPath();

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
          await new Promise<void>((resolve, reject) => {
            const p1 = spawn(ffmpegPath, [
              "-y",
              "-framerate", String(fps),
              "-i", path.join(framesDir, "frame_%06d.png"),
              "-vf", "palettegen=max_colors=256:stats_mode=full",
              palettePath
            ]);
            p1.on("close", (code) => code === 0 ? resolve() : reject(new Error(`palettegen exited ${code}`)));
            p1.on("error", reject);
          });
          args.push(
            "-i", palettePath,
            "-lavfi", "paletteuse=dither=floyd_steinberg",
          );
        }

        args.push(outputPath);

        await new Promise<void>((resolve, reject) => {
          const proc = spawn(ffmpegPath, args, { stdio: ["pipe", "pipe", "pipe"] });
          let stderr = "";
          proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
          proc.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
          });
          proc.on("error", reject);
        });

        return { success: true, outputPath };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );

  // ── Create temp directory for frames ──────────────────────────────────────
  ipcMain.handle("ffmpeg:createTempDir", async () => {
    try {
      const tmpDir = path.join(app.getPath("temp"), `erosion-export-${Date.now()}`);
      await mkdir(tmpDir, { recursive: true });
      return { success: true, path: tmpDir };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // ── Clean up temp directory ───────────────────────────────────────────────
  ipcMain.handle("ffmpeg:cleanupTempDir", async (_, dirPath: string) => {
    try {
      const files = await readdir(dirPath);
      for (const f of files) {
        await unlink(path.join(dirPath, f));
      }
      fs.rmdirSync(dirPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // ── File I/O helpers ──────────────────────────────────────────────────────
  ipcMain.handle("file:readBinary", async (_, filePath: string) => {
    try {
      const data = await readFile(filePath);
      return { success: true, data: Array.from(data) };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    "file:writeBinary",
    async (_, filePath: string, data: number[]) => {
      try {
        const dir = path.dirname(filePath);
        await mkdir(dir, { recursive: true });
        await writeFile(filePath, Buffer.from(data));
        return { success: true, filePath };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }
  );
}
