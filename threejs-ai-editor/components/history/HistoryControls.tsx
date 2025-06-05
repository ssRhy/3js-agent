import React, { useState } from "react";
import { useVersionControl } from "../../hooks/useVersionControl";
import { useHistoryStore } from "../../stores/useHistoryStore";

// 图标组件
const Icons = {
  History: () => (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  ),
  Save: () => (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3-3m0 0l-3 3m3-3v12"
      />
    </svg>
  ),
  Export: () => (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  ),
  Import: () => (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"
      />
    </svg>
  ),
  Branch: () => (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  ),
  Plus: () => (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 6v6m0 0v6m0-6h6m-6 0H6"
      />
    </svg>
  ),
  Search: () => (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
  ),
};

// 快照创建模态框
const SnapshotModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSave: (description: string) => void;
}> = ({ isOpen, onClose, onSave }) => {
  const [description, setDescription] = useState("");

  const handleSave = () => {
    if (description.trim()) {
      onSave(description.trim());
      setDescription("");
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-96 max-w-full mx-4">
        <h3 className="text-lg font-semibold mb-4">创建版本快照</h3>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            版本描述
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="描述这个版本的变更内容..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            rows={3}
            autoFocus
          />
        </div>

        <div className="flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!description.trim()}
            className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            创建快照
          </button>
        </div>
      </div>
    </div>
  );
};

// 历史控制组件
export const HistoryControls: React.FC<{
  className?: string;
}> = ({ className = "" }) => {
  const {
    toggleHistoryPanel,
    isHistoryPanelOpen,
    manualSnapshot,
    exportVersionData,
    importVersionData,
  } = useVersionControl();

  const { nodes, branches, currentBranchId, createBranch } = useHistoryStore();

  const [showSnapshotModal, setShowSnapshotModal] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);

  // 处理快照创建
  const handleCreateSnapshot = async (description: string) => {
    await manualSnapshot(description);
  };

  // 处理文件导入
  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      importVersionData(file);
      // 重置文件输入
      event.target.value = "";
    }
  };

  // 快速创建分支
  const handleQuickBranch = () => {
    const branchName = prompt("请输入分支名称:");
    if (branchName?.trim()) {
      createBranch(branchName.trim());
    }
  };

  const currentBranch = branches.get(currentBranchId);
  const nodeCount = nodes.size;

  return (
    <>
      <div className={`flex items-center space-x-2 ${className}`}>
        {/* 主要历史按钮 */}
        <button
          onClick={toggleHistoryPanel}
          className={`flex items-center space-x-2 px-3 py-2 rounded-lg transition-colors ${
            isHistoryPanelOpen
              ? "bg-blue-500 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
          title="打开版本历史"
        >
          <Icons.History />
          <span className="text-sm font-medium">历史</span>
          {nodeCount > 0 && (
            <span className="bg-blue-600 text-white text-xs px-2 py-1 rounded-full">
              {nodeCount}
            </span>
          )}
        </button>

        {/* 快速操作下拉菜单 */}
        <div className="relative">
          <button
            onClick={() => setShowQuickActions(!showQuickActions)}
            className="p-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
            title="快速操作"
          >
            <Icons.Plus />
          </button>

          {showQuickActions && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-48">
              <button
                onClick={() => {
                  setShowSnapshotModal(true);
                  setShowQuickActions(false);
                }}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center space-x-2"
              >
                <Icons.Save />
                <span>创建快照</span>
              </button>

              <button
                onClick={() => {
                  handleQuickBranch();
                  setShowQuickActions(false);
                }}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center space-x-2"
              >
                <Icons.Branch />
                <span>创建分支</span>
              </button>

              <hr className="my-1" />

              <button
                onClick={() => {
                  exportVersionData();
                  setShowQuickActions(false);
                }}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center space-x-2"
              >
                <Icons.Export />
                <span>导出历史</span>
              </button>

              <label className="w-full block">
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImportFile}
                  className="hidden"
                />
                <div className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center space-x-2 cursor-pointer">
                  <Icons.Import />
                  <span>导入历史</span>
                </div>
              </label>
            </div>
          )}
        </div>

        {/* 当前分支指示器 */}
        {currentBranch && (
          <div className="flex items-center space-x-1 px-2 py-1 bg-gray-50 rounded text-xs text-gray-600">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: currentBranch.color }}
            />
            <span>{currentBranch.name}</span>
          </div>
        )}
      </div>

      {/* 快照创建模态框 */}
      <SnapshotModal
        isOpen={showSnapshotModal}
        onClose={() => setShowSnapshotModal(false)}
        onSave={handleCreateSnapshot}
      />

      {/* 点击外部关闭下拉菜单 */}
      {showQuickActions && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setShowQuickActions(false)}
        />
      )}
    </>
  );
};
