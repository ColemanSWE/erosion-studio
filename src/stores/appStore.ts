import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface RecentProject {
  name: string;
  path: string;
  lastOpened: number;
}

const MAX_RECENT = 10;

interface AppState {
  projectsDirectory: string | null;
  recentProjects: RecentProject[];
  showWelcome: boolean;

  setProjectsDirectory: (dir: string) => void;
  addRecentProject: (project: RecentProject) => void;
  removeRecentProject: (path: string) => void;
  setShowWelcome: (show: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      projectsDirectory: null,
      recentProjects: [],
      showWelcome: true,

      setProjectsDirectory: (dir) => set({ projectsDirectory: dir }),

      addRecentProject: (project) =>
        set((state) => {
          const filtered = state.recentProjects.filter((r) => r.path !== project.path);
          return {
            recentProjects: [project, ...filtered].slice(0, MAX_RECENT),
          };
        }),

      removeRecentProject: (path) =>
        set((state) => ({
          recentProjects: state.recentProjects.filter((r) => r.path !== path),
        })),

      setShowWelcome: (show) => set({ showWelcome: show }),
    }),
    {
      name: "erosion-app-state",
      version: 1,
      partialize: (state) => ({
        projectsDirectory: state.projectsDirectory,
        recentProjects: state.recentProjects,
      }),
    },
  ),
);
