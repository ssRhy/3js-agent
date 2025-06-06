import React from "react";

const EditorStyles: React.FC = () => {
  return (
    <style jsx>{`
      .editor-container {
        display: flex;
        height: 100vh;
        width: 100%;
        overflow: hidden;
        background: var(--bg-primary);
        color: var(--text-primary);
      }

      .sidebar {
        display: flex;
        flex-direction: column;
        height: 100vh;
        background: var(--bg-secondary);
        border-right: 1px solid var(--border-primary);
        overflow: hidden;
        position: relative;
        flex-shrink: 0;
      }

      .resize-handle {
        width: 4px;
        height: 100vh;
        background: var(--border-primary);
        cursor: col-resize;
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        user-select: none;
        z-index: 10;
        transition: all 0.2s ease;
      }

      .resize-handle:hover {
        background: var(--accent-subtle);
        width: 6px;
      }

      .resize-handle.dragging {
        background: var(--accent-primary);
        width: 6px;
      }

      .resize-handle-indicator {
        width: 2px;
        height: 40px;
        background: rgba(255, 255, 255, 0.3);
        border-radius: 1px;
        transition: all 0.2s ease;
      }

      .resize-handle:hover .resize-handle-indicator,
      .resize-handle.dragging .resize-handle-indicator {
        background: rgba(255, 255, 255, 0.6);
        height: 60px;
      }

      .sidebar-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--spacing-lg);
        border-bottom: 1px solid var(--border-primary);
        background: var(--bg-card);
      }

      .sidebar-header h2 {
        margin: 0;
        color: var(--text-primary);
        font-size: 18px;
        font-weight: 500;
        letter-spacing: -0.025em;
      }

      .prompt-section {
        padding: var(--spacing-lg);
        border-bottom: 1px solid var(--border-primary);
      }

      .prompt-label {
        display: block;
        margin-bottom: var(--spacing-sm);
        font-weight: 500;
        color: var(--text-secondary);
        font-size: 13px;
        letter-spacing: -0.01em;
      }

      .prompt-input {
        width: 100%;
        min-height: 80px;
        padding: var(--spacing-md);
        background: var(--bg-input);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-md);
        color: var(--text-primary);
        font-family: inherit;
        font-size: 14px;
        line-height: 1.5;
        resize: vertical;
        outline: none;
        transition: all 0.2s ease;
      }

      .prompt-input::placeholder {
        color: var(--text-tertiary);
      }

      .prompt-input:focus {
        border-color: var(--accent-subtle);
        background: var(--bg-card);
        box-shadow: 0 0 0 1px var(--accent-subtle);
      }

      .prompt-input:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .generate-button {
        position: relative;
        width: 100%;
        padding: var(--spacing-md) var(--spacing-lg);
        background: var(--accent-primary);
        color: var(--bg-primary);
        border: none;
        border-radius: var(--radius-md);
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        overflow: hidden;
        transition: all 0.2s ease;
        letter-spacing: -0.01em;
        margin-top: var(--spacing-md);
      }

      .generate-button:hover:not(:disabled) {
        background: var(--accent-secondary);
        transform: translateY(-1px);
        box-shadow: var(--shadow-medium);
      }

      .generate-button:disabled {
        background: var(--bg-tertiary);
        color: var(--text-disabled);
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
      }

      .button-background {
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(
          90deg,
          transparent,
          rgba(255, 255, 255, 0.1),
          transparent
        );
        transition: left 0.5s;
      }

      .button-background.loading {
        animation: shimmer 1.5s infinite;
      }

      @keyframes shimmer {
        0% {
          left: -100%;
        }
        100% {
          left: 100%;
        }
      }

      .status-section {
        padding: 0 var(--spacing-lg);
      }

      .preview {
        flex-grow: 1;
        height: 100vh;
        background: var(--bg-primary);
        position: relative;
        overflow: hidden;
      }

      .scene-exporter-container {
        position: absolute;
        top: var(--spacing-lg);
        right: var(--spacing-lg);
        z-index: 100;
        transition: all 0.2s ease;
      }

      .ui-controls-container {
        position: absolute;
        top: 50%;
        right: var(--spacing-lg);
        transform: translateY(-50%);
        z-index: 90;
      }

      .button-group {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
        margin-top: var(--spacing-sm);
      }

      .ws-status {
        padding: 6px 12px;
        margin: 0;
        border-radius: var(--radius-md);
        font-size: 12px;
        font-weight: 500;
        background: var(--bg-tertiary);
        border: 1px solid var(--border-primary);
        transition: all 0.2s ease;
        display: inline-flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .status-dot {
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .ws-status.open {
        color: var(--status-success);
        border-color: rgba(74, 222, 128, 0.3);
        background: rgba(74, 222, 128, 0.1);
      }

      .ws-status.open .status-dot {
        background: var(--status-success);
        box-shadow: 0 0 6px rgba(74, 222, 128, 0.4);
      }

      .ws-status.connecting {
        color: var(--status-warning);
        border-color: rgba(251, 191, 36, 0.3);
        background: rgba(251, 191, 36, 0.1);
      }

      .ws-status.connecting .status-dot {
        background: var(--status-warning);
        animation: pulse 2s ease-in-out infinite;
      }

      .ws-status.closed,
      .ws-status.error {
        color: var(--status-error);
        border-color: rgba(239, 68, 68, 0.3);
        background: rgba(239, 68, 68, 0.1);
      }

      .ws-status.closed .status-dot,
      .ws-status.error .status-dot {
        background: var(--status-error);
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

      .success {
        background: rgba(74, 222, 128, 0.1);
        border: 1px solid rgba(74, 222, 128, 0.3);
        border-left: 3px solid var(--status-success);
        color: var(--status-success);
        padding: var(--spacing-md);
        margin: var(--spacing-md) 0;
        border-radius: var(--radius-md);
        font-size: 13px;
        animation: fadeIn 0.3s ease;
      }

      .error {
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid rgba(239, 68, 68, 0.3);
        border-left: 3px solid var(--status-error);
        color: var(--status-error);
        padding: var(--spacing-md);
        margin: var(--spacing-md) 0;
        border-radius: var(--radius-md);
        font-size: 13px;
        animation: fadeIn 0.3s ease;
      }

      .loading-model {
        background: var(--bg-tertiary);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-md);
        color: var(--text-secondary);
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-md);
        margin: var(--spacing-md) 0;
      }

      .loading-spinner {
        width: 14px;
        height: 14px;
        border: 2px solid var(--border-primary);
        border-top: 2px solid var(--text-secondary);
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .reconnect-button {
        margin-left: var(--spacing-sm);
        padding: 4px 8px;
        background: var(--bg-tertiary);
        color: var(--text-secondary);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-sm);
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .reconnect-button:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
      }

      .connection-message {
        background: rgba(251, 191, 36, 0.1);
        border: 1px solid rgba(251, 191, 36, 0.3);
        border-radius: var(--radius-md);
        color: var(--status-warning);
        padding: var(--spacing-md);
        margin: var(--spacing-md) 0;
        font-size: 13px;
        text-align: center;
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(-10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      /* 代码编辑器 */
      .monaco-container {
        background: var(--bg-input);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-md);
        overflow: hidden;
      }

      /* Diff 切换 */
      .diff-toggle button {
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

      .diff-toggle button:hover {
        background: var(--bg-hover);
        border-color: var(--border-secondary);
      }

      /* 控制信息 */
      .controls-help {
        background: var(--bg-tertiary);
        border: 1px solid var(--border-primary);
        border-left: 3px solid var(--accent-subtle);
        border-radius: var(--radius-md);
        padding: var(--spacing-md);
        margin: var(--spacing-md) 0;
      }

      .controls-help p {
        margin: 0;
        color: var(--text-secondary);
        font-size: 12px;
        line-height: 1.5;
      }

      /* 通用按钮样式 */
      .model-btn {
        background: var(--bg-tertiary);
        border: 1px solid var(--border-primary);
        color: var(--text-primary);
        padding: var(--spacing-md) var(--spacing-lg);
        border-radius: var(--radius-md);
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .model-btn:hover {
        background: var(--bg-hover);
        border-color: var(--border-secondary);
        transform: translateY(-1px);
      }

      .model-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }

      .test-model-btn {
        background: var(--accent-primary);
        color: var(--bg-primary);
        border: none;
      }

      .test-model-btn:hover {
        background: var(--accent-secondary);
      }
    `}</style>
  );
};

export default EditorStyles;
