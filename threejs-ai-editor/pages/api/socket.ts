import type { NextApiRequest } from "next";
import type { Server as HttpServer } from "http";
import type { Socket as NetSocket } from "net";
import type { NextApiResponse } from "next";
import { Server as SocketIOServer } from "socket.io";
import { Socket } from "socket.io";
import { runAgentWithSocketIO } from "../../lib/agents/agentExecutor";

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
}

// Socket连接和截图请求处理 - 修改为只存储resolve函数，不存储分析处理
const screenshotRequests = new Map<string, (screenshot: string) => void>();

/**
 * Socket.IO API端点
 * 处理Agent发来的截图请求和从客户端接收截图数据
 * 只负责数据传输，不进行其他处理
 */
export default function handler(req: NextApiRequest, res: ResponseWithSocket) {
  // 仅初始化Socket.IO一次
  if (!res.socket.server.io) {
    console.log("[Socket.IO] Initializing server");

    // 创建Socket.IO服务器
    const io = new SocketIOServer(res.socket.server, {
      path: "/api/socket",
      addTrailingSlash: false,
      pingTimeout: 60000, // Increase ping timeout to 60 seconds
      pingInterval: 30000, // Every 30 seconds
      cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["X-Requested-With", "Content-Type", "Authorization"],
        credentials: true,
      },
    });

    // 存储服务器实例
    res.socket.server.io = io;

    // 设置全局实例以供 requestScreenshot 使用
    setSocketIOInstance(io);

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

      // 启动Agent与Socket.IO集成，允许Agent自主驱动截图分析
      try {
        runAgentWithSocketIO(socket);
      } catch (error) {
        console.error(
          "[Socket.IO] Error initializing agent with Socket.IO:",
          error
        );
        // Error shouldn't prevent connections from working
      }

      // 处理心跳检测 - 降低频率减少不必要的网络流量
      const pingInterval = setInterval(() => {
        if (socket.connected) {
          socket.emit("ping", {
            timestamp: Date.now(),
          });
        } else {
          // 如果断开连接，清除定时器
          clearInterval(pingInterval);
        }
      }, 60000); // 每60秒ping一次，减少频率

      // 处理来自客户端的截图数据 - 简化为纯数据传输层
      socket.on("provide_screenshot", async (data) => {
        console.log(
          `[Socket.IO] Screenshot data received from socket ${socket.id}, size: ${data.screenshot.length} bytes`
        );

        // 获取resolver函数
        const resolver = screenshotRequests.get(data.requestId);

        // 无论分析是否成功，优先传递截图数据以不阻塞Agent流程
        if (resolver) {
          try {
            // 立即传递截图数据，不阻塞流程
            resolver(data.screenshot);
            console.log(
              `[Socket.IO] Screenshot request ${data.requestId} resolved (from socket ${socket.id})`
            );
          } catch (resolveError) {
            console.error(
              `[Socket.IO] Error resolving screenshot request:`,
              resolveError
            );
          } finally {
            // 清理请求
            screenshotRequests.delete(data.requestId);
          }
        } else {
          console.warn(
            `[Socket.IO] No pending request for ID: ${data.requestId}`
          );
        }

        // 如果提供了用户需求，告知客户端我们收到了分析请求
        // 但实际分析不在这里进行，而是应该在Agent流程中
        if (data.userRequirement) {
          // 仅发送确认收到的消息，不进行实际分析
          socket.emit("screenshot_analysis", {
            requestId: data.requestId,
            status: "received",
            message: "Screenshot received for analysis, processing in agent",
          });
        }
      });

      // 处理断开连接
      socket.on("disconnect", () => {
        console.log(`[Socket.IO] Client disconnected: ${clientId}`);
        clearInterval(pingInterval);
      });
    });

    console.log("[Socket.IO] Server initialization successful");
  }

  // 结束请求
  res.end();
}

/**
 * 通过Socket.IO从客户端请求截图
 * @param requestId 此截图请求的唯一ID
 * @param socket 可选的特定socket实例，用于单播请求而非广播
 * @returns 解析为截图数据的Promise
 */
export async function requestScreenshot(
  requestId: string = `req_${Date.now()}`,
  socket?: Socket
): Promise<string> {
  return new Promise((resolve) => {
    // 获取Socket.IO服务器实例
    const io = global.socketIOServer;

    if (!io) {
      console.error(
        `[Socket.IO] [${requestId}] Server instance not available globally`
      );
      resolve(""); // 返回空字符串而非拒绝Promise
      return;
    }

    console.log(
      `[Socket.IO] [${requestId}] Starting screenshot request - ${new Date().toISOString()}`
    );

    // 如果提供了特定socket，使用单播模式
    if (socket && socket.connected) {
      console.log(
        `[Socket.IO] [${requestId}] Using direct socket connection ${socket.id}`
      );

      // 存储解析函数用于处理回调
      screenshotRequests.set(requestId, resolve);

      // 30秒后超时 - 增加超时时间确保有足够时间获取响应
      const timeout = setTimeout(() => {
        if (screenshotRequests.has(requestId)) {
          console.error(
            `[Socket.IO] [${requestId}] Screenshot request timed out (30 seconds)`
          );
          screenshotRequests.delete(requestId);
          resolve(""); // 返回空字符串而非抛出错误
        }
      }, 30000);

      // 向特定客户端发送截图请求
      try {
        socket.emit("request_screenshot", {
          requestId,
          timestamp: Date.now(),
          fromAgent: true,
        });

        console.log(
          `[Socket.IO] [${requestId}] Screenshot request sent to specific client ${socket.id}`
        );
      } catch (error) {
        clearTimeout(timeout);
        screenshotRequests.delete(requestId);
        console.error(
          `[Socket.IO] [${requestId}] Error sending screenshot request:`,
          error
        );
        resolve(""); // 返回空字符串而非拒绝Promise
      }

      return;
    }

    // 获取已连接的客户端数量
    const clientCount = io.engine.clientsCount;
    console.log(
      `[Socket.IO] [${requestId}] Active connections: ${clientCount}`
    );

    if (clientCount === 0) {
      console.error(
        `[Socket.IO] [${requestId}] No connected clients available`
      );
      resolve(""); // 返回空字符串而非拒绝Promise
      return;
    }

    // 存储解析函数用于处理回调
    screenshotRequests.set(requestId, resolve);

    // 30秒后超时 - 增加超时时间
    const timeout = setTimeout(() => {
      if (screenshotRequests.has(requestId)) {
        console.error(
          `[Socket.IO] [${requestId}] Screenshot request timed out (30 seconds)`
        );
        screenshotRequests.delete(requestId);
        resolve(""); // 返回空字符串而非抛出错误
      }
    }, 30000);

    // 向所有客户端广播截图请求
    try {
      io.emit("request_screenshot", {
        requestId,
        timestamp: Date.now(),
      });

      console.log(
        `[Socket.IO] [${requestId}] Screenshot request broadcasted successfully`
      );
    } catch (error) {
      clearTimeout(timeout);
      screenshotRequests.delete(requestId);
      console.error(
        `[Socket.IO] [${requestId}] Error sending screenshot request:`,
        error
      );
      resolve(""); // 返回空字符串而非拒绝Promise
    }
  });
}

// 在全局对象上保存Socket.IO实例引用，以便在requestScreenshot函数中使用
export function setSocketIOInstance(io: SocketIOServer) {
  global.socketIOServer = io;
}
