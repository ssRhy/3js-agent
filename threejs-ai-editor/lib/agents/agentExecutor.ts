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
 * 运行交互流程
 * 整合了代码优化、截图分析等功能的完整流程
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
    `[${requestId}] Starting interaction flow with ${
      screenshotAnalysis
        ? "pre-analyzed screenshot"
        : screenshot
        ? "raw screenshot"
        : "no screenshot"
    }`
  );

  try {
    // 确保 ChromaDB 服务已初始化
    await initializeChromaDB();

    // 首先缓存当前代码，如果缓存为空
    if (!getCachedCode()) {
      console.log(`[${requestId}] Initializing code cache with current code`);
      updateCachedCode(currentCode);
    }

    // 合并当前场景状态与之前存储的场景状态
    let combinedSceneState = sceneState || [];

    // 如果没有新的场景状态但有存储的状态，则使用存储的状态
    if (
      (!sceneState || sceneState.length === 0) &&
      conversationContext.lastSceneState &&
      conversationContext.lastSceneState.length > 0
    ) {
      console.log(
        `[${requestId}] Using cached scene state from memory with ${conversationContext.lastSceneState.length} objects`
      );
      combinedSceneState = conversationContext.lastSceneState;
    }
    // 如果有新场景状态，保存到会话上下文中
    else if (sceneState && sceneState.length > 0) {
      console.log(
        `[${requestId}] Saving new scene state to memory with ${sceneState.length} objects`
      );
      updateConversationContext("lastSceneState", sceneState);
      // 保存到持久化记忆中
      await saveSceneStateToMemory(sceneState);
    }

    // 获取历史上下文
    const historyContext = await prepareHistoryContext();
    console.log(
      `[${requestId}] Prepared history context: ${
        historyContext ? historyContext.substring(0, 100) + "..." : "none"
      }`
    );

    // 加载场景历史以增强上下文
    const loadedSceneHistory = await loadSceneHistoryFromMemory();
    console.log(
      `[${requestId}] Loaded scene history: ${
        loadedSceneHistory ? "success" : "none"
      }`
    );

    // 获取模型历史记录
    const modelHistory = await loadModelHistoryFromMemory();

    // 获取工具列表
    const registry = ToolRegistry.getInstance();
    const tools = registry.getAllTools();

    // 构建系统指令，根据是否有截图分析结果或原始截图而不同
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

    // 如果有场景状态，添加到系统指令中
    if (combinedSceneState && combinedSceneState.length > 0) {
      systemInstructions +=
        "\n\n当前场景中已有对象，请保留已有对象并根据需求进行修改或添加，避免重新创建整个场景。" +
        "可以使用retrieve_objects工具获取历史场景对象详情。每次生成或修改场景后，务必使用write_to_chroma工具保存完整的对象数据，包括几何体、材质和变换信息。";
    }

    // 运行agent循环
    console.log(
      `[${requestId}] Running agent loop with system instructions: ${systemInstructions.substring(
        0,
        100
      )}...`
    );

    // 转换modelSize为布尔值
    const modelRequired = modelSize !== undefined && modelSize > 0;

    // 运行agent循环获取改进后的代码
    let improvedCode = (await runAgentLoop(
      suggestion,
      currentCode,
      tools,
      userPrompt,
      historyContext,
      lintErrors,
      modelRequired,
      combinedSceneState, // 使用合并后的场景状态
      modelHistory,
      typeof sceneHistory === "string"
        ? sceneHistory
        : loadedSceneHistory || JSON.stringify(sceneHistory || {}),
      undefined, // res
      screenshot,
      renderingComplete === true, // 确保传递boolean类型
      true // selfDriven
    )) as string;

    if (!improvedCode) {
      improvedCode = currentCode;
    }

    // 使用apply_patch工具应用增量更新
    console.log(`[${requestId}] Using incremental update with apply_patch`);

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
      console.log(
        `[${requestId}] Code cache initialized: ${
          JSON.parse(initResult).success
        }`
      );
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

    // 提取结果中的模型信息
    const extractedModelInfo = extractModelUrls(improvedCode);

    // 保存代码到交互记忆
    updateConversationContext(
      "lastCodeGenerated",
      improvedCode.substring(0, 200) + "..."
    );

    // 如果模型URL列表中有模型，添加到结果中
    const modelUrls = extractedModelInfo.modelUrls || [];

    // 返回结果
    const result = {
      directCode: improvedCode,
      ...(extractedModelInfo.modelUrl
        ? { modelUrl: extractedModelInfo.modelUrl }
        : {}),
      ...(modelUrls.length > 0 ? { modelUrls } : {}),
    };

    console.log(
      `[${requestId}] Interaction flow completed successfully with incremental update`
    );
    return result;
  } catch (error) {
    console.error(`[${requestId}] Interaction flow failed:`, error);
    return {
      error: "处理失败",
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 运行 agent 循环 - 用于复杂场景的代码优化
 * 增强版本：添加了更强大的内存管理、对话连贯性支持和自驱动模式
 */
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
  selfDriven: boolean = false // 是否启用自驱动模式
): Promise<string | void> {
  const requestId = `req_${Date.now()}`;
  const promptStr = safeString(userPrompt);

  console.log(
    `[${requestId}] Starting agent loop: "${promptStr.substring(0, 50)}..."${
      selfDriven ? " (self-driven mode)" : ""
    }`
  );

  // 使用工具注册表获取工具（如果未提供）
  if (!tools || tools.length === 0) {
    const registry = ToolRegistry.getInstance();
    tools = registry.getAllTools();
    console.log(`[${requestId}] Using ${tools.length} tools from registry`);
  }

  // 确保工具列表中包含截图分析工具(如果提供了截图)
  if (screenshot) {
    const hasScreenshotTool = tools.some(
      (tool) => tool.name === "analyze_screenshot"
    );
    if (!hasScreenshotTool) {
      console.log(
        `[${requestId}] Adding screenshot analysis tool to agent tools`
      );
      tools.push(screenshotToolInstance);
    }
  }

  // 检查截图数据的有效性
  if (screenshot) {
    console.log(
      `[${requestId}] [Screenshot Check] Screenshot data type: ${typeof screenshot}, ` +
        `length: ${screenshot ? screenshot.length : 0} characters, ` +
        `starts with data: ${screenshot && screenshot.startsWith("data:")}`
    );

    // 确认截图数据有效
    if (
      !screenshot ||
      screenshot === "<screenshot>" ||
      screenshot.length < 100
    ) {
      console.warn(
        `[${requestId}] [Screenshot Check] Invalid screenshot data detected. Will not use screenshot analysis.`
      );
      // 如果截图无效，设置为undefined以避免后续错误
      screenshot = undefined;
      renderingComplete = false;
    }
  }

  // 在LangChain.js 0.3中，不再需要分离的自驱动逻辑，因为可以使用函数调用链
  // 我们将使用单次agent执行，在executor内部完成"截图分析→代码生成"的闭环
  if (selfDriven && screenshot && renderingComplete === true) {
    console.log(
      `[${requestId}] Using integrated LangChain.js 0.3 agent workflow for screenshot analysis and code generation`
    );
  }

  try {
    // 保存当前用户提示到对话上下文
    updateConversationContext("lastUserPrompt", promptStr);

    // 创建一个增强版的历史上下文，包含之前的代码摘要和用户请求摘要
    let enhancedHistoryContext = historyContext;
    if (conversationContext.lastCodeGenerated) {
      enhancedHistoryContext += `\n\n上次生成的代码摘要: ${conversationContext.lastCodeGenerated}`;
    }
    if (
      conversationContext.lastUserPrompt &&
      conversationContext.lastUserPrompt !== promptStr
    ) {
      enhancedHistoryContext += `\n\n上次用户请求: ${conversationContext.lastUserPrompt}`;
    }

    // 添加有关场景状态的上下文信息
    if (sceneState && sceneState.length > 0) {
      enhancedHistoryContext += `\n\n当前场景包含 ${sceneState.length} 个对象。这是已经存在的场景，你必须保留并在此基础上进行修改，不要重新创建整个场景。`;
    }

    // 添加有关截图分析的上下文信息(如果有)
    if (screenshot && renderingComplete === true) {
      enhancedHistoryContext +=
        "\n\n场景截图已提供，你必须首先使用analyze_screenshot工具分析当前场景是否符合需求，然后根据分析结果决定下一步行动。" +
        "调用analyze_screenshot工具时，必须使用完整的screenshot参数，切勿替换或修改。" +
        "场景渲染完成后，需要使用write_to_chroma工具将场景中的对象完整保存，确保包含几何体、材质和变换信息。";
    }

    // 确保lintErrors是一个数组
    const safeLintErrors = Array.isArray(lintErrors) ? lintErrors : [];

    // 创建 agent
    const agent = await createAgent(promptStr, currentCode, tools, {
      lintErrors: safeLintErrors,
      historyContext: enhancedHistoryContext, // 使用增强版历史上下文
      modelHistory,
      sceneState,
      sceneHistory,
    });

    // 创建回调处理器
    const callbackHandler = createMemoryCallbackHandler(currentCode, promptStr);

    // 使用工厂函数创建执行器
    const executor = createAgentExecutor(agent, tools, MAX_ITERATIONS);

    // 添加回调处理器
    executor.callbacks = [callbackHandler];

    // 添加消息历史支持
    const executorWithMemory = new RunnableWithMessageHistory({
      runnable: executor,
      getMessageHistory,
      inputMessagesKey: "input",
      historyMessagesKey: "chat_history",
    });

    // 创建自定义工具重载，以确保正确传递截图数据
    const overriddenTools = tools;
    if (screenshot) {
      // 记录截图长度，用于调试
      console.log(
        `[${requestId}] [Screenshot Check] Preparing screenshot data for analyze_screenshot tool, ` +
          `length: ${screenshot.length} bytes`
      );

      // 为简化起见，我们在这里不创建新的覆盖工具，而是依赖正确的输入参数
    }

    // 准备系统指令，确保截图优先分析和场景保留，并添加增量更新指导
    let systemInstructions = "";

    if (screenshot && renderingComplete) {
      systemInstructions =
        "你必须按照增量更新流程工作：\n" +
        "步骤1: 调用analyze_screenshot工具分析当前场景\n" +
        "步骤2: 根据分析结果，生成改进代码（generate_fix_code）\n" +
        "步骤3: 使用apply_patch工具应用增量更新，而不是替换整个代码\n" +
        "步骤4: 使用write_to_chroma工具将场景中的对象保存到持久化存储中，确保包含完整的几何体、材质和变换信息";
    } else {
      systemInstructions =
        "按照增量更新流程工作，根据用户需求生成或优化Three.js代码。\n" +
        "在完成场景修改后，务必使用write_to_chroma工具将所有重要对象保存到持久化存储中，确保包含完整的几何体、材质和变换信息，以便未来可以准确重建这些对象。";
    }

    // 保持现有的agent执行和结果处理逻辑

    // 准备输入和会话配置
    const inputForAgent = {
      input: promptStr,
      suggestion: systemInstructions, // 使用明确的指令序列替代简单的suggestion
      currentCode,
      userPrompt: promptStr || "无特定需求",
      historyContext: enhancedHistoryContext || "", // 使用增强版历史上下文
      lintErrors: safeLintErrors || [],
      modelRequired: modelRequired === true,
      // 添加上下文信息
      conversationSummary: conversationContext.conversationSummary || "",
      // 添加截图相关信息，允许agent在循环中使用
      screenshotBase64: screenshot || "", // 直接使用正确的参数名称
      userRequirement: promptStr || "", // 为截图工具添加所需的参数
      renderingComplete: renderingComplete === true,
      // 添加场景状态信息
      sceneState: sceneState || [],
      sceneHistory: sceneHistory || "",
      // 添加自驱动模式标志
      selfDriven,
    };

    const memoryConfig = {
      configurable: {
        sessionId: "global_session",
        // 添加会话流水号以帮助追踪
        requestId: requestId,
      },
    };

    try {
      console.log(
        `[${requestId}] Invoking agent executor with LangChain.js 0.3 execution model`
      );

      // 执行 agent
      const result = await executorWithMemory.invoke(
        inputForAgent,
        memoryConfig
      );

      // 处理结果时确保使用增量更新
      const cleanedOutput = cleanCodeOutput(result.output);
      const modelInfo = extractModelUrls(cleanedOutput);

      // 保存本次交互到内存
      await saveInteractionToMemory(promptStr, cleanedOutput);

      // 如果有模型URL，保存到上下文
      if (modelInfo.modelUrls && modelInfo.modelUrls.length > 0) {
        updateConversationContext("lastModelUrls", modelInfo.modelUrls);
      }

      // 保存代码摘要到上下文
      updateConversationContext(
        "lastCodeGenerated",
        getCodeDigest(cleanedOutput)
      );

      // 返回结果
      if (res && typeof res.status === "function" && !res.writableEnded) {
        return res.status(200).json({
          directCode: cleanedOutput,
          suggestion,
          ...modelInfo,
        });
      }

      return cleanedOutput;
    } catch (agentError) {
      console.error(`[${requestId}] Agent execution failed:`, agentError);
      return currentCode;
    }
  } catch (error) {
    console.error(`[${requestId}] Error running agent loop:`, error);
    return currentCode;
  }
}

// 确保工具已初始化
ToolRegistry.getInstance();

export { clearSessionState };
