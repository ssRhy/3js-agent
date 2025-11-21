/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useState, useEffect, useRef } from "react";
import AgentProgressDialog, { AgentStep } from "./AgentProgressDialog";

// Define a more detailed ChatMessage interface
export interface ChatMessage {
  id: string;
  type: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  isLoading?: boolean;
  hasImage?: boolean;
  imageUrl?: string;
  agentMeta?: {
    steps: AgentStep[];
    suggestions?: string[];
  };
}

interface AgentReaction {
  type: "thinking" | "suggestion" | "warning" | "success" | "tool_use";
  content: string;
  timestamp: Date;
  isVisible: boolean;
}

interface EnhancedChatInterfaceProps {
  messages: ChatMessage[];
  onSendMessage: (message: string, imageData?: string) => void;
  isLoading: boolean;
  isConnected: boolean;
  currentAgentStatus?: string;
  agentProgress?: {
    currentStep: string;
    totalSteps: number;
    percentage: number;
  };
}

const EnhancedChatInterface: React.FC<EnhancedChatInterfaceProps> = ({
  messages,
  onSendMessage,
  isLoading,
  isConnected,
  currentAgentStatus,
  agentProgress,
}) => {
  const [inputValue, setInputValue] = useState("");
  const [agentReactions, setAgentReactions] = useState<AgentReaction[]>([]);
  const [showProgressDialog, setShowProgressDialog] = useState(false);
  const [followUpSuggestions, setFollowUpSuggestions] = useState<string[]>([]);
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, agentReactions]);

  useEffect(() => {
    if (isLoading && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.type === "user") {
        simulateAgentReactions(lastMessage.content);
      }
    }
  }, [isLoading, messages]);

  useEffect(() => {
    // In real life, you would receive this data from a WebSocket
    const dummySteps: AgentStep[] = [
      {
        id: "1",
        type: "thinking",
        title: "Parsing Request",
        description: "Understanding user input.",
        status: "completed",
        timestamp: new Date(),
      },
      {
        id: "2",
        type: "tool_call",
        title: "Analyze Code",
        description: "Using static analysis tool.",
        status: "in_progress",
        timestamp: new Date(),
        details: { toolName: "code_analyzer" },
      },
    ];
    setAgentSteps(dummySteps);
  }, []);

  const simulateAgentReactions = (_content: string) => {
    const reactions: AgentReaction[] = [
      {
        type: "thinking",
        content: "Analyzing your request...",
        timestamp: new Date(),
        isVisible: true,
      },
      {
        type: "tool_use",
        content: "Using code analysis tool",
        timestamp: new Date(Date.now() + 1000),
        isVisible: true,
      },
      {
        type: "suggestion",
        content: "I'll create a 3D scene with proper lighting",
        timestamp: new Date(Date.now() + 2000),
        isVisible: true,
      },
    ];

    reactions.forEach((reaction, index) => {
      setTimeout(() => {
        setAgentReactions((prev) => [...prev, reaction]);

        setTimeout(() => {
          setAgentReactions((prev) =>
            prev.map((r) => (r === reaction ? { ...r, isVisible: false } : r))
          );
        }, 5000);
      }, index * 1000);
    });

    setTimeout(() => {
      setAgentReactions([]);
    }, 10000);
  };

  // 处理图片上传
  const handleImageUpload = async (file: File) => {
    setIsUploadingImage(true);
    try {
      // 验证文件类型
      const allowedTypes = [".jpg", ".jpeg", ".png", ".webp", ".bmp"];
      const fileExtension = "." + file.name.split(".").pop()?.toLowerCase();

      if (!allowedTypes.includes(fileExtension)) {
        throw new Error("Only image files are supported (JPG, PNG, WEBP, BMP)");
      }

      if (file.size > 10 * 1024 * 1024) {
        throw new Error("Image size must be less than 10MB");
      }

      // 转换为base64
      const reader = new FileReader();
      reader.onload = () => {
        const base64Data = reader.result as string;
        setSelectedImage(base64Data);
        setSelectedImageUrl(URL.createObjectURL(file));
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error("Image upload error:", error);
      alert(error instanceof Error ? error.message : "Image upload failed");
    } finally {
      setIsUploadingImage(false);
    }
  };

  // 处理文件选择
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleImageUpload(file);
    }
  };

  // 清除选中的图片
  const clearSelectedImage = () => {
    setSelectedImage(null);
    setSelectedImageUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSendMessage = () => {
    if ((!inputValue.trim() && !selectedImage) || isLoading || !isConnected)
      return;

    const messageText = selectedImage
      ? inputValue.trim() || "根据这张图片生成3D场景"
      : inputValue;

    onSendMessage(messageText, selectedImage || undefined);
    setInputValue("");
    clearSelectedImage();

    generateFollowUpSuggestions(messageText);
  };

  const generateFollowUpSuggestions = (lastMessage: string) => {
    const suggestions = [
      "Add animation to the objects",
      "Change the lighting conditions",
      "Add more geometric shapes",
      "Optimize performance",
      "Add interactivity",
    ];
    setFollowUpSuggestions(suggestions.slice(0, 3));
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInputValue(suggestion);
  };

  const getReactionIcon = (type: AgentReaction["type"]) => {
    const iconClass = "w-3 h-3 flex-shrink-0";
    switch (type) {
      case "thinking":
        return (
          <div
            className={`${iconClass} rounded-full bg-blue-400 animate-pulse`}
          />
        );
      case "suggestion":
        return <div className={`${iconClass} rounded bg-green-400`} />;
      case "warning":
        return <div className={`${iconClass} rounded bg-yellow-400`} />;
      case "success":
        return <div className={`${iconClass} rounded bg-emerald-400`} />;
      case "tool_use":
        return <div className={`${iconClass} rounded bg-purple-400`} />;
      default:
        return <div className={`${iconClass} rounded bg-gray-400`} />;
    }
  };

  const formatTime = (timestamp: Date) => {
    return timestamp.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const currentStatus = agentSteps.find(
    (step) => step.status === "in_progress"
  );

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white">
      {/* Agent Status Bar */}
      <div className="p-2 bg-gray-800 border-b border-gray-700 text-sm flex justify-between items-center">
        <span>
          Agent Status: {currentStatus ? currentStatus.title : "Idle"}
        </span>
        <button
          onClick={() => setShowProgressDialog(true)}
          className="text-blue-400 hover:underline"
        >
          View Workflow
        </button>
      </div>

      {/* Chat Messages Area */}
      <div className="flex-1 p-4 overflow-y-auto">
        {messages.map((message) => (
          <div key={message.id} className={`message message-${message.type}`}>
            <div className="message-header">
              <div className="message-avatar">
                {message.type === "user" ? "U" : "AI"}
              </div>
              <div className="message-info">
                <span className="message-sender">
                  {message.type === "user" ? "You" : "AI Assistant"}
                </span>
                <span className="message-time">
                  {formatTime(message.timestamp)}
                </span>
              </div>
            </div>

            <div className="message-content">
              {message.hasImage && message.imageUrl && (
                <div className="message-image">
                  <img src={message.imageUrl} alt="Uploaded image" />
                </div>
              )}

              {message.isLoading ? (
                <div className="loading-content">
                  <div className="loading-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                  <span>
                    {message.hasImage
                      ? "Generating scene from image..."
                      : "Generating your 3D scene..."}
                  </span>
                </div>
              ) : (
                message.content
              )}
            </div>

            {message.agentMeta && (
              <div className="agent-meta">
                {message.agentMeta.steps &&
                  message.agentMeta.steps.length > 0 && (
                    <div className="meta-section">
                      <h4>Agent Workflow</h4>
                      <div className="steps-timeline">
                        {message.agentMeta.steps.map((step, index) => (
                          <div
                            key={index}
                            className={`step-item ${step.status}`}
                          >
                            <div className="step-content ml-4">
                              <h3 className="step-title font-medium text-white">
                                {step.title}
                              </h3>
                              <p className="step-description text-sm text-gray-400">
                                {step.description}
                              </p>
                              {step.details && (
                                <div className="mt-2">
                                  <button
                                    onClick={() =>
                                      handleSuggestionClick(step.description)
                                    }
                                    className="text-xs text-blue-400 hover:underline"
                                  >
                                    Show Details
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {message.agentMeta.suggestions &&
                  message.agentMeta.suggestions.length > 0 && (
                    <div className="meta-section">
                      <h4>Suggestions</h4>
                      <ul className="suggestions-list">
                        {message.agentMeta.suggestions.map(
                          (suggestion, idx) => (
                            <li
                              key={idx}
                              onClick={() => handleSuggestionClick(suggestion)}
                            >
                              {suggestion}
                            </li>
                          )
                        )}
                      </ul>
                    </div>
                  )}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-gray-700">
        {/* Image Preview */}
        {selectedImage && (
          <div className="image-preview-container">
            <div className="image-preview">
              <img
                src={selectedImageUrl || selectedImage}
                alt="Selected image"
              />
              <button
                onClick={clearSelectedImage}
                className="remove-image-btn"
                title="Remove image"
              >
                ×
              </button>
            </div>
            <div className="image-info">
              <span>
                Image selected - Will generate 3D scene from this image
              </span>
            </div>
          </div>
        )}

        <div className="input-container">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder={
              selectedImage
                ? "Add description (optional)..."
                : "Describe your 3D scene... (Ctrl+Enter to send)"
            }
            className="message-input"
            rows={3}
            disabled={!isConnected}
          />
          <div className="input-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.bmp"
              onChange={handleFileSelect}
              style={{ display: "none" }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading || !isConnected || isUploadingImage}
              className="image-upload-btn"
              title="Upload image to generate scene"
            >
              {isUploadingImage ? "..." : "Image"}
            </button>
            <button
              onClick={handleSendMessage}
              disabled={
                (!inputValue.trim() && !selectedImage) ||
                isLoading ||
                !isConnected
              }
              className="send-btn"
            >
              {isLoading ? <div className="loading-spinner" /> : "Send"}
            </button>
          </div>
        </div>

        <div className="input-hint">
          Press Ctrl+Enter to send • Upload images to generate 3D scenes • Be
          specific for better results
        </div>
      </div>

      <AgentProgressDialog
        isVisible={showProgressDialog}
        steps={agentSteps}
        onClose={() => setShowProgressDialog(false)}
      />

      <style jsx>{`
        .enhanced-chat-interface {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--bg-secondary);
        }

        .agent-status-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: var(--bg-card);
          border-bottom: 1px solid var(--border-primary);
          animation: slideDown 0.3s ease-out;
        }

        .status-content {
          display: flex;
          align-items: center;
          gap: 16px;
          flex: 1;
        }

        .status-indicator {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #22c55e;
          animation: pulse 2s infinite;
        }

        .status-text {
          font-size: 13px;
          color: var(--text-primary);
          font-weight: 500;
        }

        .progress-info {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .progress-bar {
          width: 100px;
          height: 4px;
          background: var(--bg-tertiary);
          border-radius: 2px;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          background: var(--accent-primary);
          transition: width 0.3s ease;
        }

        .progress-text {
          font-size: 11px;
          color: var(--text-secondary);
          white-space: nowrap;
        }

        .progress-btn {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
          color: var(--text-secondary);
          padding: 6px 12px;
          border-radius: 4px;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .progress-btn:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }

        .agent-reactions {
          padding: 12px 16px;
          background: var(--bg-card);
          border-bottom: 1px solid var(--border-primary);
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 150px;
          overflow-y: auto;
        }

        .reaction {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: var(--bg-tertiary);
          border-radius: 6px;
          font-size: 12px;
          animation: slideIn 0.3s ease-out;
        }

        .reaction-content {
          flex: 1;
          color: var(--text-primary);
        }

        .reaction-time {
          color: var(--text-tertiary);
          font-size: 10px;
        }

        .messages-area {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .messages-area::-webkit-scrollbar {
          width: 6px;
        }

        .messages-area::-webkit-scrollbar-track {
          background: var(--bg-tertiary);
          border-radius: 3px;
        }

        .messages-area::-webkit-scrollbar-thumb {
          background: var(--border-primary);
          border-radius: 3px;
        }

        .message {
          max-width: 85%;
          animation: messageSlideIn 0.3s ease-out;
        }

        .message-user {
          align-self: flex-end;
        }

        .message-assistant,
        .message-system {
          align-self: flex-start;
        }

        .message-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }

        .message-avatar {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: var(--bg-tertiary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .message-user .message-avatar {
          background: var(--accent-primary);
          color: var(--bg-primary);
        }

        .message-assistant .message-avatar {
          background: #22c55e;
          color: var(--bg-primary);
        }

        .message-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .message-sender {
          font-size: 12px;
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
          border-radius: 8px;
          padding: 12px;
          color: var(--text-primary);
          font-size: 14px;
          line-height: 1.5;
          word-wrap: break-word;
        }

        .message-user .message-content {
          background: var(--accent-primary);
          color: var(--bg-primary);
          border-color: var(--accent-primary);
        }

        .loading-content {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .loading-dots {
          display: flex;
          gap: 4px;
        }

        .loading-dots span {
          width: 6px;
          height: 6px;
          background: currentColor;
          border-radius: 50%;
          animation: loadingDots 1.4s infinite ease-in-out;
        }

        .loading-dots span:nth-child(1) {
          animation-delay: -0.32s;
        }
        .loading-dots span:nth-child(2) {
          animation-delay: -0.16s;
        }

        .agent-meta {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid var(--border-primary);
        }

        .meta-section {
          margin-bottom: 12px;
        }

        .meta-section h4 {
          margin: 0 0 6px 0;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .meta-section p {
          margin: 0;
          font-size: 12px;
          color: var(--text-secondary);
          line-height: 1.4;
        }

        .suggestions-list {
          margin: 0;
          padding: 0;
          list-style: none;
        }

        .suggestions-list li {
          padding: 6px 8px;
          background: var(--bg-input);
          border: 1px solid var(--border-primary);
          border-radius: 4px;
          margin-bottom: 4px;
          font-size: 12px;
          color: var(--text-primary);
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .suggestions-list li:hover {
          background: var(--bg-hover);
          border-color: var(--accent-primary);
        }

        .tools-list {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }

        .tool-tag {
          background: var(--bg-input);
          border: 1px solid var(--border-primary);
          border-radius: 4px;
          padding: 2px 6px;
          font-size: 11px;
          color: var(--accent-primary);
        }

        .confidence-bar {
          position: relative;
          height: 16px;
          background: var(--bg-input);
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          overflow: hidden;
          display: flex;
          align-items: center;
          padding: 0 8px;
        }

        .confidence-fill {
          position: absolute;
          left: 0;
          top: 0;
          height: 100%;
          background: linear-gradient(90deg, #ef4444, #f59e0b, #22c55e);
          transition: width 0.3s ease;
        }

        .confidence-bar span {
          position: relative;
          z-index: 1;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .follow-up-suggestions {
          padding: 16px;
          background: var(--bg-card);
          border-top: 1px solid var(--border-primary);
        }

        .follow-up-suggestions h4 {
          margin: 0 0 12px 0;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .suggestions-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .suggestion-btn {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
          color: var(--text-primary);
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .suggestion-btn:hover {
          background: var(--bg-hover);
          border-color: var(--accent-primary);
          transform: translateY(-1px);
        }

        .input-area {
          border-top: 1px solid var(--border-primary);
          background: var(--bg-card);
          padding: 16px;
        }

        .input-container {
          display: flex;
          gap: 8px;
          align-items: flex-end;
        }

        .message-input {
          flex: 1;
          background: var(--bg-input);
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          padding: 12px;
          color: var(--text-primary);
          font-family: inherit;
          font-size: 14px;
          line-height: 1.4;
          resize: none;
          outline: none;
          transition: all 0.2s ease;
        }

        .message-input::placeholder {
          color: var(--text-tertiary);
        }

        .message-input:focus {
          border-color: var(--accent-primary);
          box-shadow: 0 0 0 1px var(--accent-primary);
        }

        .message-input:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .send-btn {
          min-width: 64px;
          height: 44px;
          padding: 0 16px;
          background: var(--accent-primary);
          border: none;
          border-radius: 8px;
          color: var(--bg-primary);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .send-btn:hover:not(:disabled) {
          background: var(--accent-secondary);
          transform: translateY(-1px);
        }

        .send-btn:disabled {
          background: var(--bg-tertiary);
          color: var(--text-disabled);
          cursor: not-allowed;
          transform: none;
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
          margin-top: 8px;
          font-size: 11px;
          color: var(--text-tertiary);
        }

        .image-preview-container {
          margin-bottom: 12px;
          padding: 12px;
          background: var(--bg-card);
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .image-preview {
          position: relative;
          width: 60px;
          height: 60px;
          border-radius: 8px;
          overflow: hidden;
          flex-shrink: 0;
        }

        .image-preview img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .remove-image-btn {
          position: absolute;
          top: 4px;
          right: 4px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
          border-radius: 50%;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-primary);
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .remove-image-btn:hover {
          background: var(--bg-hover);
          border-color: var(--accent-primary);
          color: var(--accent-primary);
        }

        .image-info {
          font-size: 11px;
          color: var(--text-tertiary);
        }

        .input-actions {
          display: flex;
          gap: 8px;
          margin-top: 8px;
        }

        .image-upload-btn {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          padding: 8px 12px;
          color: var(--text-primary);
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .image-upload-btn:hover:not(:disabled) {
          background: var(--bg-hover);
          border-color: var(--accent-primary);
          color: var(--accent-primary);
        }

        .image-upload-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .message-image {
          margin-bottom: 8px;
          border-radius: 8px;
          overflow: hidden;
          max-width: 200px;
          border: 1px solid var(--border-primary);
        }

        .message-image img {
          width: 100%;
          height: auto;
          display: block;
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

        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(-10px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
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
      `}</style>
    </div>
  );
};

export default EnhancedChatInterface;
