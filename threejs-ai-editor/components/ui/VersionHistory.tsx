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

  const truncatePrompt = (prompt: string, maxLength: number = 30) => {
    if (!prompt || prompt.length <= maxLength)
      return prompt || "No description";
    return prompt.substring(0, maxLength) + "...";
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
            <p className="no-history">No version history available</p>
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
            <span>History Versions</span>
            <button
              className="clear-history-btn"
              onClick={handleClearHistory}
              disabled={isReverting}
            >
              Clear All
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
                <div className="entry-header">
                  <span className="version-number">
                    v{index + 1}
                    {index === currentVersion && (
                      <span className="current-badge">current</span>
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
                <div className="entry-content">
                  {truncatePrompt(entry.userPrompt || "")}
                </div>
              </div>
            ))}
          </div>

          {isReverting && (
            <div className="reverting-overlay">
              <div className="reverting-message">
                <span>Reverting to version...</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default VersionHistory;
