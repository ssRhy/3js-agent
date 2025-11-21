import { useEffect, useCallback, useRef } from "react";
import { useHistoryStore, CodeSnapshot } from "../stores/useHistoryStore";
import { useSceneStore } from "../stores/useSceneStore";

/**
 * 版本控制和历史管理Hook
 * 提供非Git式的细粒度版本管理体验
 */
export const useVersionControl = () => {
  const {
    createSnapshot,
    addChatMessage,
    updatePendingSnapshot,
    commitPendingSnapshot,
    switchToNode,
    loadFromStorage,
    saveToStorage,
    getChatHistory,
    setHistoryPanelOpen,
    isHistoryPanelOpen,
    currentNodeId,
    filterNodes,
    searchNodes,
  } = useHistoryStore();

  const sceneStore = useSceneStore();
  const lastCodeRef = useRef<string>("");
  const lastPromptRef = useRef<string>("");
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 初始化：从存储加载历史数据
  useEffect(() => {
    loadFromStorage();

    // 监听页面卸载，保存数据
    const handleBeforeUnload = () => {
      saveToStorage();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [loadFromStorage, saveToStorage]);

  // 自动捕获代码变更
  const captureCodeChanges = useCallback(
    (files: Record<string, string>, activeFile?: string) => {
      const codeSnapshot: Partial<CodeSnapshot> = {
        files: Object.entries(files).reduce((acc, [path, content]) => {
          acc[path] = {
            content,
            language: getLanguageFromPath(path),
          };
          return acc;
        }, {} as CodeSnapshot["files"]),
        openFiles: Object.keys(files),
        activeFile,
        timestamp: new Date().toISOString(),
      };

      updatePendingSnapshot(codeSnapshot);

      // 防抖自动保存
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        commitPendingSnapshot("自动保存").catch(console.error);
      }, 5000); // 5秒后自动提交
    },
    [updatePendingSnapshot, commitPendingSnapshot]
  );

  // 手动创建快照
  const manualSnapshot = useCallback(
    async (description: string) => {
      try {
        const nodeId = await createSnapshot(description);
        console.log("快照创建成功:", nodeId);
        return nodeId;
      } catch (error) {
        console.error("创建快照失败:", error);
        return null;
      }
    },
    [createSnapshot]
  );

  // AI交互快照
  const aiSnapshot = useCallback(
    async (
      prompt: string,
      response?: string,
      model?: string,
      duration?: number
    ) => {
      try {
        const nodeId = await createSnapshot(
          `AI生成: ${prompt.slice(0, 50)}...`,
          {
            prompt,
            response,
            model,
            duration,
          }
        );

        // 添加AI对话到聊天历史
        addChatMessage({
          type: "user",
          content: prompt,
        });

        if (response) {
          addChatMessage({
            type: "assistant",
            content: response,
            metadata: { model, tokens: response.length },
          });
        }

        console.log("AI交互快照创建成功:", nodeId);
        return nodeId;
      } catch (error) {
        console.error("创建AI快照失败:", error);
        return null;
      }
    },
    [createSnapshot, addChatMessage]
  );

  // 监听场景和代码变化
  useEffect(() => {
    const currentCode = sceneStore.currentCode;
    const currentPrompt = sceneStore.currentPrompt;

    // 检测代码变化
    if (currentCode !== lastCodeRef.current && currentCode) {
      lastCodeRef.current = currentCode;

      // 捕获代码变更
      captureCodeChanges(
        {
          "main.js": currentCode,
        },
        "main.js"
      );
    }

    // 检测提示变化
    if (currentPrompt !== lastPromptRef.current && currentPrompt) {
      lastPromptRef.current = currentPrompt;

      // 添加用户消息到聊天历史
      addChatMessage({
        type: "user",
        content: currentPrompt,
      });
    }
  }, [
    sceneStore.currentCode,
    sceneStore.currentPrompt,
    captureCodeChanges,
    addChatMessage,
  ]);

  // 版本恢复
  const restoreVersion = useCallback(
    async (nodeId: string) => {
      try {
        const success = await switchToNode(nodeId);
        if (success) {
          // 这里需要实际恢复代码到编辑器
          // 暂时通过控制台输出
          console.log("版本恢复成功，节点ID:", nodeId);
          return true;
        }
        return false;
      } catch (error) {
        console.error("版本恢复失败:", error);
        return false;
      }
    },
    [switchToNode]
  );

  // 获取当前版本的聊天上下文
  const getCurrentChatContext = useCallback(() => {
    return getChatHistory(currentNodeId ?? undefined);
  }, [getChatHistory, currentNodeId]);

  // 搜索版本历史
  const searchVersions = useCallback(
    (query: string) => {
      if (!query.trim()) {
        return filterNodes("all");
      }
      return searchNodes(query);
    },
    [filterNodes, searchNodes]
  );

  // 导出版本数据
  const exportVersionData = useCallback(() => {
    const historyData = useHistoryStore.getState().exportHistory();
    const blob = new Blob([historyData], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `version-history-${
      new Date().toISOString().split("T")[0]
    }.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
  }, []);

  // 导入版本数据
  const importVersionData = useCallback((file: File) => {
    return new Promise<boolean>((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result as string;
          const success = useHistoryStore.getState().importHistory(data);
          resolve(success);
        } catch (error) {
          console.error("导入版本数据失败:", error);
          resolve(false);
        }
      };
      reader.readAsText(file);
    });
  }, []);

  // 切换历史面板显示状态
  const toggleHistoryPanel = useCallback(() => {
    setHistoryPanelOpen(!isHistoryPanelOpen);
  }, [setHistoryPanelOpen, isHistoryPanelOpen]);

  return {
    // 快照操作
    manualSnapshot,
    aiSnapshot,
    captureCodeChanges,

    // 版本控制
    restoreVersion,
    getCurrentChatContext,
    searchVersions,

    // 历史面板
    toggleHistoryPanel,
    isHistoryPanelOpen,

    // 数据导入导出
    exportVersionData,
    importVersionData,

    // 状态信息
    currentNodeId,
  };
};

// 辅助函数：从文件路径获取语言
function getLanguageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();

  switch (ext) {
    case "js":
    case "jsx":
      return "javascript";
    case "ts":
    case "tsx":
      return "typescript";
    case "html":
      return "html";
    case "css":
      return "css";
    case "scss":
    case "sass":
      return "scss";
    case "json":
      return "json";
    case "md":
      return "markdown";
    case "py":
      return "python";
    case "java":
      return "java";
    case "cpp":
    case "cc":
    case "cxx":
      return "cpp";
    case "c":
      return "c";
    case "php":
      return "php";
    case "rb":
      return "ruby";
    case "go":
      return "go";
    case "rs":
      return "rust";
    case "sh":
    case "bash":
      return "bash";
    case "xml":
      return "xml";
    case "yaml":
    case "yml":
      return "yaml";
    default:
      return "text";
  }
}
