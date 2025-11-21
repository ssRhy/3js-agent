// runInteractionFlow：负责用户意图理解、高层决策和资源协调
// runAgentLoop：负责实际推理、工具使用和详细任务执行
/* eslint-disable @typescript-eslint/no-unused-vars */
// lib/agents/agentExecutor.ts

import { RunnableWithMessageHistory } from "@langchain/core/runnables";
import { BaseChatMessageHistory } from "@langchain/core/chat_history";
import { Tool } from "@langchain/core/tools";
import { NextApiResponse } from "next";
import { ChatMessageHistory } from "langchain/stores/message/in_memory";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { AgentAction, AgentFinish } from "langchain/agents";
import { LLMResult } from "@langchain/core/outputs";
import { ChainValues } from "@langchain/core/utils/types";

// 导入 agent 创建工厂
import {
  createAgent,
  createAgentExecutor,
  createModelClient,
} from "./agentFactory";

// 导入内存管理功能
import {
  createMemoryCallbackHandler,
  initializeChromaDB,
  saveSceneStateToMemory,
  loadSceneHistoryFromMemory,
  loadModelHistoryFromMemory,
  getCodeDigest,
  prepareHistoryContext,
} from "../memory/memoryManager";

// 导入代码处理和模型提取工具
import { cleanCodeOutput } from "../processors/codeProcessor";
import { extractModelUrls } from "../processors/modelExtractor";

// 导入工具
import { ToolRegistry } from "../tools/toolRegistry";
import { applyPatchTool } from "../tools/applyPatchTool";
import { screenshotTool } from "../tools/screenshotTool";

// 导入类型
import { SceneStateObject, ModelHistoryEntry } from "../types/sceneTypes";
import { LintError } from "../types/codeTypes";

// 用于清理session状态
import { clearSessionState } from "../memory/memoryManager";

// 引入当前缓存代码管理
import { getCachedCode, updateCachedCode } from "../tools/applyPatchTool";

// 导入chatbot功能
import {
  initializeChatbot,
  onAgentComplete,
  updateChatbotContext,
  handleUserChatInput,
} from "./chatbotAgent";

// 将screenshotTool转为Tool类型
const screenshotToolInstance = screenshotTool as unknown as Tool;

// 存储常量
const MAX_ITERATIONS = 10;

// 全局会话历史 - 通过ChatMessageHistory保持多轮对话的连贯性
const sessionHistory = new ChatMessageHistory();

// 用于保持对话上下文的全局对象
const conversationContext: {
  lastUserPrompt?: string;
  lastCodeGenerated?: string;
  lastModelUrls?: { url: string; name: string }[];
  conversationSummary?: string;
  lastSceneState?: SceneStateObject[]; // 添加上一次场景状态
} = {};

// 获取消息历史
function getMessageHistory(): BaseChatMessageHistory {
  return sessionHistory;
}

// 更新对话上下文
function updateConversationContext(
  key: keyof typeof conversationContext,
  value: unknown
): void {
  // 根据key类型分别处理
  switch (key) {
    case "lastUserPrompt":
    case "lastCodeGenerated":
    case "conversationSummary":
      conversationContext[key] = value as string;
      break;
    case "lastModelUrls":
      conversationContext[key] = value as { url: string; name: string }[];
      break;
    case "lastSceneState":
      conversationContext[key] = value as SceneStateObject[];
      break;
  }
  console.log(`[Memory] Updated conversation context: ${key}`);
}

// 安全地获取字符串值
function safeString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

// 保存交互到内存
async function saveInteractionToMemory(
  userPrompt: unknown,
  agentResponse: string
): Promise<void> {
  const promptStr = safeString(userPrompt);

  // 首先，将交互添加到会话历史
  sessionHistory.addUserMessage(promptStr);
  sessionHistory.addAIMessage(agentResponse);

  // 更新对话上下文
  updateConversationContext("lastUserPrompt", promptStr);

  // 如果响应包含代码，提取并保存摘要
  if (
    agentResponse.includes("function") ||
    agentResponse.includes("class") ||
    agentResponse.includes("const")
  ) {
    const codeDigest = getCodeDigest(agentResponse);
    updateConversationContext("lastCodeGenerated", codeDigest);
  }

  console.log(
    `[Memory] Saved interaction to memory: "${promptStr.substring(0, 30)}..."`
  );
}

/**
 * 缓存工具执行结果的包装函数
 * 通过工具注册表的缓存机制执行工具，减少重复API调用
 *
 * @param toolName 工具名称
 * @param params 工具参数
 * @param ttl 缓存生存时间（毫秒），默认为30秒
 * @returns 工具执行结果
 */
async function executeToolWithCache(
  toolName: string,
  params: Record<string, unknown>,
  ttl: number = 30000
): Promise<unknown> {
  const registry = ToolRegistry.getInstance();
  return await registry.executeWithCache(toolName, params, ttl);
}

// 针对开销大的LLM调用的专用缓存函数
async function executeLLMToolWithCache(
  toolName: string,
  params: Record<string, unknown>
): Promise<unknown> {
  // LLM工具使用更长的缓存时间
  return executeToolWithCache(toolName, params, 5 * 60 * 1000); // 5分钟缓存
}

/**
 * 执行3D场景创建和代码生成的主要流程
 *
 * 简化版本：合并了runInteractionFlow和runAgentLoop的功能到一个函数中
 * 更清晰地遵循LangChain.js 0.3的API模式
 *
 * @param currentCode 当前代码
 * @param userPrompt 用户提示
 * @param screenshot 截图数据（可选）
 * @param screenshotAnalysis 预先分析的截图结果（可选）
 * @param sceneState 场景状态
 * @param sceneHistory 场景历史
 * @param lintErrors 代码检查错误
 * @param modelSize 模型大小
 * @param renderingComplete 渲染是否完成
 * @param requestId 请求ID
 */
export async function executeAgentWorkflow(
  currentCode: string,
  userPrompt: string,
  screenshot?: string,
  screenshotAnalysis?: {
    status: string;
    message: string;
    scene_objects?: Array<Record<string, unknown>>;
    matches_requirements?: boolean;
    needs_improvements?: boolean;
    recommendation?: string;
    [key: string]: unknown;
  },
  sceneState?: SceneStateObject[],
  sceneHistory?: Record<string, unknown>,
  lintErrors?: LintError[],
  modelSize?: number,
  renderingComplete?: boolean,
  requestId: string = `req_${Date.now()}`,
  enableModelGeneration: boolean = false,
  socketId?: string
): Promise<Record<string, unknown>> {
  console.log(
    `[${requestId}] Starting agent workflow for: "${userPrompt.substring(
      0,
      50
    )}..."`
  );

  // 创建WebSocket回调处理器 - 移到外部以便在catch块中访问
  const wsCallbackHandler = new WebSocketAgentCallbackHandler(
    requestId,
    socketId
  );

  try {
    // 1. 准备阶段: 检查和准备输入数据
    // -----------------------------------------------

    // 首先缓存当前代码，如果缓存为空
    if (!getCachedCode()) {
      console.log(`[${requestId}] Initializing code cache with current code`);
      updateCachedCode(currentCode);
    } else if (getCachedCode() !== currentCode) {
      // 代码发生变化，更新缓存并失效相关工具缓存
      console.log(
        `[${requestId}] Code changed, updating cache and invalidating tool caches`
      );
      updateCachedCode(currentCode);
      invalidateToolCache(["generate_fix_code", "analyze_screenshot"]);
    }

    // 合并当前场景状态与之前存储的场景状态
    let combinedSceneState = sceneState || [];
    if (
      (!sceneState || sceneState.length === 0) &&
      conversationContext.lastSceneState &&
      conversationContext.lastSceneState.length > 0
    ) {
      console.log(
        `[${requestId}] Using cached scene state from memory with ${conversationContext.lastSceneState.length} objects`
      );
      combinedSceneState = conversationContext.lastSceneState;
    } else if (sceneState && sceneState.length > 0) {
      if (
        conversationContext.lastSceneState &&
        JSON.stringify(conversationContext.lastSceneState) !==
          JSON.stringify(sceneState)
      ) {
        // 场景状态发生变化，失效相关缓存
        console.log(
          `[${requestId}] Scene state changed, invalidating related tool caches`
        );
        invalidateToolCache(["generate_fix_code", "analyze_screenshot"]);
      }
      console.log(
        `[${requestId}] Saving new scene state to memory with ${sceneState.length} objects`
      );
      updateConversationContext("lastSceneState", sceneState);
      // 保存到持久化记忆中
      await saveSceneStateToMemory(sceneState);
    }

    // 2. 上下文构建: 收集所有必要的上下文信息
    // -----------------------------------------------

    // 获取历史上下文
    const historyContext = await prepareHistoryContext();
    // 加载场景历史
    const loadedSceneHistory = await loadSceneHistoryFromMemory();
    // 获取模型历史记录
    const modelHistory = await loadModelHistoryFromMemory();

    // 增强历史上下文
    let enhancedHistoryContext = historyContext;
    if (conversationContext.lastCodeGenerated) {
      enhancedHistoryContext += `\n\nLast generated code summary: ${conversationContext.lastCodeGenerated}`;
    }
    if (
      conversationContext.lastUserPrompt &&
      conversationContext.lastUserPrompt !== userPrompt
    ) {
      enhancedHistoryContext += `\n\nLast user request: ${conversationContext.lastUserPrompt}`;
    }

    // 添加场景状态上下文
    if (combinedSceneState && combinedSceneState.length > 0) {
      enhancedHistoryContext += `\n\nThe current scene contains ${combinedSceneState.length} objects. This is an existing scene, and you must preserve and modify it, not recreate the entire scene.`;
    }

    // 添加截图分析上下文
    if (screenshot && renderingComplete === true) {
      enhancedHistoryContext +=
        "\n\nThe screenshot has been provided, and you must first use the analyze_screenshot tool to analyze whether the current scene meets the requirements. Then, based on the analysis results, decide on the next action." +
        "When calling the analyze_screenshot tool, you must use the complete screenshot parameter without modification or replacement." +
        "After the scene rendering is complete, you need to use the write_to_chroma tool to save the scene objects completely, ensuring that they include geometry, materials, and transformation information.";
    }

    // 构建系统指令
    let systemInstructions = "";
    let suggestion = "";

    if (screenshotAnalysis) {
      // 使用预先分析的结果
      console.log(
        `[${requestId}] Using pre-analyzed screenshot result: ${screenshotAnalysis.status}`
      );
      systemInstructions =
        "根据截图分析结果，优化或修复Three.js代码。确保所有3D模型底部与地面对齐。";
      suggestion = JSON.stringify(screenshotAnalysis);
    } else if (screenshot && renderingComplete) {
      // 需要分析截图
      systemInstructions =
        "You must first analyze the screenshot, then generate or modify the code based on the analysis results. " +
        "Ensure all 3D models are properly positioned with their bottom surfaces touching the ground. " +
        "Step 1: Call the analyze_screenshot tool to analyze the current scene. When calling, you must use the complete screenshot data without modification or replacement." +
        "Step 2: Based on the analysis results, if improvements are needed, call the generate_fix_code tool; if no improvements are needed, return the current code directly." +
        "Step 3: Use the apply_patch tool to apply incremental updates, not replace the entire code." +
        "Step 4: Use the write_to_chroma tool to save the newly generated Three.js objects to persistent storage. Each object must include complete geometry, materials, and transformation information.";
    } else {
      // 无截图的情况
      systemInstructions =
        "Generate or optimize Three.js code based on user requirements, using incremental updates. " +
        "CRITICAL: Ensure all 3D models are positioned with their bottom surfaces touching the ground (y=0). " +
        "If you need to reuse objects from previous scenes, use the retrieve_objects tool to query." +
        "Finally, use the write_to_chroma tool to save the newly generated Three.js objects to persistent storage. Ensure that the saved objects include complete geometry, materials, and transformation information.";
      suggestion =
        "1. Use the retrieve_objects tool to find related scene objects\n" +
        "2. Generate code based on user requirements, preserving existing objects\n" +
        "3. CRITICAL: Position all 3D models with bottom surfaces touching ground (y=0)\n" +
        "4. Use incremental update方式更新代码\n" +
        "5. Use the write_to_chroma tool to save the newly generated Three.js objects to persistent storage. Each object must include complete geometry, materials, and transformation information.";
    }

    // 3. 工具准备: 获取和配置工具
    // -----------------------------------------------

    // 获取工具列表 - 根据enableModelGeneration决定是否包含模型生成工具
    const registry = ToolRegistry.getInstance();
    const allTools = registry.getAllToolsWithExclusions(
      undefined,
      !enableModelGeneration
    );

    console.log(
      `[${requestId}] Model generation ${
        enableModelGeneration ? "ENABLED" : "DISABLED"
      }`
    );
    console.log(
      `[${requestId}] Available tools: ${allTools
        .map((t) => t.name)
        .join(", ")}`
    );

    // 确保工具列表中包含截图分析工具(如果提供了截图)
    const tools = [...allTools];
    if (screenshot) {
      const hasScreenshotTool = tools.some(
        (tool) => tool.name === "analyze_screenshot"
      );
      if (!hasScreenshotTool) {
        tools.push(screenshotToolInstance as Tool);
      }
    }

    // 为工具添加缓存能力，但确保generate_3d_model不使用缓存
    const cachedTools = tools.map((tool) => {
      // 对于generate_3d_model工具，不应用缓存，直接使用原始调用
      if (tool.name === "generate_3d_model") {
        console.log(
          `[${requestId}] Using ORIGINAL implementation for ${tool.name} - bypassing cache system completely`
        );
        return tool; // 直接返回原始工具，不做包装
      }

      // 判断工具类型，决定缓存策略
      const isCostlyTool =
        tool.name === "generate_fix_code" || tool.name === "analyze_screenshot";
      const originalCall = tool.call.bind(tool);

      // 重写工具的调用方法，使用缓存
      return {
        ...tool,
        call: async (input: Record<string, unknown>) => {
          const ttl = isCostlyTool ? 5 * 60 * 1000 : 30000; // 昂贵工具缓存5分钟，其他30秒
          try {
            console.log(
              `[${requestId}] Executing tool ${tool.name} with caching (TTL: ${ttl}ms)`
            );
            return await registry.executeWithCache(tool.name, input, ttl);
          } catch (error) {
            console.error(
              `[${requestId}] Error executing cached tool ${tool.name}:`,
              error
            );
            // 如果缓存执行失败，回退到原始调用
            console.log(
              `[${requestId}] Falling back to original tool execution for ${tool.name}`
            );
            return originalCall(input);
          }
        },
      } as Tool;
    });

    // 4. Agent执行: 使用LangChain.js 0.3 API创建和执行agent
    // -----------------------------------------------

    // 确保lintErrors是一个数组
    const safeLintErrors = Array.isArray(lintErrors) ? lintErrors : [];

    // 创建 agent
    const agent = await createAgent(userPrompt, currentCode, cachedTools, {
      historyContext: enhancedHistoryContext,
      modelHistory,
      sceneState: combinedSceneState,
      sceneHistory:
        typeof sceneHistory === "string"
          ? sceneHistory
          : loadedSceneHistory || JSON.stringify(sceneHistory || {}),
      enableModelGeneration: enableModelGeneration,
    });

    // 创建回调处理器
    const callbackHandler = createMemoryCallbackHandler(
      currentCode,
      userPrompt
    );

    // 创建agent执行器
    const executor = createAgentExecutor(agent, cachedTools, MAX_ITERATIONS);
    executor.callbacks = [callbackHandler, wsCallbackHandler];

    console.log(`[${requestId}] Starting agent execution...`);

    // 发送开始事件
    wsCallbackHandler.emitChatEvent({
      type: "chat_start",
      title: "Starting your request...",
      message:
        "Hi there! 🎨 I'm getting ready to work on your amazing 3D scene!",
    });

    // 添加消息历史支持
    const executorWithMemory = new RunnableWithMessageHistory({
      runnable: executor,
      getMessageHistory,
      inputMessagesKey: "input",
      historyMessagesKey: "chat_history",
    });

    // 准备输入和会话配置
    const inputForAgent = {
      input: userPrompt,
      suggestion: systemInstructions,
      currentCode,
      userPrompt: userPrompt || "无特定需求",
      historyContext: enhancedHistoryContext || "",
      lintErrors: safeLintErrors || [],
      modelRequired: modelSize !== undefined && modelSize > 0,
      conversationSummary: conversationContext.conversationSummary || "",
      screenshotBase64: screenshot || "",
      userRequirement: userPrompt || "",
      renderingComplete: renderingComplete === true,
      sceneState: combinedSceneState || [],
      sceneHistory:
        typeof sceneHistory === "string"
          ? sceneHistory
          : loadedSceneHistory || JSON.stringify(sceneHistory || {}),
    };

    const memoryConfig = {
      configurable: {
        sessionId: "global_session",
        requestId: requestId,
      },
    };

    console.log(
      `[${requestId}] Invoking agent executor with LangChain.js 0.3 execution model`
    );

    // 执行 agent
    const result = await executorWithMemory.invoke(inputForAgent, memoryConfig);

    // 5. 结果处理: 清理输出并执行后续步骤
    // -----------------------------------------------

    // 处理结果
    const cleanedOutput = cleanCodeOutput(result.output);
    const modelInfo = extractModelUrls(cleanedOutput);

    // 保存本次交互到内存
    await saveInteractionToMemory(userPrompt, cleanedOutput);

    // 如果有模型URL，保存到上下文
    if (modelInfo.modelUrls && modelInfo.modelUrls.length > 0) {
      updateConversationContext("lastModelUrls", modelInfo.modelUrls);
    }

    // 保存代码摘要到上下文
    updateConversationContext(
      "lastCodeGenerated",
      getCodeDigest(cleanedOutput)
    );

    // 使用apply_patch工具应用增量更新
    console.log(`[${requestId}] Using incremental update with apply_patch`);
    let improvedCode = cleanedOutput;

    // 获取当前缓存代码
    const cachedCode = getCachedCode();

    if (!cachedCode) {
      // 如果没有缓存代码，直接初始化
      console.log(
        `[${requestId}] No cached code found, initializing with current code`
      );
      const initResult = await applyPatchTool.invoke({
        input: JSON.stringify({ code: improvedCode }),
      });
      const parsedInitResult = JSON.parse(initResult);

      // 如果初始化返回了完整代码，使用它
      if (parsedInitResult.success && parsedInitResult.updatedCode) {
        improvedCode = parsedInitResult.updatedCode;
      }
    } else {
      // 如果有缓存代码，尝试应用补丁
      try {
        console.log(`[${requestId}] Applying incremental update`);
        const patchResult = await applyPatchTool.invoke({
          input: JSON.stringify({ code: improvedCode }),
        });
        const parsedResult = JSON.parse(patchResult);

        if (parsedResult.success) {
          console.log(`[${requestId}] Incremental update applied successfully`);
          improvedCode = parsedResult.updatedCode || improvedCode;
        } else {
          console.warn(
            `[${requestId}] Failed to apply incremental update: ${parsedResult.message}`
          );
        }
      } catch (patchError) {
        console.error(`[${requestId}] Error applying patch:`, patchError);
      }
    }

    // 不再发送默认的英文回复，只通过chatbot发送中文总结

    // 6. Chatbot集成: 生成总结和建议
    // -----------------------------------------------

    // 更新chatbot上下文
    updateChatbotContext({
      currentCode: improvedCode,
      sceneState: combinedSceneState,
      lastAction: cleanedOutput,
    });

    // 生成Agent完成后的总结和建议
    try {
      const agentSummary = await onAgentComplete(
        result,
        userPrompt,
        improvedCode,
        combinedSceneState || []
      );

      console.log(`[${requestId}] Generated agent completion summary`);

      // 将总结发送到前端
      if (wsCallbackHandler) {
        wsCallbackHandler.emitChatEvent({
          type: "agent_summary",
          title: "✨ 任务完成总结",
          message: agentSummary,
        });
      }
    } catch (summaryError) {
      console.error(
        `[${requestId}] Error generating agent summary:`,
        summaryError
      );
    }

    // 组装最终结果
    const finalResult = {
      directCode: improvedCode,
      chatResponse: "Scene updated successfully", // 简单的确认消息
      ...(modelInfo.modelUrl ? { modelUrl: modelInfo.modelUrl } : {}),
      ...(modelInfo.modelUrls && modelInfo.modelUrls.length > 0
        ? { modelUrls: modelInfo.modelUrls }
        : {}),
    };

    console.log(`[${requestId}] Agent workflow completed successfully`);
    return finalResult;
  } catch (error) {
    console.error(`[${requestId}] Agent workflow failed:`, error);

    // 个性化错误回复
    let errorChatResponse =
      "Hey there! 😊 I encountered a small bump while working on your amazing 3D scene. ";

    // 根据错误类型提供不同的回复
    const errorMessage =
      error instanceof Error
        ? error.message.toLowerCase()
        : String(error).toLowerCase();

    if (errorMessage.includes("timeout") || errorMessage.includes("time")) {
      errorChatResponse +=
        "It looks like the process took a bit longer than expected, but no worries! ";
    } else if (
      errorMessage.includes("network") ||
      errorMessage.includes("connection")
    ) {
      errorChatResponse +=
        "I ran into a network hiccup, but these things happen! ";
    } else if (
      errorMessage.includes("memory") ||
      errorMessage.includes("resource")
    ) {
      errorChatResponse +=
        "I encountered a resource limitation, but I've kept your work safe! ";
    } else {
      errorChatResponse +=
        "I hit a technical challenge, but that's all part of the creative process! ";
    }

    errorChatResponse +=
      "The good news is that your original code is completely safe and unchanged. " +
      "Sometimes these things happen when we're pushing the boundaries of what's possible in 3D! 🎨 " +
      "Why don't you try again, or maybe we can approach it from a slightly different angle? " +
      "I'm always here and ready to help bring your vision to life! ✨";

    // 发送错误情况下的聊天回复
    if (wsCallbackHandler) {
      wsCallbackHandler.emitChatEvent({
        type: "chat_error",
        title: "Encountered a small challenge",
        message: errorChatResponse,
      });
    }

    return {
      error: "处理失败",
      details: error instanceof Error ? error.message : String(error),
      directCode: currentCode, // 出错时返回原始代码
      chatResponse: errorChatResponse,
    };
  }
}

// 为了保持向后兼容性，将之前的函数重新指向到新的简化函数
export async function runInteractionFlow(
  currentCode: string,
  userPrompt: string,
  screenshot?: string,
  screenshotAnalysis?: {
    status: string;
    message: string;
    scene_objects?: Array<Record<string, unknown>>;
    matches_requirements?: boolean;
    needs_improvements?: boolean;
    recommendation?: string;
    [key: string]: unknown;
  },
  sceneState?: SceneStateObject[],
  sceneHistory?: Record<string, unknown>,
  lintErrors?: LintError[],
  modelSize?: number,
  renderingComplete?: boolean,
  requestId: string = `req_${Date.now()}`,
  enableModelGeneration: boolean = false,
  socketId?: string
): Promise<Record<string, unknown>> {
  console.log(
    `[${requestId}] runInteractionFlow is now an alias for executeAgentWorkflow`
  );
  return executeAgentWorkflow(
    currentCode,
    userPrompt,
    screenshot,
    screenshotAnalysis,
    sceneState,
    sceneHistory,
    lintErrors,
    modelSize,
    renderingComplete,
    requestId,
    enableModelGeneration,
    socketId
  );
}

export async function runAgentLoop(
  suggestion: string,
  currentCode: string,
  tools: Tool[],
  userPrompt: string | Record<string, unknown> = "",
  historyContext: string = "",
  lintErrors?: LintError[],
  modelRequired?: boolean,
  sceneState?: SceneStateObject[],
  modelHistory?: ModelHistoryEntry[],
  sceneHistory?: string,
  res?: NextApiResponse,
  screenshot?: string,
  renderingComplete?: boolean,
  selfDriven: boolean = false
): Promise<string | void> {
  console.log(
    `Legacy runAgentLoop called - redirecting to executeAgentWorkflow`
  );

  // 转换参数以适应新接口
  const promptStr = safeString(userPrompt);
  const result = await executeAgentWorkflow(
    currentCode,
    promptStr,
    screenshot,
    undefined, // 没有预分析的截图
    sceneState,
    typeof sceneHistory === "object" ? sceneHistory : { history: sceneHistory },
    lintErrors,
    modelRequired ? 1 : 0, // 转换为模型大小
    renderingComplete,
    `req_${Date.now()}`
  );

  // 处理响应以匹配原始函数
  if (res && typeof res.status === "function" && !res.writableEnded) {
    res.status(200).json(result);
    return;
  }

  return result.directCode as string;
}

// 确保工具已初始化
ToolRegistry.getInstance();

export { clearSessionState };

// WebSocket Agent事件类型
interface AgentEvent {
  type:
    | "step_start"
    | "step_complete"
    | "tool_start"
    | "tool_complete"
    | "llm_start"
    | "llm_complete"
    | "agent_complete"
    | "agent_error";
  stepId: string;
  stepType:
    | "thinking"
    | "tool_call"
    | "analysis"
    | "code_generation"
    | "completion";
  title: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "error";
  timestamp: Date;
  details?: {
    toolName?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    output?: any;
    reasoning?: string;
    suggestions?: string[];
    metrics?: Record<string, number | string>;
  };
}

// 修改 WebSocketAgentCallbackHandler 类（第782行开始）
class WebSocketAgentCallbackHandler extends BaseCallbackHandler {
  name = "WebSocketAgentCallbackHandler";
  private requestId: string;
  private currentStepId: string = "";
  private targetSocketId: string | null = null; // 目标客户端socket ID
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private socketServer: any = null;

  constructor(requestId: string, targetSocketId?: string) {
    super();
    this.requestId = requestId;
    this.targetSocketId = targetSocketId || null;

    // 尝试获取全局socket服务器实例
    if (global.socketIOServer) {
      this.socketServer = global.socketIOServer;
    }
  }

  private emitAgentEvent(event: AgentEvent) {
    // 静默检查：没有socket服务器、目标客户端或连接映射时直接返回
    if (
      !this.socketServer ||
      !this.targetSocketId ||
      !global.connectedClients
    ) {
      return;
    }

    // 获取目标客户端
    const targetSocket = global.connectedClients.get(this.targetSocketId);
    if (!targetSocket || !targetSocket.connected) {
      return;
    }

    // 发送到特定客户端
    try {
      targetSocket.emit("agent_event", {
        requestId: this.requestId,
        ...event,
      });
    } catch (error) {
      console.error(`[${this.requestId}] Error sending agent event:`, error);
    }
  }

  private generateStepId(): string {
    return `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Agent开始执行
  handleAgentAction(action: AgentAction): Promise<void> | void {
    this.currentStepId = this.generateStepId();

    const event: AgentEvent = {
      type: "step_start",
      stepId: this.currentStepId,
      stepType: "tool_call",
      title: `Using ${action.tool}`,
      description: `Executing tool: ${action.tool}`,
      status: "in_progress",
      timestamp: new Date(),
      details: {
        toolName: action.tool,
        input: action.toolInput,
      },
    };

    this.emitAgentEvent(event);
  }

  // 工具执行开始
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleToolStart(tool: any, input: string): Promise<void> | void {
    const toolName = typeof tool === "string" ? tool : tool?.name || "unknown";

    const event: AgentEvent = {
      type: "tool_start",
      stepId: this.currentStepId || this.generateStepId(),
      stepType: "tool_call",
      title: `Executing ${toolName}`,
      description: `Running ${toolName} tool...`,
      status: "in_progress",
      timestamp: new Date(),
      details: {
        toolName,
        input,
      },
    };

    this.emitAgentEvent(event);
  }

  // 工具执行完成
  handleToolEnd(output: string): Promise<void> | void {
    const event: AgentEvent = {
      type: "tool_complete",
      stepId: this.currentStepId,
      stepType: "tool_call",
      title: "Tool execution completed",
      description: "Tool finished successfully",
      status: "completed",
      timestamp: new Date(),
      details: {
        output,
      },
    };

    this.emitAgentEvent(event);
  }

  // LLM开始执行
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleLLMStart(llm: any, prompts: string[]): Promise<void> | void {
    this.currentStepId = this.generateStepId();

    const event: AgentEvent = {
      type: "llm_start",
      stepId: this.currentStepId,
      stepType: "thinking",
      title: "AI is thinking...",
      description: "Processing your request and analyzing context",
      status: "in_progress",
      timestamp: new Date(),
      details: {
        reasoning: "Analyzing user requirements and generating response",
      },
    };

    this.emitAgentEvent(event);
  }

  // LLM执行完成
  handleLLMEnd(output: LLMResult): Promise<void> | void {
    const event: AgentEvent = {
      type: "llm_complete",
      stepId: this.currentStepId,
      stepType: "thinking",
      title: "AI reasoning completed",
      description: "Finished processing your request",
      status: "completed",
      timestamp: new Date(),
    };

    this.emitAgentEvent(event);
  }

  // Agent执行完成
  handleAgentEnd(action: AgentFinish): Promise<void> | void {
    const event: AgentEvent = {
      type: "agent_complete",
      stepId: this.generateStepId(),
      stepType: "completion",
      title: "Task completed",
      description: "Successfully generated your 3D scene",
      status: "completed",
      timestamp: new Date(),
      details: {
        output: action.returnValues?.output || action.returnValues,
      },
    };

    this.emitAgentEvent(event);
  }

  // 错误处理
  handleChainError(error: Error): Promise<void> | void {
    const event: AgentEvent = {
      type: "agent_error",
      stepId: this.currentStepId || this.generateStepId(),
      stepType: "completion",
      title: "Error occurred",
      description: `An error occurred: ${error.message}`,
      status: "error",
      timestamp: new Date(),
      details: {
        output: error.message,
      },
    };

    this.emitAgentEvent(event);
  }

  emitChatEvent(event: { type: string; title: string; message: string }) {
    // 检查socket服务器是否存在
    if (!this.socketServer && !global.socketIOServer) {
      return;
    }

    const server = this.socketServer || global.socketIOServer;

    // 如果有特定的目标客户端，发送给该客户端
    if (this.targetSocketId && global.connectedClients) {
      const targetSocket = global.connectedClients.get(this.targetSocketId);
      if (targetSocket && targetSocket.connected) {
        try {
          targetSocket.emit("chat_event", {
            requestId: this.requestId,
            ...event,
          });
          return;
        } catch (error) {
          console.error(
            `[${this.requestId}] Error sending chat event to specific client:`,
            error
          );
        }
      }
    }

    // 如果没有特定目标或发送失败，广播给所有连接的客户端
    if (server) {
      try {
        server.emit("chat_event", {
          requestId: this.requestId,
          ...event,
        });
        console.log(
          `[${this.requestId}] Broadcasted chat event: ${event.type}`
        );
      } catch (error) {
        console.error(
          `[${this.requestId}] Error broadcasting chat event:`,
          error
        );
      }
    }
  }
}

/**
 * 当代码或场景状态发生重大变化时，失效特定工具的缓存
 */
function invalidateToolCache(tools: string[] = []): void {
  const registry = ToolRegistry.getInstance();

  if (tools.length === 0) {
    registry.clearCache("generate_fix_code");
    registry.clearCache("analyze_screenshot");
    console.log("[Cache] Cleared cache for all code-related tools");
  } else {
    tools.forEach((toolName) => {
      registry.clearCache(toolName);
    });
    console.log(`[Cache] Cleared cache for tools: ${tools.join(", ")}`);
  }
}
