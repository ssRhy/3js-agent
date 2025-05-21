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

interface SceneState {
  scene: Scene | null;
  dynamicGroup: Group | null; // 动态组，用于管理AI生成的对象
  historyCode: string[];
  selectedObject: Object3D | null;
  errors: string[]; // 添加错误跟踪数组
  history: HistoryEntry[]; // 历史记录数组
  isDraggingOrSelecting: boolean; // 添加物体操作模式状态

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

  // 组合对象相关方法
  createGroup: (objects: Object3D[], name?: string) => Group; // 创建一个新组
  addToGroup: (group: Group, object: Object3D) => void; // 添加对象到组
  removeFromGroup: (group: Group, object: Object3D) => void; // 从组中移除对象
  ungroupObjects: (group: Group) => Object3D[]; // 解组

  // 历史记录管理
  addHistoryEntry: (code: string, modelUrls?: string[]) => void;

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

export const useSceneStore = create<SceneState>((set, get) => ({
  scene: null,
  dynamicGroup: null,
  historyCode: [],
  selectedObject: null,
  errors: [], // 初始化为空数组
  history: [], // 初始化历史记录数组
  isDraggingOrSelecting: false, // 初始化为false

  // 初始化对象注册表和状态映射
  objectRegistry: new Map(),
  objectStates: new Map(),
  codeToObjectMap: new Map(),

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

  // 错误处理方法
  addError: (error: string) =>
    set((state: SceneState) => ({
      errors: [...state.errors, error],
    })),
  setErrors: (errors: string[]) => set({ errors }),
  clearErrors: () => set({ errors: [] }),

  // 简化的历史记录管理方法
  addHistoryEntry: (code: string, modelUrls?: string[]) => {
    const state = get();
    const sceneSnapshot = state.getSceneSnapshot();

    const newEntry: HistoryEntry = {
      code,
      sceneState: sceneSnapshot,
      timestamp: new Date().toISOString(),
      modelUrls,
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
  },

  // 序列化场景状态，用于API调用
  serializeSceneState: () => {
    const state = get();
    const dynamicGroup = state.dynamicGroup;

    if (!dynamicGroup) {
      return [];
    }

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
        const objState =
          state.objectStates.get(obj.uuid) || extractObjectState(obj);

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
      }

      // 递归处理子对象
      obj.children.forEach((child) => processObject(child));
    };

    // 从动态组开始处理
    dynamicGroup.children.forEach((child) => processObject(child));

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

    // 添加组到场景
    const { scene } = get();
    if (scene) {
      scene.add(group);
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

    // 添加到场景
    const { scene } = get();
    if (scene) {
      scene.add(object);

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
    const { scene } = get();

    if (!scene) {
      console.warn("场景不存在，无法解组");
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

      // 添加到场景
      scene.add(child);

      // 重置对象的世界变换以保持外观不变
      child.position.copy(worldPosition);
      child.quaternion.copy(worldQuaternion);
      child.scale.copy(worldScale);

      // 更新对象状态
      get().updateObjectState(child.uuid);

      removedObjects.push(child);
    });

    // 从场景中移除空组
    scene.remove(group);
    get().unregisterObject(group.uuid);

    console.log(
      `组 "${group.name}" 已解组，${removedObjects.length} 个对象已移至场景`
    );
    return removedObjects;
  },
}));
