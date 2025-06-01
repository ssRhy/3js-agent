import React from "react";

const EditorStyles: React.FC = () => {
  return (
    <style jsx>{`
      .editor-container {
        display: flex;
        height: 100vh;
        width: 100%;
        overflow: hidden;
        position: relative;
        background-color: #0f0f0f;
        color: #e0e0e0;
      }

      .sidebar {
        display: flex;
        flex-direction: column;
        width: 30%;
        min-width: 350px;
        max-width: 45%;
        padding: 15px;
        background-color: #121212;
        border-right: 1px solid #333;
        overflow-y: auto;
        resize: horizontal;
        position: relative;
        transition: background-color 0.3s ease;
      }

      .resize-handle {
        width: 4px;
        height: 100%;
        background-color: #333;
        cursor: col-resize;
        position: absolute;
        top: 0;
        left: 30%;
        z-index: 10;
        transition: background-color 0.2s ease;
      }

      .resize-handle:hover {
        background-color: #555;
      }

      .sidebar-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid #333;
      }

      .sidebar-header h2 {
        margin: 0;
        color: #e0e0e0;
        font-size: 16px;
        font-weight: 400;
        letter-spacing: 0.5px;
      }

      .prompt-section {
        margin-bottom: 8px;
      }

      .prompt-label {
        display: block;
        margin-bottom: 4px;
        font-weight: normal;
        color: #aaa;
        font-size: 13px;
        letter-spacing: 0.5px;
      }

      .status-section {
        margin-bottom: 8px;
      }

      .preview {
        flex-grow: 1;
        height: 100%;
        position: relative;
        background-color: #0a0a0a;
      }

      .scene-exporter-container {
        position: absolute;
        top: 20px;
        right: 20px;
        width: 300px;
        z-index: 100;
        transition: all 0.3s ease;
        filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.3));
      }

      .ui-controls-container {
        position: absolute;
        top: 50%;
        right: 20px;
        transform: translateY(-50%);
        z-index: 90;
      }

      .button-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 8px;
      }

      .ws-status {
        padding: 4px 8px;
        margin: 4px 0;
        border-radius: 3px;
        font-size: 12px;
        display: flex;
        align-items: center;
        gap: 5px;
      }

      .status-dot {
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 50%;
      }

      .ws-status.open {
        background-color: rgba(35, 35, 35, 0.8);
        color: #aaa;
      }

      .ws-status.open .status-dot {
        background-color: #5f5;
      }

      .ws-status.connecting {
        background-color: rgba(35, 35, 35, 0.8);
        color: #aaa;
      }

      .ws-status.connecting .status-dot {
        background-color: #fa3;
      }

      .ws-status.closed,
      .ws-status.error {
        background-color: rgba(35, 35, 35, 0.8);
        color: #aaa;
      }

      .ws-status.closed .status-dot,
      .ws-status.error .status-dot {
        background-color: #f55;
      }

      .success {
        background-color: rgba(35, 35, 35, 0.8);
        color: #aaa;
        padding: 6px 10px;
        margin: 6px 0;
        border-radius: 3px;
        border-left: 3px solid #5f5;
        animation: fadeIn 0.3s ease;
        font-size: 12px;
      }

      .error {
        background-color: rgba(35, 35, 35, 0.8);
        color: #aaa;
        padding: 6px 10px;
        margin: 6px 0;
        border-radius: 3px;
        border-left: 3px solid #f55;
        animation: fadeIn 0.3s ease;
        font-size: 12px;
      }

      .reconnect-button {
        margin-left: 8px;
        font-size: 12px;
        padding: 2px 6px;
        background: #333;
        color: #ddd;
        border: none;
        border-radius: 2px;
        cursor: pointer;
      }

      .reconnect-button:hover {
        background: #444;
      }

      .connection-message {
        background-color: rgba(35, 35, 35, 0.8);
        border: 1px solid #333;
        color: #aaa;
        padding: 12px;
        margin: 10px 0;
        border-radius: 3px;
        text-align: center;
      }

      .connection-message p {
        margin: 5px 0;
      }

      .prompt-input {
        width: 100%;
        padding: 8px;
        margin-bottom: 8px;
        border: 1px solid #333;
        background-color: #1a1a1a;
        color: #e0e0e0;
        border-radius: 3px;
        resize: vertical;
        font-family: "Inter", "Arial", sans-serif;
        transition: all 0.2s ease;
        min-height: 80px;
        max-height: 120px;
      }

      .prompt-input:focus {
        border-color: #555;
        box-shadow: 0 0 0 1px rgba(100, 100, 100, 0.3);
        outline: none;
      }

      .prompt-input::placeholder {
        color: #666;
      }

      .prompt-input:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .generate-button {
        position: relative;
        background-color: transparent;
        color: #e0e0e0;
        border: none;
        padding: 10px 16px;
        border-radius: 3px;
        cursor: pointer;
        font-weight: 500;
        font-size: 13px;
        letter-spacing: 0.5px;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        text-transform: uppercase;
        overflow: hidden;
      }

      .generate-button .button-background {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: -1;
        border-radius: 3px;
        background-color: #333;
        opacity: 1;
        transition: all 0.3s ease;
      }

      .generate-button .button-background.loading {
        background-size: 200% 200%;
        animation: loading-gradient 1.5s linear infinite;
      }

      .generate-button:hover:not(:disabled) .button-background {
        background-color: #444;
      }

      .generate-button:active:not(:disabled) .button-background {
        background-color: #222;
        transform: scale(0.98);
      }

      .generate-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      @keyframes loading-gradient {
        0% {
          background-position: 0% 50%;
          background-image: linear-gradient(
            90deg,
            #333 0%,
            #444 50%,
            #333 100%
          );
        }
        100% {
          background-position: 100% 50%;
          background-image: linear-gradient(
            90deg,
            #333 0%,
            #444 50%,
            #333 100%
          );
        }
      }

      .code-section {
        display: flex;
        flex-direction: column;
        flex-grow: 1;
        height: calc(100% - 180px);
        margin-top: 8px;
        border: 1px solid #333;
        border-radius: 3px;
        overflow: hidden;
      }

      .code-header {
        background-color: #1a1a1a;
        color: #aaa;
        margin: 0;
        padding: 6px 10px;
        font-size: 13px;
        border-bottom: 1px solid #333;
        font-weight: normal;
        letter-spacing: 0.5px;
      }

      .loading-model {
        display: flex;
        align-items: center;
        gap: 6px;
        background-color: rgba(35, 35, 35, 0.8);
        border: 1px solid #333;
        border-radius: 3px;
        padding: 6px 8px;
        margin: 6px 0;
        color: #aaa;
        font-size: 12px;
      }

      .loading-spinner {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        border: 2px solid #aaa;
        border-top-color: transparent;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .diff-toggle {
        margin: 6px 0;
      }

      .diff-toggle button {
        background: #333;
        color: #ddd;
        border: none;
        padding: 4px 8px;
        border-radius: 3px;
        cursor: pointer;
        font-size: 12px;
      }

      .diff-toggle button:hover {
        background: #444;
      }

      .lint-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.7);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
      }

      .lint-overlay-content {
        background-color: #1a1a1a;
        border-radius: 3px;
        padding: 20px;
        width: 80%;
        max-width: 800px;
        max-height: 80vh;
        overflow-y: auto;
        position: relative;
        color: #ddd;
        border: 1px solid #333;
      }

      .close-button {
        position: absolute;
        top: 10px;
        right: 10px;
        background: none;
        border: none;
        font-size: 20px;
        cursor: pointer;
        color: #ddd;
      }

      .lint-errors-list {
        list-style: none;
        padding: 0;
        margin: 0;
      }

      .lint-error-item {
        padding: 8px;
        border-bottom: 1px solid #333;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .lint-error-location {
        font-weight: bold;
        color: #aaa;
        min-width: 80px;
      }

      .lint-error-message {
        flex-grow: 1;
        color: #ddd;
      }

      .lint-error-rule {
        color: #888;
        font-size: 12px;
      }

      .update-reminder {
        display: flex;
        align-items: center;
        background-color: rgba(35, 126, 35, 0.2);
        color: #aaddaa;
        padding: 6px 10px;
        margin: 6px 0;
        border-radius: 3px;
        border-left: 3px solid #5f5;
        animation: fadeIn 0.3s ease;
        font-size: 12px;
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(-5px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @media (max-width: 768px) {
        .editor-container {
          flex-direction: column;
        }

        .sidebar {
          width: 100%;
          min-width: 0;
          height: 50%;
          max-width: 100%;
          resize: vertical;
        }

        .resize-handle {
          display: none;
        }

        .preview {
          height: 50%;
        }

        .code-section {
          height: calc(100% - 160px);
        }
      }

      @media (max-height: 800px) {
        .scene-exporter-container {
          top: 10px;
        }

        .ui-controls-container {
          top: 50%;
          right: 20px;
          transform: translateY(-50%);
        }
      }
    `}</style>
  );
};

export default EditorStyles;
