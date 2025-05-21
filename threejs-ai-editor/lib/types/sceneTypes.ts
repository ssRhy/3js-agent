// 场景相关类型定义

// 场景对象接口
export interface SceneStateObject {
  id: string;
  type: string;
  name?: string;
  position?: number[];
  rotation?: number[];
  scale?: number[];
  isVisible?: boolean;
  modelUrl?: string;
  metadata?: Record<string, unknown>;
}

// 场景对象注册表项接口
export interface SceneObjectRegistryItem {
  id: string;
  type: string;
  name: string;
  createdAt: string;
  lastUpdated: string;
  isVisible: boolean;
  metadata?: Record<string, unknown>;
}

// 场景历史条目接口
export interface SceneHistoryEntry {
  timestamp: string;
  prompt: string;
  objectCount: number;
  objects: SceneStateObject[];
}

// 模型历史条目接口
export interface ModelHistoryEntry {
  timestamp: string;
  modelUrl: string;
  prompt?: string;
}

// 场景状态接口
export interface SceneState {
  objects: SceneStateObject[];
  lastUpdateTimestamp: string;
}

// 场景差异接口
export interface SceneDiff {
  added: SceneStateObject[];
  removed: string[];
  modified: SceneStateObject[];
}

// 模型生成结果接口
export interface ModelGenResult {
  success: boolean;
  modelUrl?: string;
  message?: string;
}
