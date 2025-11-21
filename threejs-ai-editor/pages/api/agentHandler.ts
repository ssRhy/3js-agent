// pages/api/agentHandler.ts
import { NextApiRequest, NextApiResponse } from "next";
import {
  runAgentLoop,
  clearSessionState,
  runInteractionFlow,
} from "../../lib/agents/agentExecutor";
import { ToolRegistry } from "../../lib/tools/toolRegistry";
import {
  saveSceneStateToMemory,
  loadSceneHistoryFromMemory,
  loadModelHistoryFromMemory,
  prepareHistoryContext,
} from "../../lib/memory/memoryManager";
import { LintError } from "../../lib/types/codeTypes";
import { SceneStateObject } from "../../lib/types/sceneTypes";
import { AgentRequest } from "./agent";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "50mb",
    },
  },
};
/**
 * Agent API 的主要处理函数
 * 负责协调各种 AI 操作，包括截图分析、代码优化等
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // 生成请求ID，仅用于日志
  const requestId = `req_${Date.now()}_${req.body.action || "default"}`;
  console.log(
    `[${requestId}] Agent API called with action: ${
      req.body.action || "unknown"
    }`
  );

  // 仅支持 POST 方法
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 解析请求参数
  const body = req.body as AgentRequest;
  const {
    action,
    code = "",
    prompt = "",
    screenshot,
    screenshotAnalysis,
    lintErrors,
    modelSize,
    renderingComplete,
    enableModelGeneration = false,
    socketId,
  } = body;

  // 将 sceneState 转换为正确的类型
  const sceneState = body.sceneState;

  // 获取场景历史（如果提供）
  const sceneHistory = body.sceneHistory;

  try {
    // 根据 action 类型处理不同的请求
    switch (action) {
      case "analyze-screenshot":
        return await handleScreenshotAnalysis(
          req,
          res,
          requestId,
          screenshot,
          screenshotAnalysis,
          code,
          prompt,
          lintErrors,
          modelSize,
          sceneState,
          sceneHistory,
          renderingComplete,
          enableModelGeneration,
          socketId
        );

      case "optimize-code":
        return await handleCodeOptimization(
          req,
          res,
          requestId,
          code,
          prompt,
          lintErrors,
          modelSize,
          sceneState,
          sceneHistory
        );

      case "generate-model":
        return await handleModelGeneration(req, res, requestId, code, prompt);

      case "fix-bug":
        return await handleBugFix(
          req,
          res,
          requestId,
          code,
          prompt,
          body.errorDescription,
          body.errorDetails,
          lintErrors,
          sceneState
        );

      case "generate-scene-from-image":
        return await handleImageSceneGeneration(
          req,
          res,
          requestId,
          body.imageData,
          prompt,
          sceneState
        );

      case "reset-session":
        // 清除会话状态
        clearSessionState();
        return res
          .status(200)
          .json({ success: true, message: "Session reset successful" });

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
  screenshot: string | undefined,
  screenshotAnalysis: AgentRequest["screenshotAnalysis"] | undefined,
  code: string,
  prompt: string,
  lintErrors?: LintError[],
  modelSize?: number,
  sceneState?: SceneStateObject[],
  sceneHistory?: Record<string, unknown>,
  renderingComplete?: boolean,
  enableModelGeneration?: boolean,
  socketId?: string
) {
  console.log(`[${requestId}] Processing screenshot analysis request`);

  // 验证必需参数
  if ((!screenshot && !screenshotAnalysis) || !code) {
    console.log(`[${requestId}] Missing required parameters`);
    return res.status(400).json({
      error:
        "Missing required parameters: need either screenshot or screenshotAnalysis, and code",
    });
  }

  try {
    let enhancedPrompt = prompt;
    let generatedModelUrl = null;

    // 🔥 硬编码强制执行模型生成
    if (enableModelGeneration && prompt) {
      console.log(
        `[${requestId}] 🔥 FORCING model generation (hardcoded execution)`
      );

      // 强制调用模型生成工具
      const { modelGenTool } = await import("../../lib/tools/modelGenTool");

      try {
        console.log(
          `[${requestId}] 强制调用 modelGenTool，提示词: "${prompt}"`
        );

        const modelGenResult = await modelGenTool.invoke({
          input: JSON.stringify({
            prompt: prompt,
            meshMode: "Quad",
            quality: "medium",
            material: "pbr",
            useHyper: false,
          }),
        });

        const parsedResult = JSON.parse(modelGenResult);

        if (parsedResult.success && parsedResult.modelUrl) {
          generatedModelUrl = parsedResult.modelUrl;
          console.log(`[${requestId}] ✅ 模型生成成功，URL已获取`);

          // 将模型URL添加到提示中，强制agent使用
          enhancedPrompt = `${prompt}\n\n🔥 MANDATORY: Use this generated 3D model URL in your scene: ${generatedModelUrl}\nThis model was specifically generated for the user's request and MUST be included in the Three.js code.`;
        } else {
          console.error(
            `[${requestId}] ❌ 模型生成失败:`,
            parsedResult.error || "Unknown error"
          );
          return res.status(500).json({
            error: "强制模型生成失败",
            details: parsedResult.error || "Model generation returned no URL",
          });
        }
      } catch (modelError) {
        console.error(`[${requestId}] ❌ 调用模型生成工具时出错:`, modelError);
        return res.status(500).json({
          error: "强制模型生成调用失败",
          details:
            modelError instanceof Error
              ? modelError.message
              : String(modelError),
        });
      }
    }

    // 使用改进的交互流程，支持自驱动截图分析和代码修复
    console.log(
      `[${requestId}] Running enhanced interaction flow with ${
        screenshotAnalysis ? "pre-analyzed screenshot" : "raw screenshot"
      }${generatedModelUrl ? " and generated model URL" : ""}`
    );

    const result = await runInteractionFlow(
      code,
      enhancedPrompt, // 使用增强的提示（包含模型URL）
      screenshot,
      screenshotAnalysis,
      sceneState,
      sceneHistory,
      lintErrors,
      modelSize,
      Boolean(renderingComplete),
      requestId,
      Boolean(enableModelGeneration),
      socketId
    );

    // 如果有生成的模型URL，添加到返回结果中
    if (generatedModelUrl) {
      // 确保 result.modelUrls 是数组类型，如果不是则使用空数组
      const existingModelUrls = Array.isArray(result.modelUrls)
        ? result.modelUrls
        : [];

      return res.status(200).json({
        ...result,
        generatedModelUrl: generatedModelUrl,
        modelUrls: [generatedModelUrl, ...existingModelUrls],
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error(`[${requestId}] Interaction flow failed:`, error);
    return res.status(500).json({
      error: "处理失败",
      details: error instanceof Error ? error.message : String(error),
    });
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
  prompt: string,
  lintErrors?: LintError[],
  modelSize?: number,
  sceneState?: SceneStateObject[],
  sceneHistory?: Record<string, unknown>
) {
  console.log(`[${requestId}] Processing code optimization request`);

  try {
    // 加载必要的上下文
    const historyContext = await prepareHistoryContext();

    // 加载历史数据
    const modelHistory = await loadModelHistoryFromMemory();

    // 保存当前场景状态（如果有）
    if (sceneState && sceneState.length > 0) {
      await saveSceneStateToMemory(prompt, sceneState);
      console.log(
        `[${requestId}] Saved scene state with ${sceneState.length} objects to memory`
      );
    } else {
      // 即使没有对象，也保存空场景状态，确保历史记录的连续性
      await saveSceneStateToMemory(prompt, []);
      console.log(`[${requestId}] Saved empty scene state to memory`);
    }

    // 获取可用工具
    const toolRegistry = ToolRegistry.getInstance();
    const tools = toolRegistry.getAllTools();

    // 使用 agent 优化代码
    console.log(`[${requestId}] Running agent loop for code optimization`);
    return await runAgentLoop(
      "", // 无需截图分析，直接开始优化
      code,
      tools,
      prompt,
      historyContext,
      lintErrors,
      modelSize !== undefined && modelSize > 0, // 转换为布尔值
      sceneState,
      modelHistory,
      typeof sceneHistory === "string"
        ? sceneHistory
        : JSON.stringify(sceneHistory || {}),
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
  prompt: string
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
    const historyContext = await prepareHistoryContext();
    const sceneHistory = await loadSceneHistoryFromMemory();
    const modelHistory = await loadModelHistoryFromMemory();

    // 获取工具（仅模型生成相关工具）
    const toolRegistry = ToolRegistry.getInstance();
    const tools = toolRegistry.getAllTools();

    // 创建专门针对模型生成的建议
    const suggestion = `根据用户需求"${prompt}"生成适合的3D模型。`;

    // 运行 agent 循环，设置 modelRequired 为 true
    console.log(`[${requestId}] Running agent loop for model generation`);
    return await runAgentLoop(
      suggestion,
      code,
      tools,
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

/**
 * 处理错误修复请求
 * 使用fixBugTool修复前端传递的错误
 */
async function handleBugFix(
  req: NextApiRequest,
  res: NextApiResponse,
  requestId: string,
  code: string,
  prompt: string,
  errorDescription?: string,
  errorDetails?: string,
  lintErrors?: LintError[],
  sceneState?: SceneStateObject[]
) {
  console.log(`[${requestId}] Processing bug fix request`);

  // 验证必需参数
  if (!errorDescription) {
    console.log(`[${requestId}] Missing required parameter: errorDescription`);
    return res.status(400).json({
      error: "Missing required parameter: errorDescription",
    });
  }

  try {
    // 导入fixBugTool
    const { fixBugTool } = await import("../../lib/tools/fixBugTool");

    // 调用fixBugTool修复错误
    console.log(
      `[${requestId}] Calling fixBugTool to fix error: ${errorDescription}`
    );

    const fixedCode = await fixBugTool.func({
      errorDescription,
      errorDetails,
      currentCode: code,
      sceneState: sceneState as Record<string, unknown>[] | undefined,
      lintErrors: lintErrors as Record<string, unknown>[] | undefined,
      preserveModels: true,
    });

    // 返回修复结果
    console.log(`[${requestId}] Bug fix completed successfully`);
    return res.status(200).json({
      success: true,
      directCode: fixedCode,
      message: "错误已修复",
      errorDescription,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error(`[${requestId}] Bug fix failed:`, error);
    return res.status(500).json({
      error: "Bug fix failed",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * 处理图片场景生成请求
 * 基于上传的图片生成相似的3D场景
 */
async function handleImageSceneGeneration(
  req: NextApiRequest,
  res: NextApiResponse,
  requestId: string,
  imageData?: string,
  prompt?: string,
  sceneState?: SceneStateObject[]
) {
  console.log(`[${requestId}] Processing image scene generation request`);

  // 验证必需参数
  if (!imageData) {
    console.log(`[${requestId}] Missing required imageData parameter`);
    return res.status(400).json({
      error: "Missing required parameter: imageData",
    });
  }

  try {
    // 导入图片场景生成工具
    const { imageSceneTool } = await import("../../lib/tools/imageSceneTool");

    console.log(`[${requestId}] Calling image scene generation tool`);

    // 调用图片场景生成工具
    const result = await imageSceneTool.invoke({
      imageData: imageData,
      userRequirement: prompt || "根据图片内容创建相似的3D场景",
    });

    // 解析工具返回结果
    let parsedResult;
    try {
      parsedResult = JSON.parse(result);
    } catch (parseError) {
      console.error(`[${requestId}] Failed to parse tool result:`, parseError);
      throw new Error("Failed to parse scene generation result");
    }

    if (!parsedResult.success) {
      throw new Error(parsedResult.error || "Scene generation failed");
    }

    // 保存场景状态到内存（如果有场景状态）
    if (sceneState && Array.isArray(sceneState)) {
      await saveSceneStateToMemory(sceneState);
    }

    console.log(`[${requestId}] Image scene generation completed successfully`);

    return res.status(200).json({
      success: true,
      directCode: parsedResult.code,
      analysis: parsedResult.analysis,
      message:
        parsedResult.message || "Successfully generated 3D scene from image",
    });
  } catch (error) {
    console.error(`[${requestId}] Image scene generation failed:`, error);
    return res.status(500).json({
      error: "Image scene generation failed",
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
