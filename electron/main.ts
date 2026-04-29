import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { setupFFmpegHandlers } from "./ffmpeg";

/** Reject paths that escape the user's home directory or look suspicious. */
function isAllowedPath(filePath: string): boolean {
  const normalized = path.normalize(filePath);
  const home = app.getPath("home");
  const temp = app.getPath("temp");
  return (
    normalized.startsWith(home) ||
    normalized.startsWith(temp) ||
    normalized.startsWith("/Volumes/") ||
    normalized.startsWith("/tmp/")
  );
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: "#000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // Allow loading local file:// resources (video/images from disk)
      // Safe for a fully-local desktop app with no untrusted web content
      webSecurity: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  setupFFmpegHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("dialog:openFile", async (_, options) => {
  if (!mainWindow) return { canceled: true };
  return dialog.showOpenDialog(mainWindow, options);
});

ipcMain.handle("dialog:saveFile", async (_, options) => {
  if (!mainWindow) return { canceled: true };
  return dialog.showSaveDialog(mainWindow, options);
});

ipcMain.handle("file:readText", async (_, filePath: string) => {
  if (!isAllowedPath(filePath)) {
    return { success: false, error: "Access denied: path outside allowed directories" };
  }
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return { success: true, data };
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle("file:writeText", async (_, filePath: string, data: string) => {
  if (!isAllowedPath(filePath)) {
    return { success: false, error: "Access denied: path outside allowed directories" };
  }
  try {
    await fs.writeFile(filePath, data, "utf-8");
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message };
  }
});
