import React, { useState } from "react";
import { useSceneStore, HistoryEntry } from "../../stores/useSceneStore";

interface VersionHistoryProps {
  onVersionRevert?: (index: number, entry: HistoryEntry) => void;
}

const VersionHistory: React.FC<VersionHistoryProps> = ({ onVersionRevert }) => {
  const {
    getHistoryEntries,
    revertToVersion,
    deleteHistoryEntry,
    clearHistory,
    getCurrentVersion,
  } = useSceneStore();

  const [showHistory, setShowHistory] = useState(false);
  const [isReverting, setIsReverting] = useState(false);

  const historyEntries = getHistoryEntries();
  const currentVersion = getCurrentVersion();

  const handleRevertToVersion = async (index: number) => {
    if (isReverting) return;

    setIsReverting(true);
    try {
      const entry = historyEntries[index];
      const success = await revertToVersion(index);

      if (success && onVersionRevert) {
        onVersionRevert(index, entry);
      }
    } catch (error) {
      console.error("版本恢复失败:", error);
    } finally {
      setIsReverting(false);
    }
  };

  const handleDeleteEntry = (index: number, event: React.MouseEvent) => {
    event.stopPropagation();
    if (
      window.confirm("Are you sure you want to delete this history version?")
    ) {
      deleteHistoryEntry(index);
    }
  };

  const handleClearHistory = () => {
    if (
      window.confirm(
        "Are you sure you want to clear all history versions? This action cannot be undone."
      )
    ) {
      clearHistory();
    }
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "Unknown time";
    }
  };

  const truncateCode = (code: string, maxLength: number = 50) => {
    if (code.length <= maxLength) return code;
    return code.substring(0, maxLength) + "...";
  };

  if (historyEntries.length === 0) {
    return (
      <div className="version-history">
        <button
          className="history-toggle"
          onClick={() => setShowHistory(!showHistory)}
        >
          Version History (0)
        </button>
        {showHistory && (
          <div className="history-panel">
            <p className="no-history">No history version</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="version-history">
      <button
        className="history-toggle"
        onClick={() => setShowHistory(!showHistory)}
      >
        Version History ({historyEntries.length})
      </button>

      {showHistory && (
        <div className="history-panel">
          <div className="history-header">
            <h3>History Version</h3>
            <button
              className="clear-history-btn"
              onClick={handleClearHistory}
              disabled={isReverting}
            >
              Clear
            </button>
          </div>

          <div className="history-list">
            {historyEntries.map((entry, index) => (
              <div
                key={index}
                className={`history-entry ${
                  index === currentVersion ? "current" : ""
                }`}
                onClick={() => handleRevertToVersion(index)}
              >
                <div className="entry-info">
                  <span className="version-number">
                    v{index + 1}
                    {index === currentVersion && (
                      <span className="current-badge">Current</span>
                    )}
                  </span>
                  <span className="timestamp">
                    {formatTimestamp(entry.timestamp)}
                  </span>
                  <button
                    className="delete-btn"
                    onClick={(e) => handleDeleteEntry(index, e)}
                    disabled={isReverting}
                    title="Delete this version"
                  >
                    ×
                  </button>
                </div>
                <div className="code-preview">{truncateCode(entry.code)}</div>
              </div>
            ))}
          </div>

          {isReverting && (
            <div className="reverting-overlay">
              <div className="reverting-message">Reverting...</div>
            </div>
          )}
        </div>
      )}

      <style jsx>{`
        .version-history {
          margin-bottom: 10px;
        }

        .history-toggle {
          width: 100%;
          padding: 6px 10px;
          background: #333;
          border: 1px solid #444;
          border-radius: 3px;
          color: #ddd;
          cursor: pointer;
          font-size: 12px;
          transition: background-color 0.2s;
        }

        .history-toggle:hover {
          background: #444;
        }

        .history-panel {
          position: relative;
          background: #1a1a1a;
          border: 1px solid #333;
          border-radius: 3px;
          margin-top: 6px;
          max-height: 200px;
          overflow: hidden;
        }

        .history-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 6px 10px;
          border-bottom: 1px solid #333;
          background: #2a2a2a;
        }

        .history-header h3 {
          margin: 0;
          color: #ddd;
          font-size: 11px;
          font-weight: normal;
        }

        .clear-history-btn {
          padding: 2px 6px;
          background: #dc3545;
          border: none;
          border-radius: 2px;
          color: white;
          cursor: pointer;
          font-size: 10px;
        }

        .clear-history-btn:hover:not(:disabled) {
          background: #c82333;
        }

        .clear-history-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .history-list {
          max-height: 150px;
          overflow-y: auto;
        }

        .history-entry {
          padding: 6px 10px;
          border-bottom: 1px solid #333;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .history-entry:hover {
          background: #2a2a2a;
        }

        .history-entry.current {
          background: #1e3a2e;
          border-left: 3px solidrgb(16, 16, 16);
        }

        .entry-info {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 4px;
        }

        .version-number {
          color: #007bff;
          font-size: 10px;
          font-weight: bold;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .current-badge {
          background: rgb(39, 41, 39);
          color: white;
          padding: 1px 4px;
          border-radius: 8px;
          font-size: 8px;
        }

        .timestamp {
          color: #888;
          font-size: 9px;
        }

        .delete-btn {
          background: none;
          border: none;
          color: #dc3545;
          cursor: pointer;
          font-size: 12px;
          font-weight: bold;
          padding: 0;
          width: 14px;
          height: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .delete-btn:hover:not(:disabled) {
          background: #dc3545;
          color: white;
          border-radius: 50%;
        }

        .delete-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .code-preview {
          background: #333;
          padding: 2px 4px;
          border-radius: 2px;
          color: #e6db74;
          font-size: 9px;
          font-family: monospace;
          overflow: hidden;
        }

        .no-history {
          padding: 12px;
          text-align: center;
          color: #888;
          margin: 0;
          font-size: 11px;
        }

        .reverting-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.8);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .reverting-message {
          background: #007bff;
          color: white;
          padding: 8px 16px;
          border-radius: 3px;
          font-size: 11px;
        }
      `}</style>
    </div>
  );
};

export default VersionHistory;
