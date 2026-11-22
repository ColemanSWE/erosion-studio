import { app, BrowserWindow, ipcMain, dialog, Menu, protocol, session } from "electron";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { setupFFmpegHandlers } from "./ffmpeg";
import { mediaScheme, handleMediaProtocol } from "./media-protocol";
import { appScheme, handleAppProtocol, APP_ORIGIN } from "./app-protocol";
import { PathPolicy } from "./path-policy";

/** What the renderer may read and write; see path-policy.ts. */
const policy = new PathPolicy(path);

// Privileged schemes must be registered before the app is ready, in one call.
protocol.registerSchemesAsPrivileged([appScheme, mediaScheme]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const APP_URL = DEV_SERVER_URL ?? `${APP_ORIGIN}/index.html`;

/** Pages we serve ourselves: the bundled app, or the Vite dev server. */
function isAppUrl(url: string): boolean {
  try {
    return new URL(url).origin === new URL(APP_URL).origin;
  } catch {
    return false;
  }
}

/** Permissions the UI actually uses: camera/mic, clipboard writes, fullscreen. */
const ALLOWED_PERMISSIONS = new Set(["media", "clipboard-sanitized-write", "fullscreen"]);

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
      sandbox: true,
      // Local media is served through the media:// protocol, so the renderer
      // keeps the default web security model.
    },
  });

  // The window only ever shows the app: no navigation away, no popups.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  mainWindow.loadURL(APP_URL);
  if (DEV_SERVER_URL) mainWindow.webContents.openDevTools();

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
  handleAppProtocol(path.join(__dirname, "../dist"));
  handleMediaProtocol((filePath) => policy.isMediaFile(filePath));
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isAppUrl(details.requestingUrl));
  });
  setupFFmpegHandlers(policy);
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
  const result = await dialog.showSaveDialog(mainWindow, options);
  // The user picked this path, so the renderer may write it (once).
  if (!result.canceled && result.filePath) policy.grantWrite(result.filePath);
  return result;
});

const ACCESS_DENIED = "Access denied";

ipcMain.handle("file:readText", async (_, filePath: string) => {
  if (!policy.isProjectFile(filePath)) {
    return { success: false, error: `${ACCESS_DENIED}: only .eron project files can be read` };
  }
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return { success: true, data };
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message };
  }
});


ipcMain.handle("file:writeText", async (_, filePath: string, data: string) => {
  if (!policy.isProjectFile(filePath) || typeof data !== "string") {
    return { success: false, error: `${ACCESS_DENIED}: only .eron project files can be written` };
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
  if (!policy.isProjectFile(filePath) && !policy.isMediaFile(filePath)) {
    return { success: false, exists: false };
  }
  try {
    await fs.access(filePath);
    return { success: true, exists: true };
  } catch {
    return { success: true, exists: false };
  }
});
