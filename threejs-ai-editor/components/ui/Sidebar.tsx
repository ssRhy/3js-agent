import React from "react";
import { SocketConnectionStatus } from "../../hooks/socket/useSocketConnection";
import StatusSection from "./StatusSection";
import CodeEditor from "../editor/CodeEditor";
import VersionHistory from "./VersionHistory";
import { HistoryEntry } from "../../stores/useSceneStore";

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
}) => {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>Three.js AI Editor</h2>
        <div className={`ws-status ${socketConnectionStatus}`}>
          <span className="status-dot"></span>
          {socketConnectionStatus === "open"
            ? "Connected"
            : socketConnectionStatus === "connecting"
            ? "Connecting..."
            : socketConnectionStatus === "closed"
            ? "Disconnected"
            : "Connection error"}
          {socketConnectionStatus !== "open" && (
            <button onClick={manualReconnect} className="reconnect-button">
              Reconnect
            </button>
          )}
        </div>
      </div>

      <div className="prompt-section">
        <label htmlFor="prompt-input" className="prompt-label">
          Input the description of the scene you want to create:
        </label>
        <textarea
          id="prompt-input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="For example: Add a rotating red sphere or generate a red cat"
          rows={4}
          className="prompt-input"
          disabled={socketConnectionStatus !== "open"}
        />
        <div className="button-group">
          <button
            onClick={handleGenerate}
            disabled={
              isLoading || isModelLoading || socketConnectionStatus !== "open"
            }
            className="generate-button"
          >
            {isLoading
              ? "Generating..."
              : socketConnectionStatus !== "open"
              ? "Waiting for connection..."
              : "Generate and analyze the scene"}
            <div
              className={`button-background ${isLoading ? "loading" : ""}`}
            ></div>
          </button>
        </div>
      </div>

      {socketConnectionStatus !== "open" && (
        <div className="connection-message">
          <p>Establishing Socket.IO connection, please wait...</p>
        </div>
      )}

      <StatusSection error={error} isModelLoading={isModelLoading} />

      <VersionHistory onVersionRevert={onVersionRevert} />

      {previousCode && code !== previousCode && (
        <div className="diff-toggle">
          <button onClick={() => setShowDiff(!showDiff)}>
            {showDiff ? "Hide code differences" : "Show code differences"}
          </button>
        </div>
      )}

      <CodeEditor
        code={showDiff && diff ? diff : code}
        onChange={setCode}
        lintErrors={lintErrors}
      />
    </div>
  );
};

export default Sidebar;
