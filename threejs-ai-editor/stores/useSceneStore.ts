// 全局前端状态管理，记录 Three.js 场景对象、执行历史、意图等
import { create } from "zustand";
import { Scene, Object3D } from "three";

interface SceneState {
  scene: Scene | null;
  historyCode: string[];
  selectedObject: Object3D | null;

  // Actions
  setScene: (scene: Scene) => void;
  addToHistory: (code: string) => void;
  selectObject: (object: Object3D | null) => void;
}

type SetState = {
  (
    partial:
      | SceneState
      | Partial<SceneState>
      | ((state: SceneState) => SceneState | Partial<SceneState>),
    replace?: boolean
  ): void;
};

export const useSceneStore = create<SceneState>((set: SetState) => ({
  scene: null,
  historyCode: [],
  selectedObject: null,

  setScene: (scene: Scene) => set({ scene }),
  addToHistory: (code: string) =>
    set((state: SceneState) => ({
      historyCode: [...state.historyCode, code],
    })),
  selectObject: (object: Object3D | null) => set({ selectedObject: object }),
}));
