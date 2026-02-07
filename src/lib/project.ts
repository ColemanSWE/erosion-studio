import type { Effect, Region } from "./effects/types";

export interface MediaItem {
  id: string;
  type: "image" | "video";
  name: string;
  path: string;
  thumbnail?: string;
  duration?: number;
}

export interface Project {
  name: string;
  media: MediaItem[];
  effects: Effect[];
  regions: Region[];
  duration: number;
  currentTime: number;
  version: string;
}

export function createEmptyProject(): Project {
  return {
    name: "Untitled Project",
    media: [],
    effects: [],
    regions: [],
    duration: 60,
    currentTime: 0,
    version: "1.0",
  };
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export function deserializeProject(json: string): Project {
  const data = JSON.parse(json);

  return {
    name: data.name || "Untitled Project",
    media: data.media || [],
    effects: data.effects || [],
    regions: data.regions || [],
    duration: data.duration || 60,
    currentTime: data.currentTime || 0,
    version: data.version || "1.0",
  };
}

export async function saveProject(
  project: Project
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  if (!window.electron) {
    return { success: false, error: "Electron API not available" };
  }

  try {
    const result = await window.electron.saveFile({
      filters: [{ name: "Erosion Studio Project", extensions: ["erosion"] }],
      defaultPath: `${project.name}.erosion`,
    });

    if (result.canceled || !result.filePath) {
      return { success: false, error: "Save canceled" };
    }

    const json = serializeProject(project);

    return {
      success: true,
      filePath: result.filePath,
    };
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}

export async function loadProject(): Promise<{
  success: boolean;
  project?: Project;
  error?: string;
}> {
  if (!window.electron) {
    return { success: false, error: "Electron API not available" };
  }

  try {
    const result = await window.electron.openFile({
      properties: ["openFile"],
      filters: [{ name: "Erosion Studio Project", extensions: ["erosion"] }],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: "Load canceled" };
    }

    return {
      success: true,
      project: createEmptyProject(),
    };
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}
