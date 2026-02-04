import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electron", {
  openFile: (options: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke("dialog:openFile", options),
  saveFile: (options: Electron.SaveDialogOptions) =>
    ipcRenderer.invoke("dialog:saveFile", options),
  ffmpeg: {
    extractFrames: (videoPath: string, outputDir: string, fps?: number) =>
      ipcRenderer.invoke("ffmpeg:extractFrames", videoPath, outputDir, fps),
    encodeVideo: (framesDir: string, outputPath: string, fps?: number) =>
      ipcRenderer.invoke("ffmpeg:encodeVideo", framesDir, outputPath, fps),
    getVideoInfo: (videoPath: string) =>
      ipcRenderer.invoke("ffmpeg:getVideoInfo", videoPath),
  },
  file: {
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
      fps?: number
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
  };
  file: {
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
