// Socket.IO client utilities for agent-driven screenshot requests
import { create } from "zustand";
import { Socket, io } from "socket.io-client";

// Interface for screenshot request data
export interface ScreenshotRequest {
  requestId: string;
  timestamp: number;
  resolve: (screenshot: string) => void;
  reject: (error: Error) => void;
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
    resolve: (screenshot: string) => void,
    reject: (error: Error) => void
  ) => void;
  resolveRequest: (requestId: string, screenshot: string) => void;
  rejectRequest: (requestId: string, error: Error) => void;

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
        timeout: 20000,
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
          get().resolveRequest(data.requestId, data.screenshot);
        }
      });

      // 处理截图分析结果
      socket.on("screenshot_analysis", (data) => {
        console.log(
          "[Socket.IO Client] Received analysis for request:",
          data.requestId
        );
      });

      // 心跳包处理
      socket.on("ping", (data) => {
        console.log("[Socket.IO Client] Ping received, responding with pong");
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
    resolve: (screenshot: string) => void,
    reject: (error: Error) => void
  ) => {
    const { pendingRequests } = get();

    // Create timeout for the request
    const timeout = setTimeout(() => {
      const store = get();
      if (store.pendingRequests.has(requestId)) {
        const request = store.pendingRequests.get(requestId);
        if (request) {
          request.reject(
            new Error("Screenshot request timed out after 15 seconds")
          );
          store.pendingRequests.delete(requestId);
        }
      }
    }, 15000);

    pendingRequests.set(requestId, {
      requestId,
      timestamp: Date.now(),
      resolve,
      reject,
      timeout,
    });

    set({ pendingRequests: new Map(pendingRequests) });
  },

  // Resolve a completed screenshot request
  resolveRequest: (requestId: string, screenshot: string) => {
    const { pendingRequests } = get();
    const request = pendingRequests.get(requestId);

    if (request) {
      clearTimeout(request.timeout);
      request.resolve(screenshot);
      pendingRequests.delete(requestId);
      set({ pendingRequests: new Map(pendingRequests) });
      console.log(
        `[Socket.IO Client] Screenshot request ${requestId} resolved`
      );
    }
  },

  // Reject a screenshot request with error
  rejectRequest: (requestId: string, error: Error) => {
    const { pendingRequests } = get();
    const request = pendingRequests.get(requestId);

    if (request) {
      clearTimeout(request.timeout);
      request.reject(error);
      pendingRequests.delete(requestId);
      set({ pendingRequests: new Map(pendingRequests) });
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
 * @returns Promise that resolves with the screenshot data
 */
export async function requestScreenshot(
  requestId: string = `req_${Date.now()}`
): Promise<string> {
  const store = useSocketStore.getState();

  return new Promise((resolve, reject) => {
    // Check if Socket.IO is connected
    if (!store.socket || !store.isConnected) {
      return reject(new Error("Socket.IO is not connected"));
    }

    // Check socket state
    if (!store.socket.connected) {
      return reject(
        new Error(
          `Socket.IO is not connected (state: ${
            store.socket.connected ? "connected" : "disconnected"
          })`
        )
      );
    }

    // Store the promise handlers
    store.addRequest(requestId, resolve, reject);

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
      // Clean up the request if sending fails
      store.rejectRequest(
        requestId,
        new Error(
          `Failed to send screenshot request: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      );
    }
  });
}

/**
 * Send a message through the Socket.IO connection
 * @param event The event name
 * @param data The data to send
 * @returns Promise that resolves when message is sent
 */
export function sendSocketMessage(
  event: string,
  data: Record<string, unknown>
): Promise<void> {
  const store = useSocketStore.getState();

  return new Promise((resolve, reject) => {
    if (!store.socket || !store.isConnected) {
      return reject(new Error("Socket.IO is not connected"));
    }

    if (!store.socket.connected) {
      return reject(
        new Error(
          `Socket.IO is not connected (state: ${
            store.socket.connected ? "connected" : "disconnected"
          })`
        )
      );
    }

    try {
      store.socket.emit(event, data);
      resolve();
    } catch (error) {
      reject(
        new Error(
          `Failed to send message: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      );
    }
  });
}

/**
 * Get the current Socket.IO connection state
 */
export function getSocketState() {
  return useSocketStore.getState();
}

// For backward compatibility
export const useWebSocketStore = useSocketStore;
