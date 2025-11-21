import React, { useState, useMemo } from "react";
import {
  useHistoryStore,
  VersionNode,
  ChatMessage,
} from "../../stores/useHistoryStore";

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
  Chat: () => (
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
        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
      />
    </svg>
  ),
  Code: () => (
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
        d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
      />
    </svg>
  ),
  AI: () => (
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
        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
      />
    </svg>
  ),
  Restore: () => (
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
        d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
      />
    </svg>
  ),
  Search: () => (
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
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
  ),
  Filter: () => (
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
        d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.414A1 1 0 013 6.707V4z"
      />
    </svg>
  ),
  Close: () => (
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
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  ),
  Compare: () => (
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
        d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
      />
    </svg>
  ),
  Delete: () => (
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
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  ),
};

// 时间格式化
const formatTime = (timestamp: string) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;

  return date.toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// 版本节点组件
const VersionNodeComponent: React.FC<{
  node: VersionNode;
  isSelected: boolean;
  isCurrent: boolean;
  onSelect: () => void;
  onRestore: () => void;
  onDelete: () => void;
  onCompare?: () => void;
}> = ({
  node,
  isSelected,
  isCurrent,
  onSelect,
  onRestore,
  onDelete,
  onCompare,
}) => {
  const getNodeIcon = () => {
    switch (node.changes?.type) {
      case "ai_generated":
        return <Icons.AI />;
      case "manual_edit":
        return <Icons.Code />;
      case "restore":
        return <Icons.Restore />;
      case "branch":
        return <Icons.Branch />;
      default:
        return <Icons.History />;
    }
  };

  const getNodeColor = () => {
    switch (node.changes?.type) {
      case "ai_generated":
        return "border-l-blue-500 bg-blue-50";
      case "manual_edit":
        return "border-l-green-500 bg-green-50";
      case "restore":
        return "border-l-orange-500 bg-orange-50";
      case "branch":
        return "border-l-purple-500 bg-purple-50";
      default:
        return "border-l-gray-500 bg-gray-50";
    }
  };

  return (
    <div
      className={`border-l-4 p-3 mb-2 rounded-r-lg cursor-pointer transition-all duration-200 ${
        isSelected ? "ring-2 ring-blue-300" : ""
      } ${
        isCurrent ? "bg-blue-100 border-l-blue-600" : getNodeColor()
      } hover:shadow-md`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-2 flex-1">
          <div className="mt-1">{getNodeIcon()}</div>
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-sm truncate">{node.title}</h4>
            {node.description && (
              <p className="text-xs text-gray-600 mt-1 line-clamp-2">
                {node.description}
              </p>
            )}
            <div className="flex items-center space-x-4 mt-2 text-xs text-gray-500">
              <span>{formatTime(node.timestamp)}</span>
              {node.changes && (
                <span className="flex items-center space-x-1">
                  <span className="text-green-600">
                    +{node.changes.linesAdded}
                  </span>
                  <span className="text-red-600">
                    -{node.changes.linesRemoved}
                  </span>
                </span>
              )}
              {node.chatHistory.length > 0 && (
                <span className="flex items-center space-x-1">
                  <Icons.Chat />
                  <span>{node.chatHistory.length}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-1 ml-2">
          {!isCurrent && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRestore();
              }}
              className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-100 rounded"
              title="恢复到此版本"
            >
              <Icons.Restore />
            </button>
          )}
          {onCompare && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCompare();
              }}
              className="p-1 text-gray-400 hover:text-purple-600 hover:bg-purple-100 rounded"
              title="对比版本"
            >
              <Icons.Compare />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-100 rounded"
            title="删除版本"
          >
            <Icons.Delete />
          </button>
        </div>
      </div>
    </div>
  );
};

// 聊天消息组件
const ChatMessageComponent: React.FC<{ message: ChatMessage }> = ({
  message,
}) => {
  const isUser = message.type === "user";

  return (
    <div className={`mb-3 ${isUser ? "ml-4" : "mr-4"}`}>
      <div
        className={`p-3 rounded-lg ${
          isUser
            ? "bg-blue-500 text-white ml-auto max-w-[80%]"
            : "bg-gray-100 text-gray-800 max-w-[80%]"
        }`}
      >
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        <p
          className={`text-xs mt-1 ${
            isUser ? "text-blue-100" : "text-gray-500"
          }`}
        >
          {formatTime(message.timestamp)}
        </p>
      </div>
    </div>
  );
};

// 分支选择器组件
const BranchSelector: React.FC = () => {
  const {
    branches,
    currentBranchId,
    switchToBranch,
    createBranch,
    deleteBranch,
  } = useHistoryStore();

  const [showCreateBranch, setShowCreateBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");

  const handleCreateBranch = () => {
    if (newBranchName.trim()) {
      createBranch(newBranchName.trim());
      setNewBranchName("");
      setShowCreateBranch(false);
    }
  };

  return (
    <div className="border-b pb-3 mb-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium text-sm">分支管理</h3>
        <button
          onClick={() => setShowCreateBranch(true)}
          className="text-xs text-blue-600 hover:text-blue-800"
        >
          + 新分支
        </button>
      </div>

      {showCreateBranch && (
        <div className="mb-2 p-2 bg-gray-50 rounded">
          <input
            type="text"
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            placeholder="分支名称"
            className="w-full px-2 py-1 text-xs border rounded"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateBranch();
              if (e.key === "Escape") setShowCreateBranch(false);
            }}
            autoFocus
          />
          <div className="flex space-x-1 mt-1">
            <button
              onClick={handleCreateBranch}
              className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              创建
            </button>
            <button
              onClick={() => setShowCreateBranch(false)}
              className="px-2 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600"
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className="space-y-1">
        {Array.from(branches.values()).map((branch) => (
          <div
            key={branch.id}
            className={`flex items-center justify-between p-2 rounded cursor-pointer ${
              branch.id === currentBranchId
                ? "bg-blue-100 text-blue-800"
                : "hover:bg-gray-100"
            }`}
            onClick={() => switchToBranch(branch.id)}
          >
            <div className="flex items-center space-x-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: branch.color }}
              />
              <span className="text-sm font-medium">{branch.name}</span>
            </div>
            {branch.id !== "main" && branch.id !== currentBranchId && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteBranch(branch.id);
                }}
                className="p-1 text-gray-400 hover:text-red-600 rounded"
              >
                <Icons.Delete />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// 主面板组件
export const HistoryPanel: React.FC = () => {
  const {
    isHistoryPanelOpen,
    setHistoryPanelOpen,
    nodes,
    currentNodeId,
    selectedNodeId,
    setSelectedNode,
    searchQuery,
    setSearchQuery,
    filterType,
    setFilterType,
    switchToNode,
    deleteNode,
    filterNodes,
    searchNodes,
    getChatHistory,
    compareNodes: compareNodesFunction,
  } = useHistoryStore();

  const [activeTab, setActiveTab] = useState<"history" | "chat">("history");
  const [compareMode, setCompareMode] = useState(false);
  const [compareNodes, setCompareNodes] = useState<string[]>([]);

  // 获取过滤后的节点
  const filteredNodes = useMemo(() => {
    let results = filterNodes(filterType);

    if (searchQuery.trim()) {
      results = searchNodes(searchQuery.trim());
    }

    return results;
  }, [filterNodes, searchNodes, filterType, searchQuery, nodes]);

  // 获取当前选中节点的聊天历史
  const currentChatHistory = useMemo(() => {
    return getChatHistory((selectedNodeId || currentNodeId) ?? undefined);
  }, [getChatHistory, selectedNodeId, currentNodeId]);

  // 处理节点恢复
  const handleRestoreNode = async (nodeId: string) => {
    if (await switchToNode(nodeId)) {
      console.log("版本恢复成功");
    }
  };

  // 处理节点对比
  const handleCompareNode = (nodeId: string) => {
    if (compareMode) {
      if (compareNodes.includes(nodeId)) {
        setCompareNodes(compareNodes.filter((id) => id !== nodeId));
      } else if (compareNodes.length < 2) {
        setCompareNodes([...compareNodes, nodeId]);
      }
    } else {
      setCompareMode(true);
      setCompareNodes([nodeId]);
    }
  };

  // 执行对比
  const executeCompare = () => {
    if (compareNodes.length === 2) {
      const comparison =
        compareNodes[0] && compareNodes[1]
          ? compareNodesFunction(compareNodes[0], compareNodes[1])
          : null;

      if (comparison) {
        console.log("版本对比结果:", comparison);
        // 这里可以打开对比窗口或显示对比结果
      }
    }
  };

  if (!isHistoryPanelOpen) {
    return null;
  }

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-white shadow-xl border-l border-gray-200 z-50 flex flex-col">
      {/* 头部 */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">版本历史</h2>
          <button
            onClick={() => setHistoryPanelOpen(false)}
            className="p-1 text-gray-400 hover:text-gray-600 rounded"
          >
            <Icons.Close />
          </button>
        </div>

        {/* 标签切换 */}
        <div className="flex space-x-1 mb-3">
          <button
            onClick={() => setActiveTab("history")}
            className={`px-3 py-1 text-sm rounded ${
              activeTab === "history"
                ? "bg-blue-500 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            版本历史
          </button>
          <button
            onClick={() => setActiveTab("chat")}
            className={`px-3 py-1 text-sm rounded ${
              activeTab === "chat"
                ? "bg-blue-500 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            聊天记录
          </button>
        </div>

        {/* 搜索和过滤 */}
        {activeTab === "history" && (
          <div className="space-y-2">
            <div className="relative">
              <Icons.Search />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索版本..."
                className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <div className="absolute left-2 top-2.5 text-gray-400">
                <Icons.Search />
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Icons.Filter />
              <select
                value={filterType}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onChange={(e) => setFilterType(e.target.value as any)}
                className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">全部</option>
                <option value="ai">AI 生成</option>
                <option value="manual">手动编辑</option>
                <option value="restore">版本恢复</option>
              </select>
            </div>
          </div>
        )}

        {/* 对比模式 */}
        {compareMode && (
          <div className="mt-2 p-2 bg-purple-50 border border-purple-200 rounded">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-purple-700">
                对比模式 ({compareNodes.length}/2)
              </span>
              <button
                onClick={() => {
                  setCompareMode(false);
                  setCompareNodes([]);
                }}
                className="text-xs text-purple-600 hover:text-purple-800"
              >
                退出
              </button>
            </div>
            {compareNodes.length === 2 && (
              <button
                onClick={executeCompare}
                className="w-full px-2 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600"
              >
                执行对比
              </button>
            )}
          </div>
        )}
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === "history" ? (
          <div className="flex-1 flex flex-col">
            {/* 分支管理 */}
            <div className="p-4">
              <BranchSelector />
            </div>

            {/* 版本列表 */}
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              {filteredNodes.length === 0 ? (
                <div className="text-center text-gray-500 mt-8">
                  <Icons.History />
                  <p className="mt-2 text-sm">没有找到版本记录</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredNodes.map((node) => (
                    <VersionNodeComponent
                      key={node.id}
                      node={node}
                      isSelected={selectedNodeId === node.id}
                      isCurrent={currentNodeId === node.id}
                      onSelect={() => setSelectedNode(node.id)}
                      onRestore={() => handleRestoreNode(node.id)}
                      onDelete={() => deleteNode(node.id)}
                      onCompare={() => handleCompareNode(node.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* 聊天记录 */
          <div className="flex-1 overflow-y-auto p-4">
            {currentChatHistory.length === 0 ? (
              <div className="text-center text-gray-500 mt-8">
                <Icons.Chat />
                <p className="mt-2 text-sm">没有聊天记录</p>
              </div>
            ) : (
              <div className="space-y-2">
                {currentChatHistory.map((message) => (
                  <ChatMessageComponent key={message.id} message={message} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
