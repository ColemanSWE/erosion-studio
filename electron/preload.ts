import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("electron", {
  onMenuAction: (cb: (action: string) => void) => {
    ipcRenderer.on("menu:action", (_event, action: string) => cb(action));
    return () => ipcRenderer.removeAllListeners("menu:action");
  },
  openFile: (options: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke("dialog:openFile", options),
  saveFile: (options: Electron.SaveDialogOptions) =>
    ipcRenderer.invoke("dialog:saveFile", options),
  selectDirectory: () =>
    ipcRenderer.invoke("dialog:selectDirectory"),
  // File.path was removed in Electron 32; this is the supported replacement.
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  ffmpeg: {
    encodeVideo: (
      framesDir: string,
      outputPath: string,
      fps?: number,
      format?: "mp4" | "webm" | "gif"
    ) =>
      ipcRenderer.invoke("ffmpeg:encodeVideo", framesDir, outputPath, fps, format),
    getVideoInfo: (videoPath: string) =>
      ipcRenderer.invoke("ffmpeg:getVideoInfo", videoPath),
    createTempDir: () => ipcRenderer.invoke("ffmpeg:createTempDir"),
    cleanupTempDir: (dirPath: string) =>
      ipcRenderer.invoke("ffmpeg:cleanupTempDir", dirPath),
    startStreamExport: (
      sessionId: string,
      opts: { width: number; height: number; fps: number; format: "mp4" | "webm"; outputPath: string; quality?: "low" | "medium" | "high" }
    ) => ipcRenderer.invoke("ffmpeg:startStreamExport", sessionId, opts),
    writeFrame: (sessionId: string, data: Uint8Array) =>
      ipcRenderer.invoke("ffmpeg:writeFrame", sessionId, data),
    endStreamExport: (sessionId: string) =>
      ipcRenderer.invoke("ffmpeg:endStreamExport", sessionId),
  },
  file: {
    readText: (filePath: string) =>
      ipcRenderer.invoke("file:readText", filePath),
    writeText: (filePath: string, data: string) =>
      ipcRenderer.invoke("file:writeText", filePath, data),
    writeBinary: (filePath: string, data: Uint8Array | number[]) =>
      ipcRenderer.invoke("file:writeBinary", filePath, data),
    exists: (filePath: string) =>
      ipcRenderer.invoke("file:exists", filePath),
  },
});

export interface ElectronAPI {
  onMenuAction: (cb: (action: string) => void) => () => void;
  openFile: (
    options: Electron.OpenDialogOptions
  ) => Promise<Electron.OpenDialogReturnValue>;
  saveFile: (
    options: Electron.SaveDialogOptions
  ) => Promise<Electron.SaveDialogReturnValue>;
  selectDirectory: () => Promise<Electron.OpenDialogReturnValue>;
  /** Absolute path of a dropped file, or "" if it isn't a local file. */
  getPathForFile: (file: File) => string;
  ffmpeg: {
    encodeVideo: (
      framesDir: string,
      outputPath: string,
      fps?: number,
      format?: "mp4" | "webm" | "gif"
    ) => Promise<{
      success: boolean;
      outputPath?: string;
      error?: string;
    }>;
    getVideoInfo: (videoPath: string) => Promise<{
      success: boolean;
      duration?: number;
      width?: number;
      height?: number;
      fps?: number;
      error?: string;
    }>;
    createTempDir: () => Promise<{
      success: boolean;
      path?: string;
      error?: string;
    }>;
    cleanupTempDir: (dirPath: string) => Promise<{
      success: boolean;
      error?: string;
    }>;
    startStreamExport: (
      sessionId: string,
      opts: { width: number; height: number; fps: number; format: "mp4" | "webm"; outputPath: string; quality?: "low" | "medium" | "high" }
    ) => Promise<{ success: boolean; error?: string }>;
    writeFrame: (
      sessionId: string,
      data: Uint8Array,
    ) => Promise<{ success: boolean; error?: string }>;
    endStreamExport: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
  };
  file: {
    readText: (filePath: string) => Promise<{
      success: boolean;
      data?: string;
      error?: string;
    }>;
    writeText: (
      filePath: string,
      data: string
    ) => Promise<{
      success: boolean;
      error?: string;
    }>;
    writeBinary: (
      filePath: string,
      data: Uint8Array | number[]
    ) => Promise<{
      success: boolean;
      filePath?: string;
      error?: string;
    }>;
    exists: (filePath: string) => Promise<{
      success: boolean;
      exists: boolean;
    }>;
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
