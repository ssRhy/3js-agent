// runInteractionFlow：负责用户意图理解、高层决策和资源协调
// runAgentLoop：负责实际推理、工具使用和详细任务执行
/* eslint-disable @typescript-eslint/no-unused-vars */
// lib/agents/agentExecutor.ts
import { AgentExecutor } from "langchain/agents";
import { RunnableWithMessageHistory } from "@langchain/core/runnables";
import { BaseChatMessageHistory } from "@langchain/core/chat_history";
import { Tool } from "langchain/tools";
import { NextApiResponse } from "next";
import { ChatMessageHistory } from "langchain/stores/message/in_memory";
import { ConversationSummaryBufferMemory } from "langchain/memory";

// 导入 agent 创建工厂
import { createAgent, createAgentExecutor } from "./agentFactory";

// 导入代码处理和模型提取工具
import { cleanCodeOutput } from "../processors/codeProcessor";
import { extractModelUrls } from "../processors/modelExtractor";

// 导入内存管理功能
import {
  createMemoryCallbackHandler,
  prepareHistoryContext,
  loadSceneHistoryFromMemory,
  loadModelHistoryFromMemory,
  saveSceneStateToMemory,
  clearSessionState,
  ModelHistoryEntry,
  getCodeMemory,
  getSceneMemory,
  getCodeDigest,
} from "../memory/memoryManager";

// 导入工具
import { screenshotTool } from "../tools/screenshotTool";
import { ToolRegistry, ToolCategory } from "../tools/toolRegistry";
import { codeGenTool } from "../tools/codeGenTool";
import { modelGenTool } from "../tools/modelGenTool";
import {
  applyPatchTool,
  getCachedCode,
  updateCachedCode,
} from "../tools/applyPatchTool";
import { retrievalTool } from "../tools/retrievalTool";
import { writeChromaTool } from "../tools/writeChromaTool";
import { chromaService } from "../services/chromaService";
import { wrapToolsWithCache } from "../tools/toolCaching";

// 将screenshotTool转为Tool类型
const screenshotToolInstance = screenshotTool as unknown as Tool;

// 导入类型
import { LintError } from "../types/codeTypes";
import { SceneStateObject } from "../types/sceneTypes";

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

// 初始化 ChromaDB 并确保服务可用
async function initializeChromaDB(): Promise<void> {
  try {
    console.log(`[ChromaDB] Initializing ChromaDB service...`);
    await chromaService.initialize();
    console.log(`[ChromaDB] ChromaDB service initialized successfully`);
  } catch (error) {
    console.error(`[ChromaDB] Failed to initialize ChromaDB:`, error);
  }
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
 * 当代码或场景状态发生重大变化时，失效特定工具的缓存
 *
 * @param tools 需要清除缓存的工具名称数组
 */
function invalidateToolCache(tools: string[] = []): void {
  const registry = ToolRegistry.getInstance();

  if (tools.length === 0) {
    // 默认清除所有与代码生成和分析相关的工具缓存
    registry.clearCache("generate_fix_code");
    registry.clearCache("analyze_screenshot");
    console.log("[Cache] Cleared cache for all code-related tools");
  } else {
    // 清除指定工具的缓存
    tools.forEach((toolName) => {
      registry.clearCache(toolName);
    });
    console.log(`[Cache] Cleared cache for tools: ${tools.join(", ")}`);
  }
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
  requestId: string = `req_${Date.now()}`
): Promise<Record<string, unknown>> {
  console.log(
    `[${requestId}] Starting agent workflow for: "${userPrompt.substring(
      0,
      50
    )}..."`
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
      enhancedHistoryContext += `\n\n上次生成的代码摘要: ${conversationContext.lastCodeGenerated}`;
    }
    if (
      conversationContext.lastUserPrompt &&
      conversationContext.lastUserPrompt !== userPrompt
    ) {
      enhancedHistoryContext += `\n\n上次用户请求: ${conversationContext.lastUserPrompt}`;
    }

    // 添加场景状态上下文
    if (combinedSceneState && combinedSceneState.length > 0) {
      enhancedHistoryContext += `\n\n当前场景包含 ${combinedSceneState.length} 个对象。这是已经存在的场景，你必须保留并在此基础上进行修改，不要重新创建整个场景。`;
    }

    // 添加截图分析上下文
    if (screenshot && renderingComplete === true) {
      enhancedHistoryContext +=
        "\n\n场景截图已提供，你必须首先使用analyze_screenshot工具分析当前场景是否符合需求，然后根据分析结果决定下一步行动。" +
        "调用analyze_screenshot工具时，必须使用完整的screenshot参数，切勿替换或修改。" +
        "场景渲染完成后，需要使用write_to_chroma工具将场景中的对象完整保存，确保包含几何体、材质和变换信息。";
    }

    // 构建系统指令
    let systemInstructions = "";
    let suggestion = "";

    if (screenshotAnalysis) {
      // 使用预先分析的结果
      console.log(
        `[${requestId}] Using pre-analyzed screenshot result: ${screenshotAnalysis.status}`
      );
      systemInstructions = "根据截图分析结果，优化或修复Three.js代码。";
      suggestion = JSON.stringify(screenshotAnalysis);
    } else if (screenshot && renderingComplete) {
      // 需要分析截图
      systemInstructions =
        "你必须首先分析截图，然后根据分析结果进行代码生成或修改。" +
        "步骤1: 调用analyze_screenshot工具分析当前场景。调用时必须使用完整的截图数据，不要修改或替换。" +
        "步骤2: 根据分析结果，如果需要改进，则调用generate_fix_code工具；如果不需要改进，则直接返回当前代码。" +
        "步骤3: 使用apply_patch工具应用增量更新，而不是替换整个代码。" +
        "步骤4: 使用write_to_chroma工具将新生成的Three.js对象保存到持久化存储中。每个对象必须包含完整的几何体、材质和变换信息。";
    } else {
      // 无截图的情况
      systemInstructions =
        "根据用户需求生成或优化Three.js代码，使用增量更新方式。" +
        "如果需要重用之前场景中的对象，请使用retrieve_objects工具查询。" +
        "最后，使用write_to_chroma工具保存新生成的Three.js对象到持久化存储。确保保存对象时包含完整的几何体、材质和变换信息。";
      suggestion =
        "1. 使用retrieve_objects工具查找相关的场景对象\n" +
        "2. 根据用户需求生成代码，保留已有对象\n" +
        "3. 使用增量更新方式更新代码\n" +
        "4. 使用write_to_chroma工具将生成的对象完整保存到ChromaDB持久化存储";
    }

    // 3. 工具准备: 获取和配置工具
    // -----------------------------------------------

    // 获取工具列表
    const registry = ToolRegistry.getInstance();
    const allTools = registry.getAllTools();

    // 确保工具列表中包含截图分析工具(如果提供了截图)
    let tools = [...allTools];
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
      lintErrors: safeLintErrors,
      historyContext: enhancedHistoryContext,
      modelHistory,
      sceneState: combinedSceneState,
      sceneHistory:
        typeof sceneHistory === "string"
          ? sceneHistory
          : loadedSceneHistory || JSON.stringify(sceneHistory || {}),
    });

    // 创建回调处理器
    const callbackHandler = createMemoryCallbackHandler(
      currentCode,
      userPrompt
    );

    // 创建agent执行器
    const executor = createAgentExecutor(agent, cachedTools, MAX_ITERATIONS);
    executor.callbacks = [callbackHandler];

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

    // 组装最终结果
    const finalResult = {
      directCode: improvedCode,
      ...(modelInfo.modelUrl ? { modelUrl: modelInfo.modelUrl } : {}),
      ...(modelInfo.modelUrls && modelInfo.modelUrls.length > 0
        ? { modelUrls: modelInfo.modelUrls }
        : {}),
    };

    console.log(`[${requestId}] Agent workflow completed successfully`);
    return finalResult;
  } catch (error) {
    console.error(`[${requestId}] Agent workflow failed:`, error);
    return {
      error: "处理失败",
      details: error instanceof Error ? error.message : String(error),
      directCode: currentCode, // 出错时返回原始代码
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
  requestId: string = `req_${Date.now()}`
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
    requestId
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
