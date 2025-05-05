// Socket client for screenshot requests
// This file provides a clean interface for requesting screenshots via WebSocket
import { Server as SocketIOServer } from "socket.io";

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
}

/**
 * Request a screenshot from the client via WebSocket
 * @param requestId Unique identifier for this request
 * @returns Promise that resolves to the screenshot data in base64 format
 */
export async function requestScreenshot(
  requestId: string = `req_${Date.now()}`
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

  return new Promise((resolve) => {
    try {
      // Check if we have any connected clients
      const clientCount = globalSocketIO.engine.clientsCount;
      if (clientCount === 0) {
        console.warn(
          `[Socket Client] [${requestId}] No connected clients available`
        );
        resolve("");
        return;
      }

      // Store the resolver for this request
      screenshotRequests.set(requestId, {
        resolve,
        socketId: "", // Empty string means any client can handle it
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

      // Broadcast the request to all clients
      globalSocketIO.emit("request_screenshot", {
        requestId,
        timestamp: Date.now(),
      });

      console.log(
        `[Socket Client] [${requestId}] Screenshot request broadcasted to all clients`
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
