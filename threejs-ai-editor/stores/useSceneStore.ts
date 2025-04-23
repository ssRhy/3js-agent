// 全局前端状态管理，记录 Three.js 场景对象、执行历史、意图等
import { create } from "zustand";
import { Scene, Object3D } from "three";

interface SceneState {
  scene: Scene | null;
  historyCode: string[];
  selectedObject: Object3D | null;
  errors: string[]; // 添加错误跟踪数组

  // Actions
  setScene: (scene: Scene) => void;
  addToHistory: (code: string) => void;
  selectObject: (object: Object3D | null) => void;
  addError: (error: string) => void; // 添加错误
  setErrors: (errors: string[]) => void; // 设置错误数组
  clearErrors: () => void; // 清空错误
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
  errors: [], // 初始化为空数组

  setScene: (scene: Scene) => set({ scene }),
  addToHistory: (code: string) =>
    set((state: SceneState) => ({
      historyCode: [...state.historyCode, code],
    })),
  selectObject: (object: Object3D | null) => set({ selectedObject: object }),

  // 错误处理方法
  addError: (error: string) =>
    set((state: SceneState) => ({
      errors: [...state.errors, error],
    })),
  setErrors: (errors: string[]) => set({ errors }),
  clearErrors: () => set({ errors: [] }),
}));
