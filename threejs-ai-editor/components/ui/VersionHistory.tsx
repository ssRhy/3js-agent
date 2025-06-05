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
      console.error("Revert failed:", error);
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
      return date.toLocaleString("zh-CN", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "Unknown time";
    }
  };

  const truncatePrompt = (prompt: string, maxLength: number = 30) => {
    if (!prompt || prompt.length <= maxLength)
      return prompt || "No history version";
    return prompt.substring(0, maxLength) + "...";
  };

  if (historyEntries.length === 0) {
    return (
      <div className="version-history">
        <button
          className="history-toggle"
          onClick={() => setShowHistory(!showHistory)}
        >
          版本历史 (0)
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
            <span>历史版本</span>
            <button
              className="clear-btn"
              onClick={handleClearHistory}
              disabled={isReverting}
            >
              clear
            </button>
          </div>

          <div className="history-list">
            {historyEntries.map((entry, index) => (
              <div
                key={index}
                className={`history-item ${
                  index === currentVersion ? "current" : ""
                }`}
                onClick={() => handleRevertToVersion(index)}
              >
                <div className="item-header">
                  <span className="version-label">
                    v{index + 1}
                    {index === currentVersion && (
                      <span className="current-tag">current</span>
                    )}
                  </span>
                  <span className="timestamp">
                    {formatTimestamp(entry.timestamp)}
                  </span>
                  <button
                    className="delete-btn"
                    onClick={(e) => handleDeleteEntry(index, e)}
                    disabled={isReverting}
                    title="Delete version"
                  >
                    ×
                  </button>
                </div>
                <div className="user-prompt">
                  {truncatePrompt(entry.userPrompt || "")}
                </div>
              </div>
            ))}
          </div>

          {isReverting && (
            <div className="loading-overlay">
              <div className="loading-text">reverting...</div>
            </div>
          )}
        </div>
      )}

      <style jsx>{`
        .version-history {
          margin-bottom: 0;
        }

        .history-toggle {
          width: 100%;
          padding: 6px 10px;
          background: #2a2a2a;
          border: 1px solid #404040;
          border-radius: 4px;
          color: #e0e0e0;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.2s;
        }

        .history-toggle:hover {
          background: #333;
          border-color: #555;
        }

        .history-panel {
          position: relative;
          background: #1e1e1e;
          border: 1px solid #333;
          border-radius: 4px;
          margin-top: 4px;
          max-height: 200px;
          overflow: hidden;
        }

        .history-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 6px 10px;
          border-bottom: 1px solid #333;
          background: #252525;
          font-size: 11px;
          color: #ccc;
        }

        .clear-btn {
          padding: 2px 6px;
          background: #e74c3c;
          border: none;
          border-radius: 3px;
          color: white;
          cursor: pointer;
          font-size: 10px;
          transition: background 0.2s;
        }

        .clear-btn:hover:not(:disabled) {
          background: #c0392b;
        }

        .clear-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .history-list {
          max-height: 150px;
          overflow-y: auto;
        }

        .history-item {
          padding: 5px 8px;
          border-bottom: 1px solid #2a2a2a;
          cursor: pointer;
          transition: background 0.2s;
        }

        .history-item:hover {
          background: #2a2a2a;
        }

        .history-item.current {
          background: #1a2f1f;
          border-left: 3px solid #4caf50;
        }

        .item-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2px;
        }

        .version-label {
          color: #ffffff;
          font-size: 10px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .current-tag {
          background: #4caf50;
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
          color: #e74c3c;
          cursor: pointer;
          font-size: 12px;
          font-weight: bold;
          padding: 1px;
          width: 14px;
          height: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 2px;
          transition: all 0.2s;
        }

        .delete-btn:hover:not(:disabled) {
          background: #e74c3c;
          color: white;
        }

        .delete-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .user-prompt {
          background: #2a2a2a;
          padding: 2px 6px;
          border-radius: 3px;
          color: #f39c12;
          font-size: 9px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          line-height: 1.2;
        }

        .no-history {
          padding: 12px;
          text-align: center;
          color: #666;
          margin: 0;
          font-size: 11px;
        }

        .loading-overlay {
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

        .loading-text {
          background: #4caf50;
          color: white;
          padding: 6px 12px;
          border-radius: 4px;
          font-size: 11px;
        }
      `}</style>
    </div>
  );
};

export default VersionHistory;
