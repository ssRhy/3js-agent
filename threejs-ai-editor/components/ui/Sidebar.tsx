import React, { useState, useRef, useEffect, useCallback } from "react";
import { SocketConnectionStatus } from "../../hooks/socket/useSocketConnection";
import StatusSection from "./StatusSection";
import CodeEditor from "../editor/CodeEditor";
import VersionHistory from "./VersionHistory";
import { HistoryEntry } from "../../stores/useSceneStore";
import AgentProgressDialog, {
  AgentStep,
  AgentStepDetails,
} from "../AgentProgressDialog";
import { useSocketStore } from "../../lib/socket";

// Socket.IO 类型扩展
declare global {
  interface Window {
    io: () => {
      on: (event: string, callback: (data: AgentEventData) => void) => void;
      off: (event: string) => void;
      disconnect: () => void;
    };
  }
}

// Agent事件类型
interface AgentEventData {
  type: string;
  stepId: string;
  stepType:
    | "thinking"
    | "tool_call"
    | "analysis"
    | "code_generation"
    | "completion";
  title: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "error";
  timestamp: string;
  details?: Record<string, unknown>;
}

interface SidebarProps {
  socketConnectionStatus: SocketConnectionStatus;
  manualReconnect: () => void;
  prompt: string;
  setPrompt: (prompt: string) => void;
  handleGenerate: () => void;
  isLoading: boolean;
  isModelLoading: boolean;
  error: string;
  code: string;
  setCode: (code: string) => void;
  lintErrors: Array<{
    ruleId: string | null;
    severity: number;
    message: string;
    line: number;
    column: number;
  }>;
  showDiff: boolean;
  setShowDiff: (show: boolean) => void;
  diff: string;
  previousCode: string;
  onVersionRevert?: (index: number, entry: HistoryEntry) => void;
  lastAgentResponse?: string;
}

interface ChatMessage {
  id: string;
  type: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  isLoading?: boolean;
  agentMeta?: {
    status?:
      | "thinking"
      | "tool_calling"
      | "analyzing"
      | "generating"
      | "completed";
    currentStep?: string;
    suggestions?: string[];
    steps?: AgentStep[];
  };
}

const Sidebar: React.FC<SidebarProps> = ({
  socketConnectionStatus,
  manualReconnect,
  prompt,
  setPrompt,
  handleGenerate,
  isLoading,
  isModelLoading,
  error,
  code,
  setCode,
  lintErrors,
  showDiff,
  setShowDiff,
  diff,
  previousCode,
  onVersionRevert,
  lastAgentResponse,
}) => {
  const [sidebarWidth, setSidebarWidth] = useState(45);
  const [isDragging, setIsDragging] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "1",
      type: "system",
      content:
        "Welcome to Three.js AI Editor! Describe the 3D scene you want to create.",
      timestamp: new Date(),
    },
  ]);
  const [currentView, setCurrentView] = useState<"chat" | "code" | "history">(
    "chat"
  );

  // State for agent progress tracking
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [showProgressDialog, setShowProgressDialog] = useState(false);
  const [currentAgentStatus, setCurrentAgentStatus] = useState<string>("");

  const sidebarRef = useRef<HTMLDivElement>(null);
  const dragHandleRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);

  // 自动滚动到聊天底部
  const scrollToBottom = () => {
    setTimeout(() => {
      messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  };

  // 发送3D场景生成消息时添加到聊天记录
  const handleSendMessage = () => {
    if (!prompt.trim() || isLoading || socketConnectionStatus !== "open")
      return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: "user",
      content: prompt,
      timestamp: new Date(),
    };

    const loadingMessage: ChatMessage = {
      id: (Date.now() + 1).toString(),
      type: "assistant",
      content: "Generating your 3D scene...",
      timestamp: new Date(),
      isLoading: true,
    };

    setChatMessages((prev) => [...prev, userMessage, loadingMessage]);
    handleGenerate();
    setPrompt("");
    scrollToBottom();
  };

  // 手动修复错误函数
  const handleFixBug = async () => {
    if (!error || isLoading || socketConnectionStatus !== "open") return;

    try {
      const userMessage: ChatMessage = {
        id: Date.now().toString(),
        type: "user",
        content: "Fix the current error",
        timestamp: new Date(),
      };

      const loadingMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: "assistant",
        content: "Analyzing and fixing the error...",
        timestamp: new Date(),
        isLoading: true,
      };

      setChatMessages((prev) => [...prev, userMessage, loadingMessage]);

      // 调用错误修复API
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "fix-bug",
          code: code,
          prompt: "Fix the current error",
          errorDescription: error,
          errorDetails: `User manually requested error fix. Current error: ${error}`,
          lintErrors: lintErrors,
        }),
      });

      if (!response.ok) {
        throw new Error(`Fix API failed: ${response.statusText}`);
      }

      const fixResult = await response.json();

      if (fixResult.success && fixResult.directCode) {
        // 应用修复后的代码
        setCode(fixResult.directCode);

        // 更新聊天消息
        setChatMessages((prev) =>
          prev.map((msg) =>
            msg.isLoading
              ? {
                  ...msg,
                  content: "Error has been fixed! The code has been updated.",
                  isLoading: false,
                }
              : msg
          )
        );
      } else {
        // 修复失败
        setChatMessages((prev) =>
          prev.map((msg) =>
            msg.isLoading
              ? {
                  ...msg,
                  content: `Failed to fix error: ${
                    fixResult.error || "Unknown error"
                  }`,
                  isLoading: false,
                }
              : msg
          )
        );
      }
    } catch (fixError) {
      console.error("Manual fix failed:", fixError);
      setChatMessages((prev) =>
        prev.map((msg) =>
          msg.isLoading
            ? {
                ...msg,
                content: `Fix failed: ${
                  fixError instanceof Error
                    ? fixError.message
                    : String(fixError)
                }`,
                isLoading: false,
              }
            : msg
        )
      );
    }

    scrollToBottom();
  };

  // 监听错误状态，更新聊天消息
  useEffect(() => {
    if (error) {
      setChatMessages((prev) =>
        prev.map((msg) =>
          msg.isLoading
            ? { ...msg, content: `Error: ${error}`, isLoading: false }
            : msg
        )
      );
    }
  }, [error]);

  // 监听代码变化，完成加载状态
  useEffect(() => {
    if (!isLoading && chatMessages.some((msg) => msg.isLoading)) {
      setChatMessages((prev) =>
        prev.map((msg) =>
          msg.isLoading
            ? {
                ...msg,
                content:
                  "Scene generated successfully! Check the preview and code.",
                isLoading: false,
              }
            : msg
        )
      );
      scrollToBottom();
    }
  }, [isLoading, chatMessages]);

  // 监听agent响应更新
  useEffect(() => {
    if (
      lastAgentResponse &&
      !isLoading &&
      chatMessages.some((msg) => msg.isLoading)
    ) {
      setChatMessages((prev) =>
        prev.map((msg) =>
          msg.isLoading
            ? {
                ...msg,
                content: lastAgentResponse,
                isLoading: false,
              }
            : msg
        )
      );
      scrollToBottom();
    }
  }, [lastAgentResponse, isLoading, chatMessages]);

  // 当切换到Code tab时，触发Monaco编辑器重新布局
  useEffect(() => {
    if (currentView === "code") {
      // 延迟触发，确保DOM已更新
      const timer = setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [currentView]);

  // Listen for real-time agent events from the backend
  useEffect(() => {
    const { socket } = useSocketStore.getState();

    if (socket) {
      const handleAgentEvent = (eventData: AgentEventData) => {
        console.log("[Sidebar] Received agent event:", eventData);

        // Update current status for the status bar
        setCurrentAgentStatus(eventData.title);

        // Convert backend event to frontend AgentStep format
        const newStep: AgentStep = {
          id: eventData.stepId || `step_${Date.now()}`,
          type: eventData.stepType || "thinking",
          status: eventData.status || "in_progress",
          title: eventData.title,
          description: eventData.description,
          timestamp: new Date(eventData.timestamp),
          details: {
            duration: 0,
            reasoning: eventData.details?.reasoning,
            suggestions: Array.isArray(eventData.details?.suggestions)
              ? eventData.details.suggestions
              : [],
            metrics: eventData.details?.metrics || {},
          } as unknown as AgentStepDetails,
        };

        setAgentSteps((prev) => {
          // Update existing step or add new step
          const existingIndex = prev.findIndex(
            (step) => step.id === newStep.id
          );
          if (existingIndex >= 0) {
            const updated = [...prev];
            updated[existingIndex] = { ...updated[existingIndex], ...newStep };
            return updated;
          } else {
            return [...prev, newStep];
          }
        });
      };

      // 监听聊天事件 - 新增
      const handleChatEvent = (eventData: {
        type: string;
        title: string;
        message: string;
        requestId: string;
      }) => {
        console.log("[Sidebar] Received chat event:", eventData);

        if (
          eventData.type === "chat_complete" ||
          eventData.type === "chat_error"
        ) {
          // 清除加载消息并添加简单确认
          setChatMessages((prev) =>
            prev.map((msg) =>
              msg.isLoading
                ? {
                    ...msg,
                    content: "场景生成完成 ✅",
                    isLoading: false,
                  }
                : msg
            )
          );

          // Clear agent status
          setCurrentAgentStatus("");
          scrollToBottom();
        } else if (eventData.type === "agent_summary") {
          // 添加Agent完成后的总结和建议作为新消息
          const summaryMessage: ChatMessage = {
            id: (Date.now() + 2).toString(),
            type: "assistant",
            content: eventData.message,
            timestamp: new Date(),
          };

          setChatMessages((prev) => [...prev, summaryMessage]);
          scrollToBottom();
        } else if (eventData.type === "chat_start") {
          // Update status with start message
          setCurrentAgentStatus(eventData.message);
        }
      };

      socket.on("agent_event", handleAgentEvent);
      socket.on("chat_event", handleChatEvent);

      return () => {
        socket.off("agent_event", handleAgentEvent);
        socket.off("chat_event", handleChatEvent);
      };
    }
  }, [scrollToBottom]);

  // Clear agent steps when loading starts
  useEffect(() => {
    if (isLoading) {
      setAgentSteps([]);
    }
  }, [isLoading]);

  // 拖拽逻辑保持不变
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    document.body.classList.add("dragging");
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      const windowWidth = window.innerWidth;
      const newWidth = (e.clientX / windowWidth) * 100;
      const clampedWidth = Math.min(70, Math.max(20, newWidth));
      setSidebarWidth(clampedWidth);
      setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
      }, 0);
    },
    [isDragging]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    document.body.classList.remove("dragging");
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 10);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const handleDoubleClick = useCallback(() => {
    setSidebarWidth(45);
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 10);
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // 格式化chatbot消息内容，遵循UI设计规范
  const formatMessageContent = (content: string): React.ReactNode => {
    if (content.includes("[COMPLETED]") || content.includes("[SUGGESTIONS]")) {
      // 处理chatbot总结格式
      const formatted = content
        .replace(/\[COMPLETED\]/g, "▶ TASK COMPLETED")
        .replace(/\[SUGGESTIONS\]/g, "▶ NEXT STEPS")
        .replace(/^- /gm, "  • ") // 将破折号替换为项目符号
        .trim();

      return (
        <div className="chatbot-summary">
          {formatted.split("\n").map((line, index) => {
            // 空行处理
            if (line.trim() === "") {
              return <br key={index} />;
            }

            // 标题行处理
            if (
              line.includes("▶ TASK COMPLETED") ||
              line.includes("▶ NEXT STEPS")
            ) {
              return (
                <div key={index} className="summary-section-header">
                  {line}
                </div>
              );
            }

            // 普通内容行
            return (
              <div key={index} className="summary-line">
                {line}
              </div>
            );
          })}
        </div>
      );
    }

    return content;
  };

  return (
    <>
      <div
        ref={sidebarRef}
        className="chat-sidebar"
        style={{
          width: `${sidebarWidth}%`,
          minWidth: "380px",
          maxWidth: "70%",
        }}
      >
        {/* Header */}
        <div className="chat-header">
          <div className="chat-title">
            <div>
              <h3>Three.js AI</h3>
              <div className={`connection-status ${socketConnectionStatus}`}>
                <span className="status-indicator"></span>
                {socketConnectionStatus === "open"
                  ? "Connected"
                  : socketConnectionStatus === "connecting"
                  ? "Connecting..."
                  : "Disconnected"}
              </div>
            </div>
          </div>

          {socketConnectionStatus !== "open" && (
            <button onClick={manualReconnect} className="reconnect-btn">
              <span></span>
            </button>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="tab-navigation">
          <button
            className={`tab-btn ${currentView === "chat" ? "active" : ""}`}
            onClick={() => setCurrentView("chat")}
          >
            Chat
          </button>
          <button
            className={`tab-btn ${currentView === "code" ? "active" : ""}`}
            onClick={() => setCurrentView("code")}
          >
            Code
          </button>
          <button
            className={`tab-btn ${currentView === "history" ? "active" : ""}`}
            onClick={() => setCurrentView("history")}
          >
            History
          </button>
        </div>

        {/* Agent Status Bar */}
        {isLoading && (
          <div className="agent-status-bar">
            <div className="status-content">
              <div className="status-indicator">
                <div className="status-dot"></div>
                <span className="status-text">
                  {currentAgentStatus || "Agent is working..."}
                </span>
              </div>
            </div>
            <button
              onClick={() => setShowProgressDialog(true)}
              className="progress-btn"
            >
              Details
            </button>
          </div>
        )}

        {/* Content Area */}
        <div className="content-area">
          {currentView === "chat" && (
            <div className="chat-content">
              {/* Messages Container */}
              <div className="messages-container" ref={chatContainerRef}>
                {chatMessages.map((message) => (
                  <div key={message.id} className={`message ${message.type}`}>
                    <div className="message-header">
                      <div className="message-avatar">
                        {message.type === "user"
                          ? "U"
                          : message.type === "assistant"
                          ? "AI"
                          : "SYS"}
                      </div>
                      <div className="message-info">
                        <span className="message-sender">
                          {message.type === "user"
                            ? "You"
                            : message.type === "assistant"
                            ? "AI Assistant"
                            : "System"}
                        </span>
                        <span className="message-time">
                          {formatTime(message.timestamp)}
                        </span>
                      </div>
                    </div>
                    <div
                      className={`message-content ${
                        message.content.includes("[COMPLETED]") ||
                        message.content.includes("[SUGGESTIONS]")
                          ? "summary-format"
                          : ""
                      }`}
                    >
                      {message.isLoading ? (
                        <div className="loading-message">
                          <div className="loading-dots">
                            <span></span>
                            <span></span>
                            <span></span>
                          </div>
                          {message.content}
                        </div>
                      ) : (
                        formatMessageContent(message.content)
                      )}
                    </div>
                  </div>
                ))}
                <div ref={messageEndRef} />
              </div>

              {/* Status Messages */}
              {socketConnectionStatus !== "open" && (
                <div className="status-message warning">
                  Establishing connection, please wait...
                </div>
              )}

              <StatusSection error={error} isModelLoading={isModelLoading} />
            </div>
          )}

          {currentView === "code" && (
            <div className="code-content">
              {previousCode && code !== previousCode && (
                <div className="diff-controls">
                  <button
                    className="diff-toggle-btn"
                    onClick={() => setShowDiff(!showDiff)}
                  >
                    {showDiff ? "Show Current" : "Show Diff"}
                  </button>
                </div>
              )}

              <div className="code-editor-container">
                <CodeEditor
                  code={showDiff && diff ? diff : code}
                  onChange={setCode}
                  lintErrors={lintErrors}
                />
              </div>
            </div>
          )}

          {currentView === "history" && (
            <div className="history-content">
              <VersionHistory onVersionRevert={onVersionRevert} />
            </div>
          )}
        </div>

        {/* Input Area - Only show in chat view */}
        {currentView === "chat" && (
          <div className="input-area">
            <div className="message-input-container">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder="Describe your 3D scene... (Ctrl+Enter to send)"
                className="message-input"
                rows={3}
                disabled={socketConnectionStatus !== "open"}
              />
              <div className="button-group">
                <button
                  onClick={handleSendMessage}
                  disabled={
                    !prompt.trim() ||
                    isLoading ||
                    socketConnectionStatus !== "open"
                  }
                  className="send-button"
                >
                  {isLoading ? (
                    <div className="loading-spinner"></div>
                  ) : (
                    <span>Send</span>
                  )}
                </button>

                {/* Fix Bug 按钮 - 仅在有错误时显示 */}
                {error && (
                  <button
                    onClick={handleFixBug}
                    disabled={isLoading || socketConnectionStatus !== "open"}
                    className="fix-bug-button"
                    title="Fix the current error automatically"
                  >
                    Fix Bug
                  </button>
                )}
              </div>
            </div>

            <div className="input-hint">
              Press Ctrl+Enter to send • Be specific for better results
              {error && " • Click 'Fix Bug' to automatically resolve errors"}
            </div>
          </div>
        )}
      </div>

      {/* Resize Handle */}
      <div
        ref={dragHandleRef}
        className={`resize-handle ${isDragging ? "dragging" : ""}`}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        title="Drag to resize sidebar, double-click to reset"
      >
        <div className="resize-handle-indicator"></div>
      </div>

      <style jsx>{`
        .chat-sidebar {
          display: flex;
          flex-direction: column;
          height: 100vh;
          background: var(--bg-secondary);
          border-right: 1px solid var(--border-primary);
          overflow: hidden;
          position: relative;
          flex-shrink: 0;
        }

        .chat-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: var(--spacing-lg);
          border-bottom: 1px solid var(--border-primary);
          background: var(--bg-card);
          position: relative;
        }

        .chat-title {
          display: flex;
          align-items: center;
          gap: var(--spacing-md);
        }

        .app-icon {
          width: 40px;
          height: 40px;
          background: linear-gradient(
            135deg,
            var(--accent-primary),
            var(--accent-secondary)
          );
          border-radius: var(--radius-lg);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
        }

        .chat-title h3 {
          margin: 0;
          color: var(--text-primary);
          font-size: 16px;
          font-weight: 600;
          letter-spacing: -0.025em;
        }

        .connection-status {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: var(--text-secondary);
          margin-top: 2px;
        }

        .status-indicator {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--status-error);
        }

        .connection-status.open .status-indicator {
          background: var(--status-success);
          animation: pulse 2s infinite;
        }

        .connection-status.connecting .status-indicator {
          background: var(--status-warning);
          animation: pulse 1s infinite;
        }

        .reconnect-btn {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
          color: var(--text-secondary);
          width: 32px;
          height: 32px;
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .reconnect-btn:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }

        .tab-navigation {
          display: flex;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border-primary);
        }

        .tab-btn {
          flex: 1;
          padding: var(--spacing-md);
          background: none;
          border: none;
          color: var(--text-secondary);
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--spacing-sm);
          position: relative;
        }

        .tab-btn:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }

        .tab-btn.active {
          background: var(--bg-secondary);
          color: var(--text-primary);
          border-bottom: 2px solid var(--accent-primary);
        }

        .content-area {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          min-height: 0;
        }

        .chat-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .messages-container {
          flex: 1;
          padding: var(--spacing-md);
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: var(--spacing-md);
        }

        .messages-container::-webkit-scrollbar {
          width: 6px;
        }

        .messages-container::-webkit-scrollbar-track {
          background: var(--bg-tertiary);
          border-radius: 3px;
        }

        .messages-container::-webkit-scrollbar-thumb {
          background: var(--border-primary);
          border-radius: 3px;
        }

        .messages-container::-webkit-scrollbar-thumb:hover {
          background: var(--border-secondary);
        }

        .message {
          max-width: 85%;
          animation: messageSlideIn 0.3s ease-out;
        }

        .message.user {
          align-self: flex-end;
        }

        .message.assistant,
        .message.system {
          align-self: flex-start;
        }

        .message-header {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);
          margin-bottom: 6px;
        }

        .message-avatar {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: var(--bg-tertiary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          flex-shrink: 0;
        }

        .message.user .message-avatar {
          background: var(--accent-primary);
        }

        .message.assistant .message-avatar {
          background: var(--status-success);
        }

        .message.system .message-avatar {
          background: var(--status-warning);
        }

        .message-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .message-sender {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .message-time {
          font-size: 10px;
          color: var(--text-tertiary);
        }

        .message-content {
          background: var(--bg-card);
          border: 1px solid var(--border-primary);
          border-radius: var(--radius-lg);
          padding: var(--spacing-md);
          color: var(--text-primary);
          font-size: 14px;
          line-height: 1.5;
          word-wrap: break-word;
          white-space: pre-line;
        }

        /* Chatbot总结消息特殊格式化 */
        .message-content.summary-format {
          white-space: pre-line;
          line-height: 1.7;
        }

        .message-content.summary-format [COMPLETED],
        .message-content.summary-format [SUGGESTIONS] {
          display: block;
          font-weight: 600;
          color: var(--text-primary);
          margin: var(--spacing-md) 0 var(--spacing-sm) 0;
          padding: var(--spacing-sm) 0;
          border-bottom: 1px solid var(--border-primary);
        }

        .message-content.summary-format p {
          margin: var(--spacing-sm) 0;
          line-height: 1.6;
        }

        .message-content.summary-format ul,
        .message-content.summary-format ol {
          margin: var(--spacing-sm) 0;
          padding-left: var(--spacing-lg);
        }

        .message-content.summary-format li {
          margin: var(--spacing-sm) 0;
          line-height: 1.6;
        }

        /* Chatbot summary specific styling */
        .chatbot-summary {
          font-family: "SF Mono", "Monaco", "Inconsolata", "Roboto Mono",
            monospace;
        }

        .summary-section-header {
          font-weight: 700;
          font-size: 13px;
          color: var(--text-primary);
          margin: var(--spacing-lg) 0 var(--spacing-md) 0;
          padding: var(--spacing-sm) 0;
          border-bottom: 1px solid var(--border-secondary);
          letter-spacing: 0.5px;
        }

        .summary-line {
          margin: var(--spacing-sm) 0;
          line-height: 1.7;
          color: var(--text-secondary);
        }

        .summary-line:empty {
          margin: var(--spacing-xs) 0;
        }

        .message.user .message-content {
          background: var(--accent-primary);
          color: var(--bg-primary);
          border-color: var(--accent-primary);
        }

        .message.system .message-content {
          background: var(--bg-tertiary);
          border-color: var(--border-secondary);
          font-style: italic;
        }

        .loading-message {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);
        }

        .loading-dots {
          display: flex;
          gap: 4px;
        }

        .loading-dots span {
          width: 6px;
          height: 6px;
          background: var(--text-secondary);
          border-radius: 50%;
          animation: loadingDots 1.4s infinite ease-in-out;
        }

        .loading-dots span:nth-child(1) {
          animation-delay: -0.32s;
        }

        .loading-dots span:nth-child(2) {
          animation-delay: -0.16s;
        }

        .status-message {
          margin: var(--spacing-md);
          padding: var(--spacing-md);
          border-radius: var(--radius-md);
          font-size: 13px;
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);
        }

        .status-message.warning {
          background: rgba(251, 191, 36, 0.1);
          border: 1px solid rgba(251, 191, 36, 0.3);
          color: var(--status-warning);
        }

        .input-area {
          border-top: 1px solid var(--border-primary);
          background: var(--bg-card);
          padding: var(--spacing-lg);
        }

        .message-input-container {
          display: flex;
          gap: var(--spacing-sm);
          background: var(--bg-card);
          border: 1px solid var(--border-primary);
          border-radius: var(--radius-lg);
          padding: var(--spacing-sm);
          transition: border-color 0.2s ease;
        }

        .message-input-container:focus-within {
          border-color: var(--accent-primary);
        }

        .message-input {
          flex: 1;
          background: none;
          border: none;
          color: var(--text-primary);
          font-size: 14px;
          line-height: 1.4;
          resize: none;
          outline: none;
          font-family: inherit;
          padding: var(--spacing-sm);
        }

        .message-input::placeholder {
          color: var(--text-tertiary);
        }

        .message-input:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .button-group {
          display: flex;
          gap: var(--spacing-xs);
          flex-direction: column;
        }

        .send-button,
        .fix-bug-button {
          background: var(--accent-primary);
          border: none;
          color: var(--bg-primary);
          padding: var(--spacing-sm) var(--spacing-md);
          border-radius: var(--radius-md);
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 32px;
          white-space: nowrap;
        }

        .send-button:hover:not(:disabled),
        .fix-bug-button:hover:not(:disabled) {
          background: var(--accent-secondary);
          transform: translateY(-1px);
        }

        .send-button:disabled,
        .fix-bug-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
        }

        .fix-bug-button {
          background: var(--status-warning);
          font-size: 12px;
        }

        .fix-bug-button:hover:not(:disabled) {
          background: #f59e0b;
        }

        .loading-spinner {
          width: 16px;
          height: 16px;
          border: 2px solid transparent;
          border-top: 2px solid currentColor;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        .input-hint {
          margin-top: var(--spacing-sm);
          font-size: 11px;
          color: var(--text-tertiary);
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
        }

        .code-content,
        .history-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          padding: var(--spacing-md);
        }

        .diff-controls {
          margin-bottom: var(--spacing-md);
        }

        .diff-toggle-btn {
          width: 100%;
          padding: var(--spacing-sm) var(--spacing-md);
          background: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .diff-toggle-btn:hover {
          background: var(--bg-hover);
        }

        .code-editor-container {
          flex: 1;
          min-height: 0;
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        .code-editor-container :global(.code-section) {
          flex: 1;
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        .code-editor-container :global(.code-editor-wrapper) {
          flex: 1;
          height: 100%;
          border: 1px solid var(--border-primary);
          border-radius: var(--radius-md);
          overflow: hidden;
          background: var(--bg-input);
        }

        @keyframes messageSlideIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes loadingDots {
          0%,
          80%,
          100% {
            transform: scale(0);
          }
          40% {
            transform: scale(1);
          }
        }

        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.4;
          }
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        .agent-status-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: var(--spacing-md);
          background: var(--bg-card);
          border-bottom: 1px solid var(--border-primary);
          animation: slideDown 0.3s ease-out;
        }

        .status-content {
          display: flex;
          align-items: center;
          gap: var(--spacing-md);
          flex: 1;
        }

        .status-indicator {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--status-success);
          animation: pulse 2s infinite;
        }

        .status-text {
          font-size: 13px;
          color: var(--text-primary);
          font-weight: 500;
        }

        .progress-btn {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
          color: var(--text-secondary);
          padding: 6px 12px;
          border-radius: var(--radius-md);
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .progress-btn:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }

        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>

      {/* Agent Progress Dialog */}
      <AgentProgressDialog
        isVisible={showProgressDialog}
        steps={agentSteps}
        onClose={() => setShowProgressDialog(false)}
      />
    </>
  );
};

export default Sidebar;
