// Socket.IO client utilities for agent-driven screenshot requests
import { create } from "zustand";
import { Socket, io } from "socket.io-client";

// Interface for screenshot request data
export interface ScreenshotRequest {
  requestId: string;
  timestamp: number;
  resolve: (result: {
    status: string;
    screenshot?: string;
    error?: string;
  }) => void;
  timeout: NodeJS.Timeout;
}

// Interface for the Socket.IO store
interface SocketStore {
  // Connection state
  isConnected: boolean;
  connectionError: string | null;

  // Socket.IO instance (singleton)
  socket: Socket | null;

  // Client ID assigned by server
  clientId: string | null;

  // Pending requests
  pendingRequests: Map<string, ScreenshotRequest>;

  // Connection management
  connect: () => void;
  disconnect: () => void;

  // Request tracking
  addRequest: (
    requestId: string,
    resolve: (result: {
      status: string;
      screenshot?: string;
      error?: string;
    }) => void
  ) => void;

  resolveRequest: (
    requestId: string,
    result: { status: string; screenshot?: string; error?: string }
  ) => void;

  // State setters
  setSocket: (socket: Socket | null) => void;
  setConnected: (isConnected: boolean) => void;
  setConnectionError: (error: string | null) => void;
  setClientId: (clientId: string) => void;
}

// Create a Zustand store for Socket.IO state management
export const useSocketStore = create<SocketStore>((set, get) => ({
  isConnected: false,
  connectionError: null,
  socket: null,
  clientId: null,
  pendingRequests: new Map(),

  // Connect to Socket.IO server
  connect: () => {
    // Don't create a new connection if already connected
    if (get().socket && get().isConnected) {
      console.log("[Socket.IO Client] Already connected, reusing connection");
      return;
    }

    try {
      // Disconnect any existing socket first
      const existingSocket = get().socket;
      if (existingSocket) {
        try {
          existingSocket.disconnect();
        } catch (e) {
          console.error(
            "[Socket.IO Client] Error disconnecting existing socket:",
            e
          );
        }
      }

      console.log("[Socket.IO Client] Initializing connection...");

      const socket = io({
        path: "/api/socket",
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 200000, // 增加超时时间到30秒
        // Force a new connection by adding a timestamp
        query: { t: Date.now().toString() },
      });

      // 设置事件处理程序
      socket.on("connect", () => {
        console.log("[Socket.IO Client] Connected with ID:", socket.id);
        set({ isConnected: true, connectionError: null });
      });

      socket.on("disconnect", (reason) => {
        console.log("[Socket.IO Client] Disconnected:", reason);
        set({ isConnected: false });
      });

      socket.on("connect_error", (error) => {
        console.error("[Socket.IO Client] Connection error:", error);
        set({ connectionError: error.message, isConnected: false });
      });

      socket.on("connection_established", (data) => {
        console.log("[Socket.IO Client] Connection established:", data);
        set({ clientId: data.clientId, isConnected: true });
      });

      // 处理截图请求的响应
      socket.on("provide_screenshot", (data) => {
        const { pendingRequests } = get();
        const request = pendingRequests.get(data.requestId);

        if (request) {
          get().resolveRequest(data.requestId, {
            status: "success",
            screenshot: data.screenshot,
          });
        }
      });

      // 处理截图错误响应
      socket.on("provide_screenshot_error", (data) => {
        const { pendingRequests } = get();
        const request = pendingRequests.get(data.requestId);

        if (request) {
          get().resolveRequest(data.requestId, {
            status: "error",
            error: data.error || "Unknown screenshot error",
          });
        }
      });

      // 精简心跳机制，仅响应，不主动发送
      socket.on("ping", (data) => {
        socket.emit("pong", { timestamp: data.timestamp });
      });

      set({ socket });

      // Immediately check connection state
      if (socket.connected) {
        console.log(
          "[Socket.IO Client] Socket already connected on initialization"
        );
        set({ isConnected: true });
      }
    } catch (error) {
      console.error("[Socket.IO Client] Failed to initialize socket:", error);
      set({
        connectionError: error instanceof Error ? error.message : String(error),
        isConnected: false,
      });
    }
  },

  // Disconnect from Socket.IO server
  disconnect: () => {
    const { socket } = get();
    if (socket) {
      try {
        socket.disconnect();
      } catch (e) {
        console.error("[Socket.IO Store] Error disconnecting socket:", e);
      }
    }
    set({ isConnected: false, socket: null });
  },

  // Set Socket.IO instance
  setSocket: (socket: Socket | null) => {
    set({ socket });
  },

  // Add a new screenshot request with promise handlers
  addRequest: (
    requestId: string,
    resolve: (result: {
      status: string;
      screenshot?: string;
      error?: string;
    }) => void
  ) => {
    const { pendingRequests } = get();

    // 增加超时时间到30秒
    const timeout = setTimeout(() => {
      const store = get();
      if (store.pendingRequests.has(requestId)) {
        const request = store.pendingRequests.get(requestId);
        if (request) {
          // 超时不再抛出异常，而是返回结构化的超时结果
          request.resolve({
            status: "timeout",
            error: "Screenshot request timed out after 30 seconds",
          });
          store.pendingRequests.delete(requestId);
        }
      }
    }, 30000);

    pendingRequests.set(requestId, {
      requestId,
      timestamp: Date.now(),
      resolve,
      timeout,
    });

    set({ pendingRequests: new Map(pendingRequests) });
  },

  // Resolve a completed screenshot request
  resolveRequest: (
    requestId: string,
    result: { status: string; screenshot?: string; error?: string }
  ) => {
    const { pendingRequests } = get();
    const request = pendingRequests.get(requestId);

    if (request) {
      clearTimeout(request.timeout);
      request.resolve(result);
      pendingRequests.delete(requestId);
      set({ pendingRequests: new Map(pendingRequests) });
      console.log(
        `[Socket.IO Client] Screenshot request ${requestId} resolved with status: ${result.status}`
      );
    }
  },

  // Update connection state
  setConnected: (isConnected: boolean) => {
    set({ isConnected, connectionError: null });
  },

  // Set connection error
  setConnectionError: (error: string | null) => {
    set({ connectionError: error, isConnected: false });
  },

  // Set client ID
  setClientId: (clientId: string) => {
    set({ clientId });
  },
}));

/**
 * Request a screenshot through the Socket.IO connection
 * This function is called by the agent to request a screenshot
 * @param requestId Unique identifier for the request
 * @returns Promise that resolves with the screenshot data or structured error
 */
export async function requestScreenshot(
  requestId: string = `req_${Date.now()}`
): Promise<string> {
  const store = useSocketStore.getState();

  return new Promise((resolve) => {
    // Check if Socket.IO is connected
    if (!store.socket || !store.isConnected) {
      return resolve(""); // 返回空字符串而非抛出异常，让调用方决定如何处理
    }

    // Check socket state
    if (!store.socket.connected) {
      return resolve(""); // 同上，返回空字符串
    }

    // 创建处理结果的回调
    const handleResult = (result: {
      status: string;
      screenshot?: string;
      error?: string;
    }) => {
      if (result.status === "success" && result.screenshot) {
        resolve(result.screenshot);
      } else {
        // 即使出错也返回空字符串，而不是抛出异常
        console.warn(
          `[Socket.IO Client] Screenshot request ${result.status}: ${
            result.error || "unknown error"
          }`
        );
        resolve("");
      }
    };

    // Store the promise handlers
    store.addRequest(requestId, handleResult);

    try {
      // Send the screenshot request
      store.socket.emit("request_screenshot", {
        requestId,
        timestamp: Date.now(),
        clientId: store.clientId,
      });

      console.log(
        `[Socket.IO Client] Screenshot request sent, ID: ${requestId}`
      );
    } catch (error) {
      // 发送失败时，直接解析空字符串，不中断流程
      console.error(
        "[Socket.IO Client] Error sending screenshot request:",
        error
      );
      store.resolveRequest(requestId, {
        status: "error",
        error: `Failed to send screenshot request: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  });
}

/**
 * 获取当前Socket.IO连接状态
 * 仅用于UI显示，不应影响Agent流程
 */
export function getSocketState() {
  return useSocketStore.getState();
}

// For backward compatibility
export const useWebSocketStore = useSocketStore;
