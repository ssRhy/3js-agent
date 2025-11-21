import { create } from "zustand";
import { SceneSnapshot } from "./useSceneStore";

// 聊天消息类型
export interface ChatMessage {
  id: string;
  type: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  metadata?: {
    tokens?: number;
    model?: string;
    [key: string]: unknown;
  };
}

// 代码快照接口
export interface CodeSnapshot {
  id: string;
  files: Record<
    string,
    {
      content: string;
      language: string;
      cursor?: {
        line: number;
        column: number;
      };
    }
  >;
  openFiles: string[];
  activeFile?: string;
  timestamp: string;
  description?: string;
}

// 版本节点接口 - 包含聊天上下文和代码状态
export interface VersionNode {
  id: string;
  parentId?: string;
  timestamp: string;
  title: string;
  description?: string;

  // 聊天上下文
  chatHistory: ChatMessage[];

  // 代码状态
  codeSnapshot: CodeSnapshot;

  // 3D场景状态
  sceneSnapshot?: SceneSnapshot;

  // AI交互元数据
  aiMetadata?: {
    prompt: string;
    response?: string;
    model?: string;
    tokens?: number;
    duration?: number;
  };

  // 变更信息
  changes?: {
    type: "ai_generated" | "manual_edit" | "restore" | "branch";
    filesChanged: string[];
    linesAdded: number;
    linesRemoved: number;
    summary?: string;
  };
}

// 分支信息
export interface Branch {
  id: string;
  name: string;
  description?: string;
  headNodeId: string;
  createdAt: string;
  lastModified: string;
  color?: string;
}

// 历史管理状态接口
interface HistoryState {
  // 当前状态
  currentNodeId: string | null;
  currentBranchId: string;

  // 版本树
  nodes: Map<string, VersionNode>;
  branches: Map<string, Branch>;

  // 临时状态管理
  pendingSnapshot: Partial<CodeSnapshot> | null;
  isCapturingSnapshot: boolean;

  // UI状态
  isHistoryPanelOpen: boolean;
  selectedNodeId: string | null;
  searchQuery: string;
  filterType: "all" | "ai" | "manual" | "restore";

  // 核心操作
  createSnapshot: (
    description?: string,
    aiMetadata?: VersionNode["aiMetadata"]
  ) => Promise<string>;

  createBranch: (name: string, fromNodeId?: string) => string;
  switchToBranch: (branchId: string) => Promise<boolean>;
  switchToNode: (nodeId: string) => Promise<boolean>;

  // 聊天历史管理
  addChatMessage: (message: Omit<ChatMessage, "id" | "timestamp">) => void;
  getChatHistory: (nodeId?: string) => ChatMessage[];

  // 快照管理
  updatePendingSnapshot: (changes: Partial<CodeSnapshot>) => void;
  commitPendingSnapshot: (description?: string) => Promise<string>;
  discardPendingSnapshot: () => void;

  // 查询和导航
  getNodeHistory: (nodeId?: string) => VersionNode[];
  getNodeParents: (nodeId: string) => VersionNode[];
  getNodeChildren: (nodeId: string) => VersionNode[];
  getBranchNodes: (branchId: string) => VersionNode[];

  // 比较和差异
  compareNodes: (
    nodeId1: string,
    nodeId2: string
  ) => {
    filesChanged: string[];
    additions: number;
    deletions: number;
    details: Record<
      string,
      {
        type: "added" | "removed" | "modified";
        oldContent?: string;
        newContent?: string;
      }
    >;
  };

  // 搜索和过滤
  searchNodes: (query: string) => VersionNode[];
  filterNodes: (filter: HistoryState["filterType"]) => VersionNode[];

  // UI状态管理
  setHistoryPanelOpen: (open: boolean) => void;
  setSelectedNode: (nodeId: string | null) => void;
  setSearchQuery: (query: string) => void;
  setFilterType: (filter: HistoryState["filterType"]) => void;

  // 持久化
  saveToStorage: () => void;
  loadFromStorage: () => boolean;
  exportHistory: () => string;
  importHistory: (data: string) => boolean;

  // 清理和维护
  pruneOldNodes: (keepCount: number) => void;
  compactHistory: () => void;
  deleteNode: (nodeId: string) => void;
  deleteBranch: (branchId: string) => void;
}

const HISTORY_STORAGE_KEY = "threejs-ai-editor-history";
const MAX_HISTORY_NODES = 1000;

export const useHistoryStore = create<HistoryState>()((set, get) => ({
  // 初始状态
  currentNodeId: null,
  currentBranchId: "main",
  nodes: new Map(),
  branches: new Map([
    [
      "main",
      {
        id: "main",
        name: "主分支",
        description: "主要开发分支",
        headNodeId: "",
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        color: "#3b82f6",
      },
    ],
  ]),

  pendingSnapshot: null,
  isCapturingSnapshot: false,

  isHistoryPanelOpen: false,
  selectedNodeId: null,
  searchQuery: "",
  filterType: "all",

  // 创建快照
  createSnapshot: async (description, aiMetadata) => {
    const state = get();
    const nodeId = `node_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    set({ isCapturingSnapshot: true });

    try {
      // 获取当前代码状态 (这里需要从编辑器组件获取)
      const codeSnapshot: CodeSnapshot = {
        id: `snapshot_${Date.now()}`,
        files: state.pendingSnapshot?.files || {},
        openFiles: state.pendingSnapshot?.openFiles || [],
        activeFile: state.pendingSnapshot?.activeFile,
        timestamp: new Date().toISOString(),
        description,
      };

      // 获取聊天历史 (基于当前节点)
      const currentChatHistory = state.currentNodeId
        ? state.nodes.get(state.currentNodeId)?.chatHistory || []
        : [];

      const newNode: VersionNode = {
        id: nodeId,
        parentId: state.currentNodeId || undefined,
        timestamp: new Date().toISOString(),
        title: description || `版本 ${state.nodes.size + 1}`,
        description,
        chatHistory: [...currentChatHistory],
        codeSnapshot,
        aiMetadata,
        changes: {
          type: aiMetadata ? "ai_generated" : "manual_edit",
          filesChanged: Object.keys(codeSnapshot.files),
          linesAdded: 0, // 需要计算
          linesRemoved: 0, // 需要计算
          summary: description,
        },
      };

      // 更新节点树
      const newNodes = new Map(state.nodes);
      newNodes.set(nodeId, newNode);

      // 更新当前分支
      const currentBranch = state.branches.get(state.currentBranchId);
      if (currentBranch) {
        const updatedBranches = new Map(state.branches);
        updatedBranches.set(state.currentBranchId, {
          ...currentBranch,
          headNodeId: nodeId,
          lastModified: new Date().toISOString(),
        });

        set({
          nodes: newNodes,
          branches: updatedBranches,
          currentNodeId: nodeId,
          pendingSnapshot: null,
        });
      }

      // 保存到存储
      state.saveToStorage();

      return nodeId;
    } finally {
      set({ isCapturingSnapshot: false });
    }
  },

  // 创建分支
  createBranch: (name, fromNodeId) => {
    const state = get();
    const branchId = `branch_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    const sourceNodeId = fromNodeId || state.currentNodeId;

    if (!sourceNodeId) {
      throw new Error("无法创建分支：没有源节点");
    }

    const newBranch: Branch = {
      id: branchId,
      name,
      description: `从节点 ${sourceNodeId} 创建的分支`,
      headNodeId: sourceNodeId,
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      color: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
    };

    const updatedBranches = new Map(state.branches);
    updatedBranches.set(branchId, newBranch);

    set({ branches: updatedBranches });
    state.saveToStorage();

    return branchId;
  },

  // 切换到分支
  switchToBranch: async (branchId) => {
    const state = get();
    const branch = state.branches.get(branchId);

    if (!branch) {
      console.error("分支不存在:", branchId);
      return false;
    }

    const headNode = state.nodes.get(branch.headNodeId);
    if (!headNode) {
      console.error("分支头节点不存在:", branch.headNodeId);
      return false;
    }

    // 应用分支头节点的状态
    const success = await state.switchToNode(branch.headNodeId);
    if (success) {
      set({ currentBranchId: branchId });
      return true;
    }

    return false;
  },

  // 切换到节点
  switchToNode: async (nodeId) => {
    const state = get();
    const node = state.nodes.get(nodeId);

    if (!node) {
      console.error("节点不存在:", nodeId);
      return false;
    }

    try {
      // 这里需要与编辑器组件集成，恢复代码状态
      // 暂时只更新内部状态
      set({
        currentNodeId: nodeId,
        selectedNodeId: nodeId,
      });

      console.log("已切换到节点:", nodeId, node.title);
      return true;
    } catch (error) {
      console.error("切换节点失败:", error);
      return false;
    }
  },

  // 添加聊天消息
  addChatMessage: (message) => {
    const state = get();
    const currentNode = state.currentNodeId
      ? state.nodes.get(state.currentNodeId)
      : null;

    const chatMessage: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      ...message,
    };

    if (currentNode) {
      // 更新当前节点的聊天历史
      const updatedNodes = new Map(state.nodes);
      updatedNodes.set(state.currentNodeId!, {
        ...currentNode,
        chatHistory: [...currentNode.chatHistory, chatMessage],
      });

      set({ nodes: updatedNodes });
    } else {
      // 如果没有当前节点，创建一个新的快照
      state.updatePendingSnapshot({
        description: `聊天: ${message.content.slice(0, 50)}...`,
      });
    }
  },

  // 获取聊天历史
  getChatHistory: (nodeId) => {
    const state = get();
    const targetNodeId = nodeId || state.currentNodeId;

    if (!targetNodeId) return [];

    const node = state.nodes.get(targetNodeId);
    return node?.chatHistory || [];
  },

  // 更新待处理快照
  updatePendingSnapshot: (changes) => {
    const state = get();
    const current = state.pendingSnapshot || {
      files: {},
      openFiles: [],
      timestamp: new Date().toISOString(),
    };

    set({
      pendingSnapshot: {
        ...current,
        ...changes,
        timestamp: new Date().toISOString(),
      },
    });
  },

  // 提交待处理快照
  commitPendingSnapshot: async (description) => {
    const state = get();
    if (!state.pendingSnapshot) {
      throw new Error("没有待处理的快照");
    }

    return await state.createSnapshot(description);
  },

  // 丢弃待处理快照
  discardPendingSnapshot: () => {
    set({ pendingSnapshot: null });
  },

  // 获取节点历史
  getNodeHistory: (nodeId) => {
    const state = get();
    const targetNodeId = nodeId || state.currentNodeId;

    if (!targetNodeId) return [];

    const history: VersionNode[] = [];
    let currentId: string | undefined = targetNodeId;

    while (currentId) {
      const node = state.nodes.get(currentId);
      if (node) {
        history.push(node);
        currentId = node.parentId;
      } else {
        break;
      }
    }

    return history;
  },

  // 获取节点父节点列表
  getNodeParents: (nodeId) => {
    const state = get();
    const parents: VersionNode[] = [];
    let currentId: string | undefined = nodeId;

    while (currentId) {
      const node = state.nodes.get(currentId);
      if (node && node.parentId) {
        const parent = state.nodes.get(node.parentId);
        if (parent) {
          parents.push(parent);
          currentId = parent.parentId;
        } else {
          break;
        }
      } else {
        break;
      }
    }

    return parents;
  },

  // 获取节点子节点列表
  getNodeChildren: (nodeId) => {
    const state = get();
    const children: VersionNode[] = [];

    state.nodes.forEach((node) => {
      if (node.parentId === nodeId) {
        children.push(node);
      }
    });

    return children.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  },

  // 获取分支的所有节点
  getBranchNodes: (branchId) => {
    const state = get();
    const branch = state.branches.get(branchId);

    if (!branch) return [];

    return state.getNodeHistory(branch.headNodeId);
  },

  // 比较两个节点
  compareNodes: (nodeId1, nodeId2) => {
    const state = get();
    const node1 = state.nodes.get(nodeId1);
    const node2 = state.nodes.get(nodeId2);

    if (!node1 || !node2) {
      throw new Error("节点不存在");
    }

    const files1 = node1.codeSnapshot.files;
    const files2 = node2.codeSnapshot.files;

    const allFiles = new Set([...Object.keys(files1), ...Object.keys(files2)]);
    const filesChanged: string[] = [];
    const details: Record<string, any> = {};
    let additions = 0;
    let deletions = 0;

    allFiles.forEach((filePath) => {
      const file1 = files1[filePath];
      const file2 = files2[filePath];

      if (!file1 && file2) {
        filesChanged.push(filePath);
        details[filePath] = { type: "added", newContent: file2.content };
        additions += file2.content.split("\n").length;
      } else if (file1 && !file2) {
        filesChanged.push(filePath);
        details[filePath] = { type: "removed", oldContent: file1.content };
        deletions += file1.content.split("\n").length;
      } else if (file1 && file2 && file1.content !== file2.content) {
        filesChanged.push(filePath);
        details[filePath] = {
          type: "modified",
          oldContent: file1.content,
          newContent: file2.content,
        };

        const lines1 = file1.content.split("\n");
        const lines2 = file2.content.split("\n");
        additions += Math.max(0, lines2.length - lines1.length);
        deletions += Math.max(0, lines1.length - lines2.length);
      }
    });

    return { filesChanged, additions, deletions, details };
  },

  // 搜索节点
  searchNodes: (query) => {
    const state = get();
    const lowerQuery = query.toLowerCase();
    const results: VersionNode[] = [];

    state.nodes.forEach((node) => {
      const matchTitle = node.title.toLowerCase().includes(lowerQuery);
      const matchDescription = node.description
        ?.toLowerCase()
        .includes(lowerQuery);
      const matchChat = node.chatHistory.some((msg) =>
        msg.content.toLowerCase().includes(lowerQuery)
      );

      if (matchTitle || matchDescription || matchChat) {
        results.push(node);
      }
    });

    return results.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  },

  // 过滤节点
  filterNodes: (filter) => {
    const state = get();
    const results: VersionNode[] = [];

    state.nodes.forEach((node) => {
      switch (filter) {
        case "all":
          results.push(node);
          break;
        case "ai":
          if (node.changes?.type === "ai_generated") {
            results.push(node);
          }
          break;
        case "manual":
          if (node.changes?.type === "manual_edit") {
            results.push(node);
          }
          break;
        case "restore":
          if (node.changes?.type === "restore") {
            results.push(node);
          }
          break;
      }
    });

    return results.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  },

  // UI状态管理
  setHistoryPanelOpen: (open) => set({ isHistoryPanelOpen: open }),
  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setFilterType: (filter) => set({ filterType: filter }),

  // 保存到存储
  saveToStorage: () => {
    const state = get();

    const exportData = {
      currentNodeId: state.currentNodeId,
      currentBranchId: state.currentBranchId,
      nodes: Array.from(state.nodes.entries()),
      branches: Array.from(state.branches.entries()),
      timestamp: new Date().toISOString(),
    };

    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(exportData));
      console.log("历史数据已保存");
    } catch (error) {
      console.error("保存历史数据失败:", error);
    }
  },

  // 从存储加载
  loadFromStorage: () => {
    try {
      const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (!stored) return false;

      const data = JSON.parse(stored);

      set({
        currentNodeId: data.currentNodeId,
        currentBranchId: data.currentBranchId,
        nodes: new Map(data.nodes),
        branches: new Map(data.branches),
      });

      console.log("历史数据已加载");
      return true;
    } catch (error) {
      console.error("加载历史数据失败:", error);
      return false;
    }
  },

  // 导出历史
  exportHistory: () => {
    const state = get();

    const exportData = {
      version: "1.0",
      currentNodeId: state.currentNodeId,
      currentBranchId: state.currentBranchId,
      nodes: Array.from(state.nodes.entries()),
      branches: Array.from(state.branches.entries()),
      exportedAt: new Date().toISOString(),
    };

    return JSON.stringify(exportData, null, 2);
  },

  // 导入历史
  importHistory: (data) => {
    try {
      const importData = JSON.parse(data);

      set({
        currentNodeId: importData.currentNodeId,
        currentBranchId: importData.currentBranchId,
        nodes: new Map(importData.nodes),
        branches: new Map(importData.branches),
      });

      get().saveToStorage();
      console.log("历史数据导入成功");
      return true;
    } catch (error) {
      console.error("导入历史数据失败:", error);
      return false;
    }
  },

  // 清理旧节点
  pruneOldNodes: (keepCount) => {
    const state = get();
    const allNodes = Array.from(state.nodes.values());

    if (allNodes.length <= keepCount) return;

    // 按时间排序，保留最新的节点
    const sortedNodes = allNodes.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    const toKeep = sortedNodes.slice(0, keepCount);
    const toDelete = sortedNodes.slice(keepCount);

    const newNodes = new Map();
    toKeep.forEach((node) => newNodes.set(node.id, node));

    set({ nodes: newNodes });
    state.saveToStorage();

    console.log(`已清理 ${toDelete.length} 个旧节点`);
  },

  // 压缩历史
  compactHistory: () => {
    const state = get();
    // 实现历史压缩逻辑，例如合并相似的连续节点
    console.log("历史压缩功能待实现");
  },

  // 删除节点
  deleteNode: (nodeId) => {
    const state = get();
    const newNodes = new Map(state.nodes);
    newNodes.delete(nodeId);

    // 如果删除的是当前节点，需要找到新的当前节点
    let newCurrentNodeId = state.currentNodeId;
    if (state.currentNodeId === nodeId) {
      const node = state.nodes.get(nodeId);
      newCurrentNodeId = node?.parentId || null;
    }

    set({
      nodes: newNodes,
      currentNodeId: newCurrentNodeId,
    });

    state.saveToStorage();
  },

  // 删除分支
  deleteBranch: (branchId) => {
    const state = get();

    if (branchId === "main") {
      console.error("不能删除主分支");
      return;
    }

    const newBranches = new Map(state.branches);
    newBranches.delete(branchId);

    // 如果删除的是当前分支，切换到主分支
    let newCurrentBranchId = state.currentBranchId;
    if (state.currentBranchId === branchId) {
      newCurrentBranchId = "main";
    }

    set({
      branches: newBranches,
      currentBranchId: newCurrentBranchId,
    });

    state.saveToStorage();
  },
}));
