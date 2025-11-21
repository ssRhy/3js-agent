import { useEffect, useCallback, useRef } from "react";
import { useSceneStore } from "../stores/useSceneStore";

/**
 * 页面刷新状态保留Hook
 * 自动处理页面加载时的状态恢复和刷新前的状态保存
 */
export const usePageStatePreservation = () => {
  const {
    savePageStateToStorage,
    restoreCompleteState,
    hasStoredScene,
    setCurrentCode,
    setCurrentPrompt,
    currentCode,
    currentPrompt,
  } = useSceneStore();

  const isInitializedRef = useRef(false);
  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 页面加载时恢复状态
  useEffect(() => {
    const restoreState = async () => {
      if (isInitializedRef.current) {
        return;
      }

      try {
        if (hasStoredScene()) {
          console.log("[状态保留] 检测到保存的状态，开始恢复...");
          const restored = await restoreCompleteState();

          if (restored) {
            console.log("[状态保留] 状态恢复成功");
          } else {
            console.log("[状态保留] 状态恢复失败，使用默认状态");
          }
        } else {
          console.log("[状态保留] 没有找到保存的状态");
        }
      } catch (error) {
        console.error("[状态保留] 状态恢复过程中出错:", error);
      } finally {
        isInitializedRef.current = true;
      }
    };

    // 延迟恢复状态，确保页面完全加载
    const timer = setTimeout(restoreState, 500);
    return () => clearTimeout(timer);
  }, [hasStoredScene, restoreCompleteState]);

  // 页面刷新/关闭前保存状态
  useEffect(() => {
    const handleBeforeUnload = () => {
      try {
        savePageStateToStorage();
        console.log("[状态保留] 页面关闭前状态已保存");
      } catch (error) {
        console.error("[状态保留] 保存状态失败:", error);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        try {
          savePageStateToStorage();
          console.log("[状态保留] 页面隐藏时状态已保存");
        } catch (error) {
          console.error("[状态保留] 保存状态失败:", error);
        }
      }
    };

    // 监听页面关闭事件
    window.addEventListener("beforeunload", handleBeforeUnload);
    // 监听页面可见性变化（切换标签页等）
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [savePageStateToStorage]);

  // 定期自动保存状态
  useEffect(() => {
    const startAutoSave = () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }

      saveIntervalRef.current = setInterval(() => {
        try {
          savePageStateToStorage();
          console.log("[状态保留] 自动保存状态完成");
        } catch (error) {
          console.error("[状态保留] 自动保存失败:", error);
        }
      }, 30000); // 每30秒自动保存一次
    };

    // 如果有当前状态，开始自动保存
    if (currentCode || currentPrompt) {
      startAutoSave();
    }

    return () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }
    };
  }, [currentCode, currentPrompt, savePageStateToStorage]);

  // 手动保存状态的方法
  const manualSave = useCallback(() => {
    try {
      savePageStateToStorage();
      console.log("[状态保留] 手动保存状态完成");
      return true;
    } catch (error) {
      console.error("[状态保留] 手动保存失败:", error);
      return false;
    }
  }, [savePageStateToStorage]);

  // 手动恢复状态的方法
  const manualRestore = useCallback(async () => {
    try {
      if (hasStoredScene()) {
        const restored = await restoreCompleteState();
        if (restored) {
          console.log("[状态保留] 手动恢复状态完成");
          return true;
        }
      }
      console.log("[状态保留] 没有可恢复的状态");
      return false;
    } catch (error) {
      console.error("[状态保留] 手动恢复失败:", error);
      return false;
    }
  }, [hasStoredScene, restoreCompleteState]);

  // 同步代码和提示到store
  const syncCodeToStore = useCallback(
    (code: string) => {
      setCurrentCode(code);
    },
    [setCurrentCode]
  );

  const syncPromptToStore = useCallback(
    (prompt: string) => {
      setCurrentPrompt(prompt);
    },
    [setCurrentPrompt]
  );

  return {
    manualSave,
    manualRestore,
    syncCodeToStore,
    syncPromptToStore,
    isInitialized: isInitializedRef.current,
  };
};
