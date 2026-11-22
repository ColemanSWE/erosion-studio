import { app, BrowserWindow, ipcMain, dialog, Menu } from "electron";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { setupFFmpegHandlers } from "./ffmpeg";
import { registerMediaScheme, handleMediaProtocol } from "./media-protocol";

/** Reject paths that escape the user's home directory or look suspicious. */
function isAllowedPath(filePath: string): boolean {
  const normalized = path.normalize(filePath);
  // Media often lives on other drives on Windows; drive roots are fine there.
  if (process.platform === "win32") return path.isAbsolute(normalized);
  const home = app.getPath("home");
  const temp = app.getPath("temp");
  return (
    normalized.startsWith(home) ||
    normalized.startsWith(temp) ||
    normalized.startsWith("/Volumes/") || // macOS external drives
    normalized.startsWith("/media/") || // Linux removable media
    normalized.startsWith("/mnt/") ||
    normalized.startsWith("/tmp/")
  );
}

// Privileged schemes must be registered before the app is ready.
registerMediaScheme();

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
      // Local media is served through the media:// protocol, so the renderer
      // keeps the default web security model.
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

function send(channel: string) {
  mainWindow?.webContents.send("menu:action", channel);
}

function buildMenu() {
  const isMac = process.platform === "darwin";

  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS app menu (first item is always the app name)
    ...(isMac
      ? ([
          {
            role: "appMenu" as const,
          },
        ] satisfies Electron.MenuItemConstructorOptions[])
      : []),

    {
      label: "File",
      submenu: [
        {
          label: "New Project",
          accelerator: "CmdOrCtrl+N",
          click: () => send("new-project"),
        },
        { type: "separator" },
        {
          label: "Open Project…",
          accelerator: "CmdOrCtrl+O",
          click: () => send("open-project"),
        },
        { type: "separator" },
        {
          label: "Save",
          accelerator: "CmdOrCtrl+S",
          click: () => send("save-project"),
        },
        {
          label: "Save As…",
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => send("save-project-as"),
        },
        { type: "separator" },
        isMac ? { role: "close" as const } : { role: "quit" as const },
      ],
    },

    {
      label: "Edit",
      submenu: [
        {
          label: "Undo",
          accelerator: "CmdOrCtrl+Z",
          click: () => send("undo"),
        },
        {
          label: "Redo",
          accelerator: "CmdOrCtrl+Shift+Z",
          click: () => send("redo"),
        },
        { type: "separator" },
        { role: "cut" as const },
        { role: "copy" as const },
        { role: "paste" as const },
        { role: "selectAll" as const },
      ],
    },

    {
      label: "View",
      submenu: [
        { role: "reload" as const },
        { role: "forceReload" as const },
        { role: "toggleDevTools" as const },
        { type: "separator" },
        { role: "resetZoom" as const },
        { role: "zoomIn" as const },
        { role: "zoomOut" as const },
        { type: "separator" },
        { role: "togglefullscreen" as const },
      ],
    },

    {
      role: "window" as const,
      submenu: [
        { role: "minimize" as const },
        { role: "zoom" as const },
        ...(isMac
          ? [
              { type: "separator" as const },
              { role: "front" as const },
            ]
          : [{ role: "close" as const }]),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  handleMediaProtocol(isAllowedPath);
  setupFFmpegHandlers();
  buildMenu();
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

ipcMain.handle("dialog:selectDirectory", async () => {
  if (!mainWindow) return { canceled: true };
  return dialog.showOpenDialog(mainWindow, {
    title: "Select Projects Folder",
    properties: ["openDirectory", "createDirectory"],
  });
});

ipcMain.handle("file:exists", async (_, filePath: string) => {
  try {
    await fs.access(filePath);
    return { success: true, exists: true };
  } catch {
    return { success: true, exists: false };
  }
});

ipcMain.handle("file:listDirectory", async (_, dirPath: string, extension: string) => {
  if (!isAllowedPath(dirPath)) {
    return { success: false, error: "Access denied: path outside allowed directories" };
  }
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && e.name.endsWith(extension))
      .map((e) => path.join(dirPath, e.name));
    return { success: true, files };
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message };
  }
});
