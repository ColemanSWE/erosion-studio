import { contextBridge, ipcRenderer } from "electron";

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
  ffmpeg: {
    extractFrames: (videoPath: string, outputDir: string, fps?: number) =>
      ipcRenderer.invoke("ffmpeg:extractFrames", videoPath, outputDir, fps),
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
    readBinary: (filePath: string) =>
      ipcRenderer.invoke("file:readBinary", filePath),
    writeBinary: (filePath: string, data: Uint8Array | number[]) =>
      ipcRenderer.invoke("file:writeBinary", filePath, data),
    exists: (filePath: string) =>
      ipcRenderer.invoke("file:exists", filePath),
    listDirectory: (dirPath: string, extension: string) =>
      ipcRenderer.invoke("file:listDirectory", dirPath, extension),
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
  ffmpeg: {
    extractFrames: (
      videoPath: string,
      outputDir: string,
      fps?: number
    ) => Promise<{
      success: boolean;
      outputDir?: string;
      error?: string;
    }>;
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
    readBinary: (filePath: string) => Promise<{
      success: boolean;
      data?: number[];
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
    listDirectory: (dirPath: string, extension: string) => Promise<{
      success: boolean;
      files?: string[];
      error?: string;
    }>;
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
