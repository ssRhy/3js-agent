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
  isInSilentMode: boolean; // Flag for silent mode

  // Socket.IO instance (singleton)
  socket: Socket | null;

  // Client ID assigned by server
  clientId: string | null;

  // Pending requests
  pendingRequests: Map<string, ScreenshotRequest>;

  // Connection management
  connect: () => void;
  disconnect: () => void;

  // Silent mode control
  enterSilentMode: () => void;
  exitSilentMode: () => void;

  // Request tracking
  addRequest: (
    requestId: string,
    resolve: (result: {
      status: string;
      screenshot?: string;
      error?: string;
    }) => void
  ) => void;
  resolveRequest: (requestId: string, screenshot: string) => void;
  rejectRequest: (requestId: string, error: string) => void;

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
  isInSilentMode: false, // Start in normal mode
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
        timeout: 30000, // Increased timeout to 30s
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

        // Enter silent mode after connection established
        get().enterSilentMode();
      });

      // 处理截图请求的响应
      socket.on("provide_screenshot", (data) => {
        const { pendingRequests } = get();
        const request = pendingRequests.get(data.requestId);

        if (request) {
          // Use structured response with status
          get().resolveRequest(data.requestId, data.screenshot);
        }
      });

      // 处理截图分析结果 - simplified to just log in silent mode
      socket.on("screenshot_analysis", (data) => {
        // In silent mode, just log without additional processing
        if (get().isInSilentMode) {
          console.log(
            "[Socket.IO Client] Received analysis for request:",
            data.requestId
          );
        }
      });

      // 心跳包处理 - simplified
      socket.on("ping", (data) => {
        // In silent mode, respond without logging
        if (!get().isInSilentMode) {
          console.log("[Socket.IO Client] Ping received, responding with pong");
        }
        socket.emit("pong", { timestamp: data.timestamp });
      });

      set({ socket });

      // Immediately check connection state
      if (socket.connected) {
        console.log(
          "[Socket.IO Client] Socket already connected on initialization"
        );
        set({ isConnected: true });

        // Enter silent mode after connection established
        get().enterSilentMode();
      }
    } catch (error) {
      console.error("[Socket.IO Client] Failed to initialize socket:", error);
      set({
        connectionError: error instanceof Error ? error.message : String(error),
        isConnected: false,
      });
    }
  },

  // Enter silent mode - minimize logging and only respond to specific events
  enterSilentMode: () => {
    console.log("[Socket.IO Client] Entering silent mode");
    set({ isInSilentMode: true });
  },

  // Exit silent mode - restore normal operation
  exitSilentMode: () => {
    console.log("[Socket.IO Client] Exiting silent mode");
    set({ isInSilentMode: false });
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

  // Add a new screenshot request with promise handlers - using structured responses
  addRequest: (
    requestId: string,
    resolve: (result: {
      status: string;
      screenshot?: string;
      error?: string;
    }) => void
  ) => {
    const { pendingRequests } = get();

    // Create timeout for the request - increased to 30 seconds
    const timeout = setTimeout(() => {
      const store = get();
      if (store.pendingRequests.has(requestId)) {
        // Instead of rejecting, resolve with error status
        store.rejectRequest(
          requestId,
          "Screenshot request timed out after 30 seconds"
        );
      }
    }, 30000); // Increased to 30 seconds

    pendingRequests.set(requestId, {
      requestId,
      timestamp: Date.now(),
      resolve,
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
      // Use structured response
      request.resolve({
        status: "success",
        screenshot,
      });
      pendingRequests.delete(requestId);
      set({ pendingRequests: new Map(pendingRequests) });

      // Only log in non-silent mode
      if (!get().isInSilentMode) {
        console.log(
          `[Socket.IO Client] Screenshot request ${requestId} resolved`
        );
      }
    }
  },

  // Reject a screenshot request with error - using structured response
  rejectRequest: (requestId: string, error: string) => {
    const { pendingRequests } = get();
    const request = pendingRequests.get(requestId);

    if (request) {
      clearTimeout(request.timeout);
      // Use structured response with error status
      request.resolve({
        status: "error",
        error,
      });
      pendingRequests.delete(requestId);
      set({ pendingRequests: new Map(pendingRequests) });

      // Always log errors regardless of mode
      console.error(
        `[Socket.IO Client] Screenshot request ${requestId} failed: ${error}`
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
 * @returns Promise that resolves with the screenshot data
 */
export async function requestScreenshot(
  requestId: string = `req_${Date.now()}`
): Promise<string> {
  const store = useSocketStore.getState();

  return new Promise((resolve) => {
    // Check if Socket.IO is connected
    if (!store.socket || !store.isConnected) {
      console.warn(
        "[Socket.IO Client] Socket not connected for screenshot request"
      );
      // Return empty string instead of rejecting to avoid interrupting agent
      resolve("");
      return;
    }

    // Check socket state
    if (!store.socket.connected) {
      console.warn(
        "[Socket.IO Client] Socket not in connected state for screenshot request"
      );
      // Return empty string instead of rejecting to avoid interrupting agent
      resolve("");
      return;
    }

    // Temporarily exit silent mode for this request
    store.exitSilentMode();

    // Store the promise handlers with structured response
    store.addRequest(requestId, (result) => {
      // Re-enter silent mode after request completes
      store.enterSilentMode();

      if (result.status === "success" && result.screenshot) {
        resolve(result.screenshot);
      } else {
        // Return empty string on error instead of rejecting
        console.warn(
          `[Socket.IO Client] Error in screenshot request: ${result.error}`
        );
        resolve("");
      }
    });

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
      console.error(
        "[Socket.IO Client] Error sending screenshot request:",
        error
      );
      store.rejectRequest(
        requestId,
        `Failed to send screenshot request: ${
          error instanceof Error ? error.message : String(error)
        }`
      );

      // Return empty string instead of rejecting
      resolve("");
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
): Promise<boolean> {
  const store = useSocketStore.getState();

  return new Promise((resolve) => {
    if (!store.socket || !store.isConnected) {
      console.warn(
        "[Socket.IO Client] Socket not connected for message:",
        event
      );
      resolve(false);
      return;
    }

    if (!store.socket.connected) {
      console.warn(
        "[Socket.IO Client] Socket not in connected state for message:",
        event
      );
      resolve(false);
      return;
    }

    try {
      store.socket.emit(event, data);
      resolve(true);
    } catch (error) {
      console.error("[Socket.IO Client] Error sending message:", error);
      resolve(false);
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
