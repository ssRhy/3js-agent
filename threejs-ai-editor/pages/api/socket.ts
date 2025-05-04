import type { NextApiRequest } from "next";
import type { Server as HttpServer } from "http";
import type { Socket as NetSocket } from "net";
import type { NextApiResponse } from "next";
import { Server as SocketIOServer } from "socket.io";
import { runAgentWithSocketIO } from "../../lib/agents/agentExecutor";

// 分析结果接口
interface AnalysisResult {
  status: string;
  analysis?: string;
  matches_requirements?: boolean;
  needs_improvements?: boolean;
  key_improvements?: string;
  recommendation?: string;
  message?: string;
}

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

// Socket连接和截图请求处理
const screenshotRequests = new Map<string, (screenshot: string) => void>();

// 可以正常导入分析器
let analyzeScreenshot: (
  screenshot: string,
  userRequirement: string,
  historyContext?: string
) => Promise<AnalysisResult>;

// 本地分析函数（备用）
async function localAnalyzeScreenshot(
  screenshot: string,
  userRequirement: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _historyContext: string = ""
): Promise<AnalysisResult> {
  console.log(
    `[Screenshot Analyzer Fallback] Analyzing screenshot for: ${userRequirement.substring(
      0,
      30
    )}...`
  );

  return {
    status: "success",
    analysis: "Screenshot analysis completed (fallback implementation)",
    matches_requirements: false,
    needs_improvements: true,
    key_improvements:
      "Using fallback analyzer - real analyzer module failed to load",
    recommendation: "Please check screenshot analyzer module",
  };
}

// 内存管理导入函数（备用）
let prepareHistoryContext = async () => "";

// 动态导入分析器和内存管理模块
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const screenshotAnalyzerModule = require("../../lib/tools/screenshotAnalyzer");
  analyzeScreenshot = screenshotAnalyzerModule.analyzeScreenshot;
  console.log("[Socket.IO] Successfully loaded screenshot analyzer module");
} catch (e) {
  console.error("[Socket.IO] Error importing screenshot analyzer:", e);
  analyzeScreenshot = localAnalyzeScreenshot;
}

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const memoryManager = require("../../lib/memory/memoryManager");
  prepareHistoryContext = memoryManager.prepareHistoryContext;
  console.log("[Socket.IO] Successfully loaded memory manager module");
} catch (e) {
  console.error("[Socket.IO] Error importing memory manager:", e);
}

/**
 * Socket.IO API端点
 * 处理Agent发来的截图请求和从客户端接收截图数据
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
      }

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

      // 处理来自客户端的截图数据
      socket.on("provide_screenshot", async (data) => {
        console.log(
          `[Socket.IO] Screenshot data received, size: ${data.screenshot.length} bytes`
        );

        // 如果提供了用户需求则分析截图
        if (data.userRequirement) {
          try {
            const historyContext = await prepareHistoryContext();
            const analysis = await analyzeScreenshot(
              data.screenshot,
              data.userRequirement,
              historyContext
            );

            // 如果请求则发回分析结果
            if (data.returnAnalysis) {
              socket.emit("screenshot_analysis", {
                requestId: data.requestId,
                analysis,
              });
            }
          } catch (error) {
            console.error(`[Socket.IO] Analysis error:`, error);
          }
        }

        // 查找并解决挂起的请求
        const resolver = screenshotRequests.get(data.requestId);
        if (resolver) {
          resolver(data.screenshot);
          screenshotRequests.delete(data.requestId);
          console.log(
            `[Socket.IO] Screenshot request ${data.requestId} resolved`
          );
        } else {
          console.warn(
            `[Socket.IO] No pending request for ID: ${data.requestId}`
          );
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

/**
 * 通过Socket.IO从客户端请求截图
 * @param requestId 此截图请求的唯一ID
 * @returns 解析为截图数据的Promise
 */
export async function requestScreenshot(
  requestId: string = `req_${Date.now()}`
): Promise<string> {
  return new Promise((resolve, reject) => {
    // 获取Socket.IO服务器实例
    const io = global.socketIOServer;

    if (!io) {
      console.error(
        `[Socket.IO] [${requestId}] Server instance not available globally`
      );
      reject(new Error("Socket.IO server not initialized"));
      return;
    }

    console.log(
      `[Socket.IO] [${requestId}] Starting screenshot request - ${new Date().toISOString()}`
    );

    // 获取已连接的客户端数量
    const clientCount = io.engine.clientsCount;
    console.log(
      `[Socket.IO] [${requestId}] Active connections: ${clientCount}`
    );

    if (clientCount === 0) {
      console.error(
        `[Socket.IO] [${requestId}] No connected clients available`
      );
      reject(new Error("No connected clients available"));
      return;
    }

    // 存储解析函数用于处理回调
    screenshotRequests.set(requestId, resolve);

    // 15秒后超时
    const timeout = setTimeout(() => {
      if (screenshotRequests.has(requestId)) {
        console.error(
          `[Socket.IO] [${requestId}] Screenshot request timed out (15 seconds)`
        );
        screenshotRequests.delete(requestId);
        reject(new Error("Screenshot request timed out"));
      }
    }, 15000);

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
      reject(error);
    }
  });
}

// 在全局对象上保存Socket.IO实例引用，以便在requestScreenshot函数中使用
export function setSocketIOInstance(io: SocketIOServer) {
  global.socketIOServer = io;
}
