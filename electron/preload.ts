import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electron", {
  openFile: (options: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke("dialog:openFile", options),
  saveFile: (options: Electron.SaveDialogOptions) =>
    ipcRenderer.invoke("dialog:saveFile", options),
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
  },
  file: {
    readText: (filePath: string) =>
      ipcRenderer.invoke("file:readText", filePath),
    writeText: (filePath: string, data: string) =>
      ipcRenderer.invoke("file:writeText", filePath, data),
    readBinary: (filePath: string) =>
      ipcRenderer.invoke("file:readBinary", filePath),
    writeBinary: (filePath: string, data: number[]) =>
      ipcRenderer.invoke("file:writeBinary", filePath, data),
  },
});

export interface ElectronAPI {
  openFile: (
    options: Electron.OpenDialogOptions
  ) => Promise<Electron.OpenDialogReturnValue>;
  saveFile: (
    options: Electron.SaveDialogOptions
  ) => Promise<Electron.SaveDialogReturnValue>;
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
      data: number[]
    ) => Promise<{
      success: boolean;
      filePath?: string;
      error?: string;
    }>;
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
