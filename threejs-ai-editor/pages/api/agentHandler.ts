// pages/api/agentHandler.ts
import { NextApiRequest, NextApiResponse } from "next";
import {
  runAgentLoop,
  runCompleteOptimizationFlow,
  clearSessionState,
} from "../../lib/agents/agentExecutor";
import { ToolRegistry } from "../../lib/tools/toolRegistry";
import {
  loadLatestCodeState,
  saveSceneStateToMemory,
  loadSceneHistoryFromMemory,
  loadModelHistoryFromMemory,
  prepareHistoryContext,
} from "../../lib/memory/memoryManager";
import { analyzeScreenshotDirectly } from "../../pages/api/screenshotAnalyzer";
import { LintError } from "../../lib/types/codeTypes";
import { SceneStateObject } from "../../lib/types/sceneTypes";

// 默认最大迭代次数
const MAX_ITERATIONS = 10;

/**
 * Agent API 的主要处理函数
 * 负责协调各种 AI 操作，包括截图分析、代码优化等
 *
 * @param req NextApiRequest 对象
 * @param res NextApiResponse 对象
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // 仅支持 POST 方法
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 解析请求参数
  const {
    action,
    code,
    prompt,
    screenshot,
    lintErrors,
    modelRequired,
    sessionId,
  } = req.body;

  // 将 sceneState 转换为正确的类型
  const sceneState = req.body.sceneState as SceneStateObject[] | undefined;

  // 获取场景历史（如果提供）
  const sceneHistory = req.body.sceneHistory;

  // 使用客户端提供的会话ID或生成一个新的请求ID
  const requestId = sessionId || `req_${Date.now()}_${action || "unknown"}`;

  // 记录 API 调用详情
  console.log(
    `[${requestId}] Agent API called with action: ${action}, prompt: ${
      typeof prompt === "string" ? prompt.substring(0, 50) + "..." : "N/A"
    }, sceneState: ${sceneState ? `${sceneState.length} objects` : "none"}, ` +
      `sceneHistory: ${sceneHistory ? "provided" : "none"}`
  );

  try {
    // 根据 action 类型处理不同的请求
    switch (action) {
      case "analyze-screenshot":
        return await handleScreenshotAnalysis(
          req,
          res,
          requestId,
          screenshot,
          code,
          prompt,
          lintErrors,
          modelRequired,
          sceneState,
          sceneHistory
        );

      case "optimize-code":
        return await handleCodeOptimization(
          req,
          res,
          requestId,
          code,
          prompt,
          lintErrors,
          modelRequired,
          sceneState,
          sceneHistory
        );

      case "generate-model":
        return await handleModelGeneration(req, res, requestId, code, prompt);

      case "reset-session":
        // Clear the session state if requested
        if (sessionId) {
          clearSessionState(sessionId);
          return res
            .status(200)
            .json({ success: true, message: "Session reset successful" });
        }
        return res
          .status(400)
          .json({ error: "No session ID provided for reset" });

      default:
        console.log(`[${requestId}] Invalid action: ${action}`);
        return res.status(400).json({ error: "Invalid action: " + action });
    }
  } catch (error) {
    // 错误处理 - 记录详细信息并返回友好的错误响应
    console.error(`[${requestId}] Error in agent handler:`, error);

    // 在开发环境中也返回堆栈跟踪
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
      stack:
        process.env.NODE_ENV === "development"
          ? error instanceof Error
            ? error.stack
            : null
          : null,
    });
  }
}

/**
 * 处理截图分析请求
 * 分析截图，然后运行 agent 循环生成优化代码
 */
async function handleScreenshotAnalysis(
  req: NextApiRequest,
  res: NextApiResponse,
  requestId: string,
  screenshot: string,
  code: string,
  prompt?: string,
  lintErrors?: LintError[],
  modelRequired?: boolean,
  sceneState?: SceneStateObject[],
  sceneHistory?: string
) {
  console.log(`[${requestId}] Processing screenshot analysis request`);

  // 验证必需参数
  if (!screenshot || !code) {
    console.log(`[${requestId}] Missing required parameters`);
    return res.status(400).json({
      error: "Missing required parameters: screenshot and code",
    });
  }

  try {
    // 使用完整优化流程，整合截图分析和代码生成
    console.log(`[${requestId}] Running complete optimization flow`);

    // 获取所有可用工具
    const toolRegistry = ToolRegistry.getInstance();
    const tools = toolRegistry.getAllTools();

    // 检查工具是否存在
    if (!tools || tools.length === 0) {
      console.error(
        `[${requestId}] No tools found in registry! This will cause agent creation to fail.`
      );
    } else {
      console.log(
        `[${requestId}] Found ${tools.length} tools: ${tools
          .map((t) => t.name)
          .join(", ")}`
      );
    }

    // 使用整合的优化流程，传递会话ID
    return await runCompleteOptimizationFlow(
      screenshot,
      code,
      tools,
      prompt,
      lintErrors,
      {
        modelRequired,
        sceneState,
        sceneHistory,
        sessionId: requestId, // 使用会话ID
      },
      res
    );
  } catch (error) {
    console.error(
      `[${requestId}] Complete optimization flow failed, attempting fallback:`,
      error
    );

    // 如果整合流程失败，尝试分步执行
    try {
      // 1. 先执行截图分析
      const suggestion = await analyzeScreenshotDirectly(
        screenshot,
        code,
        prompt
      );

      // 2. 加载上下文数据
      const currentCodeState = await loadLatestCodeState(code);
      const historyContext = await prepareHistoryContext();
      const loadedSceneHistory = await loadSceneHistoryFromMemory();
      const modelHistory = await loadModelHistoryFromMemory();

      // 3. 保存当前场景状态
      if (sceneState && sceneState.length > 0) {
        await saveSceneStateToMemory(prompt || "", sceneState);
      }

      // 4. 获取工具
      const toolRegistry = ToolRegistry.getInstance();
      const tools = toolRegistry.getAllTools();

      // 检查工具是否存在（fallback 路径）
      if (!tools || tools.length === 0) {
        console.error(
          `[${requestId}] [FALLBACK] No tools found in registry! This will cause agent creation to fail.`
        );
        return res.status(500).json({
          error: "Agent initialization failed: No tools available",
        });
      } else {
        console.log(
          `[${requestId}] [FALLBACK] Found ${tools.length} tools: ${tools
            .map((t) => t.name)
            .join(", ")}`
        );
      }

      // 5. 运行 agent 循环，使用会话ID
      console.log(`[${requestId}] Running agent loop with fallback approach`);
      return await runAgentLoop(
        suggestion,
        currentCodeState,
        tools,
        MAX_ITERATIONS,
        prompt,
        historyContext,
        lintErrors,
        modelRequired,
        sceneState,
        modelHistory,
        sceneHistory || loadedSceneHistory,
        res,
        requestId // 传递会话ID
      );
    } catch (fallbackError) {
      console.error(
        `[${requestId}] Fallback approach also failed:`,
        fallbackError
      );
      return res.status(500).json({
        error: "Screenshot analysis failed even with fallback approach",
        details:
          fallbackError instanceof Error
            ? fallbackError.message
            : "Unknown error",
      });
    }
  }
}

/**
 * 处理代码优化请求
 * 直接运行 agent 循环优化代码，不需要截图分析
 */
async function handleCodeOptimization(
  req: NextApiRequest,
  res: NextApiResponse,
  requestId: string,
  code: string,
  prompt?: string,
  lintErrors?: LintError[],
  modelRequired?: boolean,
  sceneState?: SceneStateObject[],
  sceneHistory?: string
) {
  console.log(`[${requestId}] Processing code optimization request`);

  // 验证必需参数
  if (!code) {
    console.log(`[${requestId}] Missing required parameter: code`);
    return res.status(400).json({
      error: "Missing required parameter: code",
    });
  }

  try {
    // 加载必要的上下文
    const currentCodeState = await loadLatestCodeState(code);
    const historyContext = await prepareHistoryContext();

    // 加载历史数据
    const modelHistory = await loadModelHistoryFromMemory();
    const loadedSceneHistory = await loadSceneHistoryFromMemory();

    // 保存当前场景状态（如果有）
    if (sceneState && sceneState.length > 0) {
      await saveSceneStateToMemory(prompt || "", sceneState);
    }

    // 获取可用工具
    const toolRegistry = ToolRegistry.getInstance();
    const tools = toolRegistry.getAllTools();

    // 检查工具是否存在
    if (!tools || tools.length === 0) {
      console.error(
        `[${requestId}] No tools found in registry! This will cause agent creation to fail.`
      );
      return res.status(500).json({
        error: "Agent initialization failed: No tools available",
      });
    } else {
      console.log(
        `[${requestId}] Found ${
          tools.length
        } tools in code optimization: ${tools.map((t) => t.name).join(", ")}`
      );
    }

    // 使用 agent 优化代码
    console.log(`[${requestId}] Running agent loop for code optimization`);
    return await runAgentLoop(
      "", // 无需截图分析，直接开始优化
      currentCodeState,
      tools,
      MAX_ITERATIONS,
      prompt,
      historyContext,
      lintErrors,
      modelRequired,
      sceneState,
      modelHistory,
      sceneHistory || loadedSceneHistory,
      res
    );
  } catch (error) {
    console.error(`[${requestId}] Code optimization failed:`, error);
    return res.status(500).json({
      error: "Code optimization failed",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * 处理模型生成请求
 * 专注于生成 3D 模型
 */
async function handleModelGeneration(
  req: NextApiRequest,
  res: NextApiResponse,
  requestId: string,
  code: string,
  prompt?: string
) {
  console.log(`[${requestId}] Processing model generation request`);

  // 验证必需参数
  if (!prompt) {
    console.log(`[${requestId}] Missing required parameter: prompt`);
    return res.status(400).json({
      error: "Missing required parameter: prompt for model generation",
    });
  }

  try {
    // 加载必要的上下文
    const currentCodeState = await loadLatestCodeState(code);
    const historyContext = await prepareHistoryContext();
    const sceneHistory = await loadSceneHistoryFromMemory();
    const modelHistory = await loadModelHistoryFromMemory();

    // 获取工具（仅模型生成相关工具）
    const toolRegistry = ToolRegistry.getInstance();
    const tools = toolRegistry.getAllTools();

    // 检查工具是否存在
    if (!tools || tools.length === 0) {
      console.error(
        `[${requestId}] No tools found in registry! This will cause agent creation to fail.`
      );
      return res.status(500).json({
        error: "Agent initialization failed: No tools available",
      });
    } else {
      console.log(
        `[${requestId}] Found ${
          tools.length
        } tools for model generation: ${tools.map((t) => t.name).join(", ")}`
      );
    }

    // 创建专门针对模型生成的建议
    const suggestion = `根据用户需求"${prompt}"生成适合的3D模型。`;

    // 运行 agent 循环，设置 modelRequired 为 true
    console.log(`[${requestId}] Running agent loop for model generation`);
    return await runAgentLoop(
      suggestion,
      currentCodeState,
      tools,
      MAX_ITERATIONS,
      prompt,
      historyContext,
      undefined, // 无需 lint 错误
      true, // 明确这是模型生成
      undefined, // 无需场景状态
      modelHistory,
      sceneHistory,
      res
    );
  } catch (error) {
    console.error(`[${requestId}] Model generation failed:`, error);
    return res.status(500).json({
      error: "Model generation failed",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
