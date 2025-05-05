import type { NextApiRequest } from "next";
import type { Server as HttpServer } from "http";
import type { Socket as NetSocket } from "net";
import type { NextApiResponse } from "next";
import { Server as SocketIOServer } from "socket.io";

// 服务器附加Socket.IO的接口
interface ServerWithIO extends HttpServer {
  io?: SocketIOServer;
}

// 带服务器的Socket接口
interface SocketWithServer extends NetSocket {
  server: ServerWithIO;
}

// 带Socket的响应接口
interface ResponseWithSocket extends NextApiResponse {
  socket: SocketWithServer;
}

// 为全局对象声明扩展类型，用于存储Socket.IO实例
declare global {
  // 全局声明必须使用 var，这是 TypeScript 的要求
  // eslint-disable-next-line no-var
  var socketIOServer: SocketIOServer | undefined;
  // eslint-disable-next-line no-var
  var screenshotRequests: Map<
    string,
    {
      resolve: (screenshot: string) => void;
      socketId: string; // Track which socket should handle this request
    }
  >;
}

// 初始化全局截图请求映射（如果尚未初始化）
if (!global.screenshotRequests) {
  global.screenshotRequests = new Map();
}

/**
 * Socket.IO API端点
 * 处理WebSocket连接和截图数据传输
 */
export default function handler(req: NextApiRequest, res: ResponseWithSocket) {
  // 仅初始化Socket.IO一次
  if (!res.socket.server.io) {
    console.log("[Socket.IO] Initializing server");

    // 创建Socket.IO服务器
    const io = new SocketIOServer(res.socket.server, {
      path: "/api/socket",
      addTrailingSlash: false,
      cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["X-Requested-With", "Content-Type", "Authorization"],
        credentials: true,
      },
    });

    // 存储服务器实例
    res.socket.server.io = io;

    // 设置全局实例
    global.socketIOServer = io;

    // 处理新连接
    io.on("connection", (socket) => {
      const clientId = `client_${Date.now()}`;
      console.log(`[Socket.IO] Client connected: ${clientId} (${socket.id})`);

      // 立即发送连接确认消息
      socket.emit("connection_established", {
        clientId,
        timestamp: Date.now(),
        status: "connected",
      });

      // 发送一个初始 ping 来确认连接是活跃的
      socket.emit("ping", {
        timestamp: Date.now(),
        initial: true,
      });

      // 处理心跳检测
      const pingInterval = setInterval(() => {
        if (socket.connected) {
          socket.emit("ping", {
            timestamp: Date.now(),
          });
        } else {
          // 如果断开连接，清除定时器
          clearInterval(pingInterval);
        }
      }, 30000); // 每30秒ping一次

      // 处理来自客户端的截图数据 - 纯数据传输层
      socket.on("provide_screenshot", (data) => {
        console.log(
          `[Socket.IO] Screenshot data received from socket ${socket.id}, size: ${data.screenshot.length} bytes`
        );

        // 获取resolver函数
        const requestInfo = global.screenshotRequests.get(data.requestId);

        if (requestInfo) {
          try {
            // 立即传递截图数据
            requestInfo.resolve(data.screenshot);
            console.log(
              `[Socket.IO] Screenshot request ${data.requestId} resolved (from socket ${socket.id})`
            );
          } catch (resolveError) {
            console.error(
              `[Socket.IO] Error resolving screenshot request:`,
              resolveError
            );
          } finally {
            // 确保无论如何都清理请求映射
            global.screenshotRequests.delete(data.requestId);
          }
        } else {
          console.warn(
            `[Socket.IO] No pending request for ID: ${data.requestId}`
          );
        }
      });

      // 处理截图错误
      socket.on("provide_screenshot_error", (data) => {
        const requestInfo = global.screenshotRequests.get(data.requestId);
        if (requestInfo) {
          console.warn(
            `[Socket.IO] Screenshot error for request ${data.requestId}: ${data.error}`
          );

          // 传递空字符串
          requestInfo.resolve("");

          // 清理请求
          global.screenshotRequests.delete(data.requestId);
        }
      });

      // 处理断开连接
      socket.on("disconnect", () => {
        console.log(`[Socket.IO] Client disconnected: ${clientId}`);
        clearInterval(pingInterval);
      });

      // 处理错误
      socket.on("error", (error) => {
        console.error(`[Socket.IO] Connection error for ${clientId}:`, error);
      });
    });

    console.log("[Socket.IO] Server initialization successful");
  }

  // 结束请求
  res.end();
}
