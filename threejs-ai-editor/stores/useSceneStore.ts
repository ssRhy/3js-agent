// 全局前端状态管理，记录 Three.js 场景对象、执行历史、意图等
import { create } from "zustand";
import { Scene, Object3D, Mesh, Group, Light } from "three";
import { v4 as uuidv4 } from "uuid";

// 对象注册表接口
interface ObjectRegistryEntry {
  object: Object3D;
  type: string; // "mesh", "light", "group", "model" 等
  name: string;
  createdAt: Date;
  lastUpdated: Date;
  isVisible: boolean;
  metadata?: Record<string, any>; // 任意元数据
}

// 对象状态接口
interface ObjectState {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  // 其他状态...
}

interface SceneState {
  scene: Scene | null;
  historyCode: string[];
  selectedObject: Object3D | null;
  errors: string[]; // 添加错误跟踪数组

  // 对象注册表 - UUID到对象的映射
  objectRegistry: Map<string, ObjectRegistryEntry>;
  // 对象状态缓存 - UUID到对象状态的映射
  objectStates: Map<string, ObjectState>;
  // 代码到UUID的映射 - 跟踪代码中创建的对象
  codeToObjectMap: Map<string, string[]>;

  // 场景管理
  setScene: (scene: Scene) => void;
  addToHistory: (code: string) => void;
  selectObject: (object: Object3D | null) => void;

  // 错误处理方法
  addError: (error: string) => void; // 添加错误
  setErrors: (errors: string[]) => void; // 设置错误数组
  clearErrors: () => void; // 清空错误

  // 对象注册方法
  registerObject: (
    object: Object3D,
    type?: string,
    metadata?: Record<string, any>
  ) => string;
  unregisterObject: (uuid: string) => void;
  getObjectByUuid: (uuid: string) => Object3D | null;
  getRegistryEntry: (uuid: string) => ObjectRegistryEntry | null;

  // 对象状态管理
  updateObjectState: (uuid: string) => void;
  applyObjectState: (uuid: string, state: Partial<ObjectState>) => void;

  // 代码映射管理
  mapCodeToObjects: (codeSnippet: string, objectUuids: string[]) => void;
  getObjectsByCode: (codeSnippet: string) => string[];

  // 场景差异管理
  getSceneSnapshot: () => Record<string, ObjectState>;
  applySceneSnapshot: (snapshot: Record<string, ObjectState>) => void;

  // 场景查询功能
  findObjectsByType: (type: string) => string[];
  getAllObjects: () => Map<string, ObjectRegistryEntry>;
  getVisibleObjects: () => string[];
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

// 确定对象类型的辅助函数
const determineObjectType = (object: Object3D): string => {
  if (object instanceof Mesh) return "mesh";
  if (object instanceof Light) return "light";
  if (object instanceof Group) {
    // 检查是否为可能是模型的组
    if (object.children.some((child) => child instanceof Mesh)) {
      return "model";
    }
    return "group";
  }
  return "unknown";
};

// 提取对象状态的辅助函数
const extractObjectState = (object: Object3D): ObjectState => {
  return {
    position: {
      x: object.position.x,
      y: object.position.y,
      z: object.position.z,
    },
    rotation: {
      x: object.rotation.x,
      y: object.rotation.y,
      z: object.rotation.z,
    },
    scale: {
      x: object.scale.x,
      y: object.scale.y,
      z: object.scale.z,
    },
  };
};

export const useSceneStore = create<SceneState>((set, get) => ({
  scene: null,
  historyCode: [],
  selectedObject: null,
  errors: [], // 初始化为空数组

  // 初始化对象注册表和状态映射
  objectRegistry: new Map(),
  objectStates: new Map(),
  codeToObjectMap: new Map(),

  // 原有方法
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

  // 对象注册方法
  registerObject: (
    object: Object3D,
    type?: string,
    metadata?: Record<string, any>
  ) => {
    // 使用对象自身的UUID或生成新的
    const uuid = object.uuid || uuidv4();

    // 确保uuid是唯一的
    if (object.uuid !== uuid) {
      object.uuid = uuid;
    }

    const objType = type || determineObjectType(object);
    const timestamp = new Date();

    const registry = get().objectRegistry;
    const entry: ObjectRegistryEntry = {
      object,
      type: objType,
      name: object.name || `${objType}_${uuid.substring(0, 8)}`,
      createdAt: timestamp,
      lastUpdated: timestamp,
      isVisible: object.visible,
      metadata,
    };

    registry.set(uuid, entry);

    // 同时更新对象状态
    get().updateObjectState(uuid);

    // 递归注册所有子对象
    object.children.forEach((child) => {
      get().registerObject(child);
    });

    set({ objectRegistry: new Map(registry) });
    return uuid;
  },

  unregisterObject: (uuid: string) => {
    const registry = get().objectRegistry;
    const states = get().objectStates;

    // 删除注册信息
    registry.delete(uuid);
    // 删除状态信息
    states.delete(uuid);

    set({
      objectRegistry: new Map(registry),
      objectStates: new Map(states),
    });
  },

  getObjectByUuid: (uuid: string) => {
    const entry = get().objectRegistry.get(uuid);
    return entry ? entry.object : null;
  },

  getRegistryEntry: (uuid: string) => {
    return get().objectRegistry.get(uuid) || null;
  },

  // 对象状态管理
  updateObjectState: (uuid: string) => {
    const obj = get().getObjectByUuid(uuid);
    if (!obj) return;

    const states = get().objectStates;
    states.set(uuid, extractObjectState(obj));

    // 更新注册表中的lastUpdated
    const registry = get().objectRegistry;
    const entry = registry.get(uuid);
    if (entry) {
      entry.lastUpdated = new Date();
      entry.isVisible = obj.visible;
      registry.set(uuid, entry);
    }

    set({
      objectStates: new Map(states),
      objectRegistry: new Map(registry),
    });
  },

  applyObjectState: (uuid: string, state: Partial<ObjectState>) => {
    const obj = get().getObjectByUuid(uuid);
    if (!obj) return;

    // 应用新状态到对象
    if (state.position) {
      obj.position.set(state.position.x, state.position.y, state.position.z);
    }

    if (state.rotation) {
      obj.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z);
    }

    if (state.scale) {
      obj.scale.set(state.scale.x, state.scale.y, state.scale.z);
    }

    // 更新状态缓存
    get().updateObjectState(uuid);
  },

  // 代码映射管理
  mapCodeToObjects: (codeSnippet: string, objectUuids: string[]) => {
    const codeMap = get().codeToObjectMap;
    codeMap.set(codeSnippet, objectUuids);
    set({ codeToObjectMap: new Map(codeMap) });
  },

  getObjectsByCode: (codeSnippet: string) => {
    return get().codeToObjectMap.get(codeSnippet) || [];
  },

  // 场景差异管理
  getSceneSnapshot: () => {
    const snapshot: Record<string, ObjectState> = {};
    get().objectStates.forEach((state, uuid) => {
      snapshot[uuid] = { ...state };
    });
    return snapshot;
  },

  applySceneSnapshot: (snapshot: Record<string, ObjectState>) => {
    Object.entries(snapshot).forEach(([uuid, state]) => {
      get().applyObjectState(uuid, state);
    });
  },

  // 场景查询功能
  findObjectsByType: (type: string) => {
    const uuids: string[] = [];
    get().objectRegistry.forEach((entry, uuid) => {
      if (entry.type === type) {
        uuids.push(uuid);
      }
    });
    return uuids;
  },

  getAllObjects: () => {
    return new Map(get().objectRegistry);
  },

  getVisibleObjects: () => {
    const uuids: string[] = [];
    get().objectRegistry.forEach((entry, uuid) => {
      if (entry.isVisible) {
        uuids.push(uuid);
      }
    });
    return uuids;
  },
}));
