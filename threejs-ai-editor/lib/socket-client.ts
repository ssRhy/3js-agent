// Socket client for screenshot requests
// This file provides a clean interface for requesting screenshots via WebSocket
import { Server as SocketIOServer, Socket } from "socket.io";

// Add global type declarations for socket server and screenshot requests
declare global {
  // eslint-disable-next-line no-var
  var socketIOServer: SocketIOServer | undefined;
  // eslint-disable-next-line no-var
  var screenshotRequests: Map<
    string,
    {
      resolve: (screenshot: string) => void;
      socketId: string;
    }
  >;
  // eslint-disable-next-line no-var
  var connectedClients: Map<string, Socket>; // Track connected clients
}

/**
 * 获取可用的客户端连接
 * @returns 第一个可用的客户端socket ID，如果没有则返回null
 */
function getAvailableClient(): string | null {
  if (!global.connectedClients || global.connectedClients.size === 0) {
    return null;
  }

  // 获取第一个连接的客户端
  const [firstSocketId] = global.connectedClients.keys();
  return firstSocketId || null;
}

/**
 * Request a screenshot from a specific client via WebSocket
 * @param requestId Unique identifier for this request
 * @param targetSocketId Optional specific socket ID to send to, if not provided, uses first available client
 * @returns Promise that resolves to the screenshot data in base64 format
 */
export async function requestScreenshot(
  requestId: string = `req_${Date.now()}`,
  targetSocketId?: string
): Promise<string> {
  // Access the global socketIOServer instance from the server
  if (typeof window !== "undefined") {
    // We're on the client side - this should never happen in normal usage
    console.error(
      "[Socket Client] Cannot request screenshots from client side"
    );
    return "";
  }

  // Get the global socket server instance (set in socket.ts)
  const globalSocketIO = global.socketIOServer;
  const screenshotRequests = global.screenshotRequests;
  const connectedClients = global.connectedClients;

  if (!globalSocketIO) {
    console.error(
      `[Socket Client] [${requestId}] No Socket.IO server available`
    );
    return "";
  }

  if (!screenshotRequests) {
    console.error(
      `[Socket Client] [${requestId}] Screenshot requests map not initialized`
    );
    return "";
  }

  if (!connectedClients) {
    console.error(
      `[Socket Client] [${requestId}] Connected clients map not initialized`
    );
    return "";
  }

  return new Promise((resolve) => {
    try {
      // 选择目标客户端
      const selectedSocketId = targetSocketId || getAvailableClient();

      if (!selectedSocketId) {
        console.warn(
          `[Socket Client] [${requestId}] No connected clients available`
        );
        resolve("");
        return;
      }

      // 检查目标客户端是否仍然连接
      const targetSocket = connectedClients.get(selectedSocketId);
      if (!targetSocket || !targetSocket.connected) {
        console.warn(
          `[Socket Client] [${requestId}] Target client ${selectedSocketId} is not connected`
        );
        resolve("");
        return;
      }

      // Store the resolver for this request with specific socket ID
      screenshotRequests.set(requestId, {
        resolve,
        socketId: selectedSocketId,
      });

      // Set timeout (30 seconds) - can be cleared if needed on the socket.ts side
      setTimeout(() => {
        if (screenshotRequests.has(requestId)) {
          console.warn(
            `[Socket Client] [${requestId}] Screenshot request timed out (30s)`
          );
          screenshotRequests.delete(requestId);
          resolve("");
        }
      }, 30000);

      // Send request to specific client instead of broadcasting
      targetSocket.emit("request_screenshot", {
        requestId,
        timestamp: Date.now(),
      });

      console.log(
        `[Socket Client] [${requestId}] Screenshot request sent to client ${selectedSocketId}`
      );
    } catch (error) {
      console.error(
        `[Socket Client] [${requestId}] Error requesting screenshot:`,
        error
      );
      resolve("");
    }
  });
}

/**
 * 获取当前连接的客户端数量
 * @returns 连接的客户端数量
 */
export function getConnectedClientsCount(): number {
  if (!global.connectedClients) {
    return 0;
  }
  return global.connectedClients.size;
}

/**
 * 获取所有连接的客户端ID列表
 * @returns 客户端ID数组
 */
export function getConnectedClientIds(): string[] {
  if (!global.connectedClients) {
    return [];
  }
  return Array.from(global.connectedClients.keys());
}
