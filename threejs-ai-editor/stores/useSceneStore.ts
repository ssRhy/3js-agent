// 全局前端状态管理，记录 Three.js 场景对象、执行历史、意图等
import { create } from "zustand";
import {
  Scene,
  Object3D,
  Mesh,
  Group,
  Light,
  Vector3,
  Quaternion,
} from "three";
import { v4 as uuidv4 } from "uuid";

// 场景快照接口，用于历史记录
export interface SceneSnapshot {
  objectStates: Record<string, ObjectState>;
  objectTypes: Record<string, string>;
  createdAt: string;
}

// 历史记录条目接口
export interface HistoryEntry {
  code: string;
  sceneState: SceneSnapshot;
  timestamp: string;
  modelUrls?: string[];
  userPrompt?: string; // 添加用户需求字段
}

// 对象注册表接口
interface ObjectRegistryEntry {
  object: Object3D;
  type: string; // "mesh", "light", "group", "model" 等
  name: string;
  createdAt: Date;
  lastUpdated: Date;
  isVisible: boolean;
  metadata?: Record<string, unknown>; // 任意元数据
}

// 对象状态接口
interface ObjectState {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  // 其他状态...
}

// 持久化数据接口 - 增强版本，包含更多状态信息
interface PersistedSceneData {
  sceneSnapshot: SceneSnapshot;
  modelUrls: string[];
  timestamp: string;
  version: string;
  // 新增：代码和UI状态
  currentCode?: string;
  currentPrompt?: string;
  historyEntries?: HistoryEntry[];
  errors?: string[];
  selectedObjectId?: string | null;
  // 新增：页面状态
  pageState?: {
    isGenerating?: boolean;
    lastGenerateTime?: string;
    renderingComplete?: boolean;
  };
}

interface SceneState {
  scene: Scene | null;
  dynamicGroup: Group | null; // 动态组，用于管理AI生成的对象
  historyCode: string[];
  selectedObject: Object3D | null;
  errors: string[]; // 添加错误跟踪数组
  history: HistoryEntry[]; // 历史记录数组
  transformHistory: SceneSnapshot[]; // 物体变换历史记录数组
  currentTransformIndex: number; // 当前变换历史索引
  isDraggingOrSelecting: boolean; // 添加物体操作模式状态

  // 新增：UI状态持久化
  currentCode: string;
  currentPrompt: string;
  isGenerating: boolean;
  renderingComplete: boolean;
  modelUrls: string[]; // 添加modelUrls到状态接口

  // 对象注册表 - UUID到对象的映射
  objectRegistry: Map<string, ObjectRegistryEntry>;
  // 对象状态缓存 - UUID到对象状态的映射
  objectStates: Map<string, ObjectState>;
  // 代码到UUID的映射 - 跟踪代码中创建的对象
  codeToObjectMap: Map<string, string[]>;

  // 场景管理
  setScene: (scene: Scene) => void;
  setDynamicGroup: (group: Group) => void;
  addToHistory: (code: string) => void;
  selectObject: (object: Object3D | null) => void;
  setIsDraggingOrSelecting: (value: boolean) => void; // 添加设置操作模式的方法

  // 新增：UI状态管理
  setCurrentCode: (code: string) => void;
  setCurrentPrompt: (prompt: string) => void;
  setIsGenerating: (generating: boolean) => void;
  setRenderingComplete: (complete: boolean) => void;
  setModelUrls: (urls: string[]) => void; // 添加设置modelUrls的方法

  // 对象操作方法
  deleteObject: (object: Object3D) => void; // 新增删除物体方法

  // 组合对象相关方法
  createGroup: (objects: Object3D[], name?: string) => Group; // 创建一个新组
  addToGroup: (group: Group, object: Object3D) => void; // 添加对象到组
  removeFromGroup: (group: Group, object: Object3D) => void; // 从组中移除对象
  ungroupObjects: (group: Group) => Object3D[]; // 解组

  // 历史记录管理
  addHistoryEntry: (
    code: string,
    modelUrls?: string[],
    userPrompt?: string
  ) => void;

  // 版本回溯功能
  getHistoryEntries: () => HistoryEntry[];
  revertToVersion: (index: number) => Promise<boolean>;
  deleteHistoryEntry: (index: number) => void;
  clearHistory: () => void;
  getCurrentVersion: () => number;
  saveCurrentState: () => void; // 保存当前物体状态

  // 撤回/重做功能
  undoLastChange: () => Promise<boolean>;
  redoLastChange: () => Promise<boolean>;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // 物体变换历史记录
  addTransformSnapshot: (description?: string) => void;
  undoLastTransform: () => boolean;

  // 错误处理方法
  addError: (error: string) => void; // 添加错误
  setErrors: (errors: string[]) => void; // 设置错误数组
  clearErrors: () => void; // 清空错误

  // 对象注册方法
  registerObject: (
    object: Object3D,
    type?: string,
    metadata?: Record<string, unknown>
  ) => string;
  unregisterObject: (uuid: string) => void;
  getObjectByUuid: (uuid: string) => Object3D | null;
  getRegistryEntry: (uuid: string) => ObjectRegistryEntry | null;

  // 对象状态管理
  updateObjectState: (uuid: string) => void;
  applyObjectState: (uuid: string, state: Partial<ObjectState>) => void;
  updateAllObjectStates: () => void; // 批量更新所有对象状态

  // 代码映射管理
  mapCodeToObjects: (codeSnippet: string, objectUuids: string[]) => void;
  getObjectsByCode: (codeSnippet: string) => string[];

  // 场景差异管理
  getSceneSnapshot: () => SceneSnapshot;
  applySceneSnapshot: (snapshot: SceneSnapshot) => void;
  serializeSceneState: () => Record<string, unknown>[];

  // 场景查询功能
  findObjectsByType: (type: string) => string[];
  getAllObjects: () => Map<string, ObjectRegistryEntry>;
  getVisibleObjects: () => string[];

  // 持久化方法 - 增强版本
  saveSceneToStorage: () => void;
  loadSceneFromStorage: () => PersistedSceneData | null;
  hasStoredScene: () => boolean;
  // 新增：完整页面状态保存和恢复
  savePageStateToStorage: () => void;
  loadPageStateFromStorage: () => boolean;
  restoreCompleteState: () => Promise<boolean>;
}

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

// 持久化相关常量
const SCENE_STORAGE_KEY = "threejs_scene_state";

export const useSceneStore = create<SceneState>((set, get) => ({
  scene: null,
  dynamicGroup: null,
  historyCode: [],
  selectedObject: null,
  errors: [], // 初始化为空数组
  history: [], // 初始化历史记录数组
  transformHistory: [], // 初始化变换历史记录数组
  currentTransformIndex: -1, // 初始化变换历史索引
  isDraggingOrSelecting: false, // 初始化为false

  // 初始化对象注册表和状态映射
  objectRegistry: new Map(),
  objectStates: new Map(),
  codeToObjectMap: new Map(),

  // 新增：UI状态持久化
  currentCode: "",
  currentPrompt: "",
  isGenerating: false,
  renderingComplete: true,
  modelUrls: [], // 初始化为空数组

  // 原有方法
  setScene: (scene: Scene) => set({ scene }),
  setDynamicGroup: (group: Group) => set({ dynamicGroup: group }),
  addToHistory: (code: string) =>
    set((state: SceneState) => ({
      historyCode: [...state.historyCode, code],
    })),
  selectObject: (object: Object3D | null) => set({ selectedObject: object }),
  setIsDraggingOrSelecting: (value: boolean) =>
    set({ isDraggingOrSelecting: value }),

  // 新增：UI状态管理
  setCurrentCode: (code: string) => set({ currentCode: code }),
  setCurrentPrompt: (prompt: string) => set({ currentPrompt: prompt }),
  setIsGenerating: (generating: boolean) => set({ isGenerating: generating }),
  setRenderingComplete: (complete: boolean) =>
    set({ renderingComplete: complete }),
  setModelUrls: (urls: string[]) => set({ modelUrls: urls }),

  // 错误处理方法
  addError: (error: string) =>
    set((state: SceneState) => ({
      errors: [...state.errors, error],
    })),
  setErrors: (errors: string[]) => set({ errors }),
  clearErrors: () => set({ errors: [] }),

  // 简化的历史记录管理方法
  addHistoryEntry: (
    code: string,
    modelUrls?: string[],
    userPrompt?: string
  ) => {
    const state = get();
    const sceneSnapshot = state.getSceneSnapshot();

    const newEntry: HistoryEntry = {
      code,
      sceneState: sceneSnapshot,
      timestamp: new Date().toISOString(),
      modelUrls,
      userPrompt, // 添加用户需求
    };

    // 简单地追加历史记录
    set({
      history: [...state.history, newEntry],
    });

    return newEntry;
  },

  // 对象注册方法
  registerObject: (
    object: Object3D,
    type?: string,
    metadata?: Record<string, unknown>
  ) => {
    // Skip registering transform controls
    if (object.userData.isTransformControl) {
      return object.uuid;
    }

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
      // Skip children of transform controls
      if (!object.userData.isTransformControl) {
        get().registerObject(child);
      }
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

    // 增强：递归更新模型对象的所有子对象的状态
    const isModel =
      obj.userData &&
      (obj.userData.modelId ||
        obj.userData.isModelObject ||
        obj.userData.isPersistentModel ||
        obj.userData.originalModelUrl ||
        obj.name === "Superman");

    if (isModel) {
      console.log(
        `更新模型状态: ${obj.name || "unnamed model"}, uuid: ${uuid}`
      );

      // 递归处理所有子对象，确保整个模型的状态都被更新
      obj.traverse((child) => {
        if (child !== obj) {
          // 确保子对象继承父对象的模型标识
          if (!child.userData) child.userData = {};
          child.userData.parentModelId = obj.userData.modelId;

          // 为子对象更新状态
          const childUuid = child.uuid;
          const childEntry = registry.get(childUuid);

          if (childEntry) {
            states.set(childUuid, extractObjectState(child));
            childEntry.lastUpdated = new Date();
            childEntry.isVisible = child.visible;
            registry.set(childUuid, childEntry);
          } else if (child instanceof Mesh) {
            // 如果子对象未注册但是重要的网格，则注册它
            get().registerObject(child, "modelMesh", {
              parentModelId: obj.userData.modelId,
              isModelPart: true,
            });
          }
        }
      });
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
    const state = get();
    const objectStates: Record<string, ObjectState> = {};
    const objectTypes: Record<string, string> = {};

    state.objectRegistry.forEach((entry, uuid) => {
      objectStates[uuid] = extractObjectState(entry.object);
      objectTypes[uuid] = entry.type;
    });

    return {
      objectStates,
      objectTypes,
      createdAt: new Date().toISOString(),
    };
  },

  applySceneSnapshot: (snapshot: SceneSnapshot) => {
    const state = get();

    // 应用状态到所有存在的对象
    Object.entries(snapshot.objectStates).forEach(([uuid, objState]) => {
      const obj = state.getObjectByUuid(uuid);
      if (obj) {
        state.applyObjectState(uuid, objState);
      }
    });

    // 应用完成后批量更新状态缓存
    state.updateAllObjectStates();
  },

  // 序列化场景状态，用于API调用
  serializeSceneState: () => {
    const state = get();
    const dynamicGroup = state.dynamicGroup;

    if (!dynamicGroup) {
      return [];
    }

    // 在序列化前先更新所有对象状态，确保获得最新位置
    state.updateAllObjectStates();

    // 定义包含modelUrl的类型，并确保它也是Record<string, unknown>的扩展
    interface SerializedObject extends Record<string, unknown> {
      id: string;
      name: string;
      type: string;
      position: number[];
      rotation: number[];
      scale: number[];
      isVisible: boolean;
      metadata?: Record<string, unknown>;
      modelUrl?: string;
    }

    const serializedObjects: SerializedObject[] = [];

    // 递归处理组中的所有对象
    const processObject = (obj: Object3D) => {
      const registry = state.getRegistryEntry(obj.uuid);

      if (registry) {
        // 优先使用实时提取的状态，确保是最新的
        const objState = extractObjectState(obj);

        // 只创建包含基本元数据的对象
        const baseObject: SerializedObject = {
          id: obj.uuid,
          name: registry.name,
          type: registry.type,
          position: [
            objState.position.x,
            objState.position.y,
            objState.position.z,
          ],
          rotation: [
            objState.rotation.x,
            objState.rotation.y,
            objState.rotation.z,
          ],
          scale: [objState.scale.x, objState.scale.y, objState.scale.z],
          isVisible: registry.isVisible,
          metadata: registry.metadata,
        };

        // 只添加模型URL，而不是完整的几何数据
        if (registry.metadata?.modelUrl) {
          baseObject.modelUrl = registry.metadata.modelUrl as string;
        } else if (
          obj.userData?.modelUrl ||
          obj.userData?.originalModelUrl ||
          obj.userData?.url
        ) {
          baseObject.modelUrl = (obj.userData?.modelUrl ||
            obj.userData?.originalModelUrl ||
            obj.userData?.url) as string;
        }

        serializedObjects.push(baseObject);

        // 调试日志：记录序列化的对象位置
        console.log(`序列化对象 ${registry.name}:`, {
          id: obj.uuid,
          position: baseObject.position,
          type: registry.type,
        });
      }

      // 递归处理子对象
      obj.children.forEach((child) => processObject(child));
    };

    // 从动态组开始处理
    dynamicGroup.children.forEach((child) => processObject(child));

    console.log(`场景序列化完成，共 ${serializedObjects.length} 个对象`);
    return serializedObjects;
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
    return get().objectRegistry;
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

  // 组合对象相关方法
  createGroup: (objects: Object3D[], name?: string) => {
    const group = new Group();

    // 设置名称
    group.name = name || `Group_${Date.now()}`;

    // 添加对象到组
    objects.forEach((obj) => {
      // 保存原始位置
      const worldPosition = new Vector3();
      const worldQuaternion = new Quaternion();
      const worldScale = new Vector3();

      // 获取对象的世界变换
      obj.getWorldPosition(worldPosition);
      obj.getWorldQuaternion(worldQuaternion);
      obj.getWorldScale(worldScale);

      // 从原始父级移除
      if (obj.parent) {
        obj.parent.remove(obj);
      }

      // 添加到新组
      group.add(obj);

      // 重置对象的世界变换以保持外观不变
      obj.position.copy(worldPosition);
      obj.position.sub(group.position);
      obj.quaternion.copy(worldQuaternion);
      obj.scale.copy(worldScale);
    });

    // 添加组到动态组而不是场景，确保组可以被选择
    const { dynamicGroup } = get();
    if (dynamicGroup) {
      dynamicGroup.add(group);
    }

    // 注册组
    get().registerObject(group, "group");

    console.log(`创建新组 "${group.name}" 包含 ${objects.length} 个对象`);
    return group;
  },

  addToGroup: (group: Group, object: Object3D) => {
    const worldPosition = new Vector3();
    const worldQuaternion = new Quaternion();
    const worldScale = new Vector3();

    // 获取对象的世界变换
    object.getWorldPosition(worldPosition);
    object.getWorldQuaternion(worldQuaternion);
    object.getWorldScale(worldScale);

    // 从原始父级移除
    if (object.parent) {
      object.parent.remove(object);
    }

    // 添加到组
    group.add(object);

    // 重置对象的位置以保持外观不变
    object.position.copy(worldPosition);
    object.position.sub(group.position);
    object.quaternion.copy(worldQuaternion);
    object.scale.copy(worldScale);

    // 更新组的状态
    get().updateObjectState(group.uuid);

    console.log(
      `对象 "${object.name || object.uuid}" 已添加到组 "${group.name}"`
    );
  },

  removeFromGroup: (group: Group, object: Object3D) => {
    const worldPosition = new Vector3();
    const worldQuaternion = new Quaternion();
    const worldScale = new Vector3();

    // 获取对象的世界变换
    object.getWorldPosition(worldPosition);
    object.getWorldQuaternion(worldQuaternion);
    object.getWorldScale(worldScale);

    // 从组中移除
    group.remove(object);

    // 添加到动态组而不是场景，确保对象可以被选择
    const { dynamicGroup } = get();
    if (dynamicGroup) {
      dynamicGroup.add(object);

      // 重置对象的世界变换以保持外观不变
      object.position.copy(worldPosition);
      object.quaternion.copy(worldQuaternion);
      object.scale.copy(worldScale);
    }

    // 更新组和对象的状态
    get().updateObjectState(group.uuid);
    get().updateObjectState(object.uuid);

    console.log(
      `对象 "${object.name || object.uuid}" 已从组 "${group.name}" 移除`
    );
  },

  ungroupObjects: (group: Group) => {
    const removedObjects: Object3D[] = [];
    const { dynamicGroup } = get();

    if (!dynamicGroup) {
      console.warn("动态组不存在，无法解组");
      return removedObjects;
    }

    // 复制子对象数组，因为我们将修改它
    const children = [...group.children];

    children.forEach((child) => {
      const worldPosition = new Vector3();
      const worldQuaternion = new Quaternion();
      const worldScale = new Vector3();

      // 获取对象的世界变换
      child.getWorldPosition(worldPosition);
      child.getWorldQuaternion(worldQuaternion);
      child.getWorldScale(worldScale);

      // 从组中移除
      group.remove(child);

      // 添加到动态组而不是场景，确保对象可以被选择
      dynamicGroup.add(child);

      // 重置对象的世界变换以保持外观不变
      child.position.copy(worldPosition);
      child.quaternion.copy(worldQuaternion);
      child.scale.copy(worldScale);

      // 更新对象状态
      get().updateObjectState(child.uuid);

      removedObjects.push(child);
    });

    // 从动态组中移除空组
    dynamicGroup.remove(group);
    get().unregisterObject(group.uuid);

    console.log(
      `组 "${group.name}" 已解组，${removedObjects.length} 个对象已移至动态组`
    );
    return removedObjects;
  },

  // 保存场景到localStorage
  saveSceneToStorage: () => {
    try {
      const state = get();
      const sceneSnapshot = state.getSceneSnapshot();

      // 收集所有模型URL
      const modelUrls: string[] = [];
      state.objectRegistry.forEach((entry) => {
        if (entry.metadata?.modelUrl) {
          modelUrls.push(entry.metadata.modelUrl as string);
        }
        if (entry.object.userData?.originalModelUrl) {
          modelUrls.push(entry.object.userData.originalModelUrl);
        }
        if (entry.object.userData?.modelUrl) {
          modelUrls.push(entry.object.userData.modelUrl);
        }
      });

      const persistedData: PersistedSceneData = {
        sceneSnapshot,
        modelUrls: [...new Set(modelUrls)], // 去重
        timestamp: new Date().toISOString(),
        version: "1.0",
        // 新增：代码和UI状态
        currentCode: state.currentCode,
        currentPrompt: state.currentPrompt,
        historyEntries: state.history,
        errors: state.errors,
        selectedObjectId: state.selectedObject?.uuid || null,
        // 新增：页面状态
        pageState: {
          isGenerating: state.isGenerating,
          lastGenerateTime:
            state.history.length > 0
              ? state.history[state.history.length - 1].timestamp
              : undefined,
          renderingComplete: state.renderingComplete,
        },
      };

      localStorage.setItem(SCENE_STORAGE_KEY, JSON.stringify(persistedData));

      console.log("场景状态已保存到localStorage", {
        objects: Object.keys(sceneSnapshot.objectStates).length,
        models: modelUrls.length,
      });
    } catch (error) {
      console.error("保存场景状态失败:", error);
    }
  },

  // 从localStorage加载场景
  loadSceneFromStorage: () => {
    try {
      const storedData = localStorage.getItem(SCENE_STORAGE_KEY);

      if (!storedData) {
        console.log("没有找到保存的场景状态");
        return null;
      }

      const persistedData: PersistedSceneData = JSON.parse(storedData);

      console.log("找到保存的场景状态", {
        objects: Object.keys(persistedData.sceneSnapshot.objectStates).length,
        models: persistedData.modelUrls.length,
        timestamp: persistedData.timestamp,
      });

      return persistedData;
    } catch (error) {
      console.error("加载场景状态失败:", error);
      return null;
    }
  },

  // 检查是否有存储的场景
  hasStoredScene: () => {
    return localStorage.getItem(SCENE_STORAGE_KEY) !== null;
  },

  // 版本回溯功能
  getHistoryEntries: () => {
    return get().history;
  },

  revertToVersion: async (index: number) => {
    const state = get();
    const history = state.history;

    if (index < 0 || index >= history.length) {
      console.warn("无效的历史记录索引");
      return false;
    }

    try {
      const targetEntry = history[index];

      console.log(`开始恢复到版本 ${index + 1}`);

      // 应用目标版本的场景快照
      state.applySceneSnapshot(targetEntry.sceneState);

      // 确保所有对象状态已更新
      state.updateAllObjectStates();

      // 如果需要重新执行代码，可以在这里添加逻辑
      // 但为了保持历史回溯功能不变，我们只恢复状态

      console.log(`成功恢复到版本 ${index + 1}`, {
        objects: Object.keys(targetEntry.sceneState.objectStates).length,
        timestamp: targetEntry.timestamp,
      });

      return true;
    } catch (error) {
      console.error("版本恢复失败:", error);
      return false;
    }
  },

  deleteHistoryEntry: (index: number) => {
    const state = get();
    const history = state.history;

    if (index < 0 || index >= history.length) {
      console.warn("无效的历史记录索引");
      return;
    }

    const newHistory = history.filter((_, i) => i !== index);
    set({ history: newHistory });
  },

  clearHistory: () => {
    set({ history: [] });
  },

  getCurrentVersion: () => {
    const state = get();
    return state.history.length - 1;
  },

  // 撤回/重做功能
  undoLastChange: async () => {
    const state = get();
    const currentVersion = state.getCurrentVersion();

    if (currentVersion > 0) {
      const previousVersion = currentVersion - 1;
      console.log(`撤回到版本 ${previousVersion + 1}`);
      return await state.revertToVersion(previousVersion);
    }

    console.warn("没有可撤回的操作");
    return false;
  },

  redoLastChange: async () => {
    const state = get();
    const currentVersion = state.getCurrentVersion();
    const totalVersions = state.history.length;

    if (currentVersion < totalVersions - 1) {
      const nextVersion = currentVersion + 1;
      console.log(`重做到版本 ${nextVersion + 1}`);
      return await state.revertToVersion(nextVersion);
    }

    console.warn("没有可重做的操作");
    return false;
  },

  canUndo: () => {
    const state = get();
    return state.getCurrentVersion() > 0;
  },

  canRedo: () => {
    const state = get();
    const currentVersion = state.getCurrentVersion();
    return currentVersion < state.history.length - 1;
  },

  // 物体变换历史记录
  addTransformSnapshot: (description = "物体变换") => {
    const state = get();

    // 更新所有对象状态
    state.updateAllObjectStates();

    // 获取当前场景快照
    const snapshot = state.getSceneSnapshot();
    snapshot.createdAt = new Date().toISOString();

    // 如果当前不在历史末尾，清除后续历史
    const newHistory = state.transformHistory.slice(
      0,
      state.currentTransformIndex + 1
    );
    newHistory.push(snapshot);

    // 限制历史记录数量（最多保留20个）
    const maxHistory = 20;
    if (newHistory.length > maxHistory) {
      newHistory.shift();
    } else {
      set({ currentTransformIndex: state.currentTransformIndex + 1 });
    }

    set({ transformHistory: newHistory });

    console.log(
      `已保存变换快照: ${description}，历史数量: ${newHistory.length}`
    );
  },

  undoLastTransform: () => {
    const state = get();

    if (state.currentTransformIndex > 0) {
      const previousIndex = state.currentTransformIndex - 1;
      const previousSnapshot = state.transformHistory[previousIndex];

      if (previousSnapshot) {
        // 应用之前的快照
        state.applySceneSnapshot(previousSnapshot);

        set({ currentTransformIndex: previousIndex });

        console.log(`已撤回到变换历史索引: ${previousIndex}`);
        return true;
      }
    }

    console.warn("没有可撤回的变换操作");
    return false;
  },

  // 新增：批量更新所有对象状态
  updateAllObjectStates: () => {
    const state = get();
    const registry = state.objectRegistry;
    const states = state.objectStates;

    registry.forEach((entry, uuid) => {
      const obj = entry.object;
      if (obj) {
        states.set(uuid, extractObjectState(obj));
        entry.lastUpdated = new Date();
        entry.isVisible = obj.visible;
      }
    });

    set({
      objectStates: new Map(states),
      objectRegistry: new Map(registry),
    });
  },

  // 新增：保存当前状态到最新的历史记录
  saveCurrentState: () => {
    const state = get();
    const history = state.history;

    if (history.length === 0) {
      return; // 没有历史记录时不执行
    }

    // 更新所有对象的状态
    state.updateAllObjectStates();

    // 获取当前场景快照
    const currentSnapshot = state.getSceneSnapshot();

    // 更新最新的历史记录条目中的场景状态
    const latestIndex = history.length - 1;
    const latestEntry = history[latestIndex];

    if (latestEntry) {
      // 创建新的历史记录条目，保持代码不变但更新场景状态
      const updatedEntry: HistoryEntry = {
        ...latestEntry,
        sceneState: currentSnapshot,
        timestamp: new Date().toISOString(), // 更新时间戳
      };

      // 更新历史记录
      const newHistory = [...history];
      newHistory[latestIndex] = updatedEntry;

      set({ history: newHistory });

      console.log("当前物体状态已保存到历史记录");

      // 同时保存到 localStorage 以确保刷新后能恢复
      state.savePageStateToStorage();
    }
  },

  // 新增：删除物体方法
  deleteObject: (object: Object3D) => {
    const state = get();

    if (!object || !object.parent) {
      console.warn("无法删除无效的对象");
      return;
    }

    const registry = state.objectRegistry;
    const states = state.objectStates;

    console.log(`开始删除对象: ${object.name || object.uuid}`);

    // 递归删除所有子对象
    const deleteRecursive = (obj: Object3D) => {
      // 先删除所有子对象
      const children = [...obj.children];
      children.forEach((child) => {
        deleteRecursive(child);
      });

      // 从注册表中移除
      registry.delete(obj.uuid);
      // 从状态映射中移除
      states.delete(obj.uuid);

      // 从父级移除
      if (obj.parent) {
        obj.parent.remove(obj);
      }

      console.log(`已删除对象: ${obj.name || obj.uuid}`);
    };

    // 执行递归删除
    deleteRecursive(object);

    // 如果删除的是当前选中的对象，清除选择
    if (state.selectedObject && state.selectedObject.uuid === object.uuid) {
      state.selectObject(null);
    }

    // 更新注册表和状态映射
    set({
      objectRegistry: new Map(registry),
      objectStates: new Map(states),
    });

    // 保存当前状态到历史记录
    state.saveCurrentState();

    console.log(`对象删除完成，剩余对象数量: ${registry.size}`);
  },

  // 新增：完整页面状态保存和恢复
  savePageStateToStorage: () => {
    const state = get();
    const persistedData: PersistedSceneData = {
      sceneSnapshot: state.getSceneSnapshot(),
      modelUrls: [...new Set(state.modelUrls)],
      timestamp: new Date().toISOString(),
      version: "1.0",
      currentCode: state.currentCode,
      currentPrompt: state.currentPrompt,
      historyEntries: state.history,
      errors: state.errors,
      selectedObjectId: state.selectedObject?.uuid || null,
      pageState: {
        isGenerating: state.isGenerating,
        lastGenerateTime:
          state.history.length > 0
            ? state.history[state.history.length - 1].timestamp
            : undefined,
        renderingComplete: state.renderingComplete,
      },
    };

    localStorage.setItem(SCENE_STORAGE_KEY, JSON.stringify(persistedData));

    console.log("页面状态已保存到localStorage", {
      objects: Object.keys(state.getSceneSnapshot().objectStates).length,
      models: state.modelUrls.length,
    });
  },

  loadPageStateFromStorage: () => {
    try {
      const storedData = localStorage.getItem(SCENE_STORAGE_KEY);

      if (!storedData) {
        console.log("没有找到保存的页面状态");
        return false;
      }

      const persistedData: PersistedSceneData = JSON.parse(storedData);

      console.log("找到保存的页面状态", {
        objects: Object.keys(persistedData.sceneSnapshot.objectStates).length,
        models: persistedData.modelUrls.length,
        timestamp: persistedData.timestamp,
      });

      const state = get();

      // 安全地恢复状态，使用可选链和默认值
      if (persistedData.currentCode) {
        state.setCurrentCode(persistedData.currentCode);
      }
      if (persistedData.currentPrompt) {
        state.setCurrentPrompt(persistedData.currentPrompt);
      }

      // 恢复页面状态
      if (persistedData.pageState) {
        state.setIsGenerating(persistedData.pageState.isGenerating || false);
        state.setRenderingComplete(
          persistedData.pageState.renderingComplete || true
        );
      }

      // 恢复其他状态
      if (persistedData.errors) {
        state.setErrors(persistedData.errors);
      }
      if (persistedData.selectedObjectId) {
        const selectedObj = state.getObjectByUuid(
          persistedData.selectedObjectId
        );
        if (selectedObj) {
          state.selectObject(selectedObj);
        }
      }
      if (persistedData.historyEntries) {
        set({ history: persistedData.historyEntries });
      }
      if (persistedData.modelUrls) {
        state.setModelUrls(persistedData.modelUrls);
      }

      return true;
    } catch (error) {
      console.error("加载页面状态失败:", error);
      return false;
    }
  },

  restoreCompleteState: async () => {
    return new Promise<boolean>((resolve) => {
      try {
        const state = get();
        const persistedData = state.loadSceneFromStorage();

        if (!persistedData) {
          console.log("没有找到保存的完整状态");
          resolve(false);
          return;
        }

        // 安全地恢复状态，使用可选链和默认值
        if (persistedData.currentCode) {
          state.setCurrentCode(persistedData.currentCode);
        }
        if (persistedData.currentPrompt) {
          state.setCurrentPrompt(persistedData.currentPrompt);
        }

        // 恢复页面状态
        if (persistedData.pageState) {
          state.setIsGenerating(persistedData.pageState.isGenerating || false);
          state.setRenderingComplete(
            persistedData.pageState.renderingComplete || true
          );
        }

        // 恢复其他状态
        if (persistedData.errors) {
          state.setErrors(persistedData.errors);
        }
        if (persistedData.selectedObjectId) {
          const selectedObj = state.getObjectByUuid(
            persistedData.selectedObjectId
          );
          if (selectedObj) {
            state.selectObject(selectedObj);
          }
        }
        if (persistedData.historyEntries) {
          set({ history: persistedData.historyEntries });
        }
        if (persistedData.modelUrls) {
          state.setModelUrls(persistedData.modelUrls);
        }

        // 应用场景快照
        if (persistedData.sceneSnapshot) {
          state.applySceneSnapshot(persistedData.sceneSnapshot);
        }

        console.log("完整状态恢复成功");
        resolve(true);
      } catch (error) {
        console.error("恢复完整状态失败:", error);
        resolve(false);
      }
    });
  },
}));
