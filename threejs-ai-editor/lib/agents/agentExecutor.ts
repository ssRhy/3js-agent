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
import { BufferWindowMemory } from "langchain/memory";
import { Socket } from "socket.io";

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

// 导入Socket.IO截图请求函数，用于Agent自主请求截图
import { requestScreenshot } from "../../pages/api/socket";

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
  lastScreenshotTimestamp?: number; // 添加上次截图时间戳
} = {};

// 存储Socket.IO实例
let socketIO: Socket | null = null;

/**
 * 设置Socket.IO实例，用于Agent自主发起截图请求
 * @param socket Socket.IO实例
 */
export function setSocketIOInstance(socket: Socket) {
  socketIO = socket;
  console.log("[Agent] Socket.IO instance set for Agent use");
}

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
    case "lastScreenshotTimestamp":
      conversationContext[key] = value as number;
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
 * 判断当前是否应该请求新的屏幕截图
 * @param screenshot 已有的截图数据（如果有）
 * @param lastRequestTime 上次请求截图的时间戳
 * @returns 是否应该请求新截图
 */
function shouldRequestNewScreenshot(
  screenshot?: string,
  lastRequestTime: number = 0
): boolean {
  // 如果没有截图数据，可能需要请求
  if (
    !screenshot ||
    screenshot === "<screenshot>" ||
    (screenshot && screenshot.length < 100)
  ) {
    // 检查是否足够长时间未请求截图（至少30秒）
    const now = Date.now();
    if (lastRequestTime === 0 || now - lastRequestTime > 30000) {
      return true;
    }
  }
  return false;
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

  // 状态标记
  let needScreenshotAnalysis = false;
  let needDirectCodeFix = false;
  let userRequestsModel = false;

  // 分析用户意图
  console.log(
    `[${requestId}] Analyzing user prompt: "${userPrompt.substring(0, 100)}${
      userPrompt.length > 100 ? "..." : ""
    }"`
  );

  // 1. 检测意图 - 是否想生成或修改3D模型
  const modelIntentRegex =
    /(?:create|generate|add|make|build|design|place|add)\s+(?:a|an|the)?\s*(?:3[dD]|3-D|three[- ]dimensional|new)\s*(?:model|object|shape|mesh|figure|statue|structure)/i;
  userRequestsModel = modelIntentRegex.test(userPrompt);

  // 2. 检测是否需要分析截图 (如果给出了截图或分析)
  // 对于用户点击"生成"按钮的情况，我们始终需要分析截图（前端会发送截图数据）
  needScreenshotAnalysis = Boolean(screenshot || screenshotAnalysis);

  // 3. 检测是否需要代码修复 (如果提供了错误信息)
  needDirectCodeFix = Boolean(lintErrors && lintErrors.length > 0);

  // 如果我们有场景状态，保存到内存
  if (sceneState && sceneState.length > 0) {
    await saveSceneStateToMemory(sceneState);
    updateConversationContext("lastSceneState", sceneState);
  }

  // 初始化结果对象
  const result: Record<string, unknown> = {
    status: "success",
  };

  try {
    // 获取上下文历史
    const historyContext = await prepareHistoryContext();
    console.log(
      `[${requestId}] Prepared history context: ${historyContext.substring(
        0,
        100
      )}...`
    );

    // 步骤1: 如果需要，分析截图 (用户请求截图分析或提供了截图)
    let analysisDetails: Record<string, unknown> | null = null;

    if (needScreenshotAnalysis) {
      if (screenshotAnalysis) {
        console.log(`[${requestId}] Using pre-analyzed screenshot results`);
        analysisDetails = screenshotAnalysis;
      } else if (screenshot) {
        console.log(`[${requestId}] Analyzing provided screenshot`);
        // 使用screenshotTool分析截图
        try {
          const analysisResult = await screenshotTool.func({
            screenshotBase64: screenshot,
            userRequirement: userPrompt,
          });

          // Parse JSON结果
          analysisDetails = JSON.parse(analysisResult);
          console.log(
            `[${requestId}] Screenshot analysis complete: ${analysisDetails?.status}, matches_requirements: ${analysisDetails?.matches_requirements}`
          );

          // 将分析结果添加到最终输出
          result.analysisDetails = analysisDetails;
        } catch (analysisError) {
          console.error(
            `[${requestId}] Screenshot analysis failed:`,
            analysisError
          );
          result.analysisError =
            analysisError instanceof Error
              ? analysisError.message
              : String(analysisError);
        }
      }
    }

    // 步骤2: 根据分析结果或用户请求决定操作路径
    // A. 生成3D模型
    if (userRequestsModel) {
      console.log(`[${requestId}] User requests model generation`);

      // 加载场景历史，用于提供上下文
      const modelHistory = await loadModelHistoryFromMemory();
      const sceneHistoryFormatted = JSON.stringify(sceneHistory || {});

      // 配置工具集 - 特别是模型生成工具
      const toolsToUse = [];
      const modelGenTool = ToolRegistry.getInstance().getTool(
        ToolCategory.MODEL_GEN
      );
      const searchTool = ToolRegistry.getInstance().getTool(
        ToolCategory.SEARCH
      );

      if (modelGenTool) toolsToUse.push(modelGenTool);
      if (searchTool) toolsToUse.push(searchTool);

      // 如果我们要自驱动跟踪模型生成后的视觉结果，添加截图工具
      if (renderingComplete) {
        toolsToUse.push(screenshotToolInstance);
      }

      // 执行代理
      const modelResponse = await runAgentLoop(
        "Generate 3D model based on user request",
        currentCode,
        toolsToUse,
        userPrompt,
        historyContext,
        lintErrors,
        true, // modelRequired 标志为true
        sceneState,
        modelHistory,
        sceneHistoryFormatted,
        undefined, // no response object
        screenshot,
        renderingComplete,
        true // 启用自驱动模式
      );

      // 处理结果
      const extractedUrls = extractModelUrls(modelResponse || "");

      if (
        extractedUrls &&
        Array.isArray(extractedUrls) &&
        extractedUrls.length > 0
      ) {
        result.modelUrls = extractedUrls;
        result.directResponse = `Generated ${extractedUrls.length} model(s) based on your request.`;

        // 更新对话上下文
        updateConversationContext("lastModelUrls", extractedUrls);
      } else {
        result.directResponse = modelResponse;
      }
    }
    // B. 修复代码或优化场景
    else {
      console.log(
        `[${requestId}] ${
          needDirectCodeFix ? "Fixing code errors" : "Optimizing Three.js scene"
        }`
      );

      // 配置工具集
      const toolsToUse = [];
      const codeGenTool = ToolRegistry.getInstance().getTool(
        ToolCategory.CODE_GEN
      );
      const searchTool = ToolRegistry.getInstance().getTool(
        ToolCategory.SEARCH
      );

      if (codeGenTool) toolsToUse.push(codeGenTool);
      if (searchTool) toolsToUse.push(searchTool);

      // 如果需要自驱动查看修改后的结果，添加截图工具
      if (renderingComplete) {
        toolsToUse.push(screenshotToolInstance);
      }

      // 处理截图分析结果
      if (screenshotAnalysis) {
        // 将结果添加到返回对象
        result.screenshotAnalysis = screenshotAnalysis;
        // 提取详细分析结果用于后续处理
        analysisDetails = screenshotAnalysis || null;
      }

      // 准备运行输入
      const suggestion = needDirectCodeFix
        ? "Fix the lint errors in the code"
        : analysisDetails &&
          analysisDetails.matches_requirements === false &&
          analysisDetails.recommendation
        ? `Improve the Three.js code to satisfy user's request. The current scene doesn't match requirements: ${analysisDetails.recommendation}`
        : "Optimize the Three.js code based on user's request";

      // 加载场景历史
      const sceneHistoryFormatted = JSON.stringify(sceneHistory || {});

      // 执行代理
      const codeResponse = await runAgentLoop(
        suggestion,
        currentCode,
        toolsToUse,
        userPrompt,
        historyContext,
        lintErrors,
        false, // 不需要模型
        sceneState,
        undefined, // 不需要模型历史
        sceneHistoryFormatted,
        undefined, // 不需要响应对象
        screenshot,
        renderingComplete,
        // 对于用户手动请求，禁用自驱动模式，避免agent自动请求多余的截图
        false // 禁用自驱动模式，因为这是用户手动请求的分析
      );

      // 处理结果
      const cleanedCode = cleanCodeOutput(codeResponse || "");
      result.directCode = cleanedCode;

      // 提取补充说明
      const explanationRegex = /\/\*\*\s*EXPLANATION:([\s\S]*?)\*\*\//;
      const explanationMatch = codeResponse?.match(explanationRegex);

      if (explanationMatch && explanationMatch[1]) {
        result.explanation = explanationMatch[1].trim();
      }

      // 更新对话上下文
      updateConversationContext("lastCodeGenerated", cleanedCode);
    }

    // 保存交互到内存
    const responseMessage = result.directResponse || result.directCode || "";
    await saveInteractionToMemory(userPrompt, responseMessage.toString());

    return result;
  } catch (flowError) {
    console.error(`[${requestId}] Interaction flow error:`, flowError);
    return {
      status: "error",
      message: `处理请求时发生错误: ${
        flowError instanceof Error ? flowError.message : String(flowError)
      }`,
      ...result, // 保留已处理的任何中间结果
    };
  }
}

/**
 * 运行代理循环
 * 负责实际推理、工具使用和详细任务执行
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
  // 为这个请求创建唯一ID
  const requestId = `agent_${Date.now()}`;
  // 转换用户提示为字符串
  const promptStr =
    typeof userPrompt === "string" ? userPrompt : JSON.stringify(userPrompt);

  console.log(
    `[${requestId}] Starting agent loop with prompt: ${
      promptStr.substring(0, 30) + "..."
    }`
  );

  try {
    // 检查是否需要请求新的截图
    if (
      renderingComplete &&
      (!screenshot ||
        screenshot === "<screenshot>" ||
        screenshot.length < 100) &&
      shouldRequestNewScreenshot(
        screenshot,
        conversationContext.lastScreenshotTimestamp
      )
    ) {
      console.log(
        `[${requestId}] No valid screenshot provided but rendering complete, requesting via WebSocket`
      );
      try {
        const wsRequestId = `agent_loop_${Date.now()}`;
        screenshot = await requestScreenshot(wsRequestId);

        // 更新最后截图时间戳
        updateConversationContext("lastScreenshotTimestamp", Date.now());

        if (screenshot && screenshot.length > 100) {
          console.log(
            `[${requestId}] Successfully obtained screenshot via WebSocket for agent reasoning`
          );
        } else {
          console.warn(
            `[${requestId}] Received empty or invalid screenshot data from WebSocket, continuing without screenshot analysis`
          );
          // Make sure we don't treat this as a valid screenshot
          screenshot = undefined;
        }
      } catch (wsError) {
        console.error(
          `[${requestId}] Failed to get screenshot via WebSocket: ${
            wsError instanceof Error ? wsError.message : String(wsError)
          }`
        );
        // Set screenshot to undefined to ensure agent knows there's no screenshot
        screenshot = undefined;
        // Continue execution, just without a screenshot
      }
    }

    // 使用工具注册表获取工具（如果未提供）
    if (!tools || tools.length === 0) {
      const registry = ToolRegistry.getInstance();
      tools = registry.getAllTools();
      console.log(`[${requestId}] Using ${tools.length} tools from registry`);
    }

    // 确保工具列表中包含截图分析工具
    const hasScreenshotTool = tools.some(
      (tool) => tool.name === screenshotTool.name
    );

    if (!hasScreenshotTool) {
      console.log(
        `[${requestId}] Adding screenshot analysis tool to agent tools`
      );
      tools.push(screenshotToolInstance);
    }

    // 检查截图数据的有效性
    if (screenshot) {
      console.log(
        `[${requestId}] [Agent] 📋 截图数据信息: 类型=${typeof screenshot}, ` +
          `大小=${screenshot ? screenshot.length : 0} 字符, ` +
          `格式=${
            screenshot && screenshot.startsWith("data:") ? "data:URL" : "其他"
          }`
      );

      // 确认截图数据有效
      if (
        !screenshot ||
        screenshot === "<screenshot>" ||
        screenshot.length < 100
      ) {
        console.warn(
          `[${requestId}] [Agent] ⚠️ 检测到无效截图数据, 将不使用截图分析流程`
        );
        // 如果截图无效，设置为undefined以避免后续错误
        screenshot = undefined;
        renderingComplete = false;
      }
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

      // 添加WebSocket主动截图能力的说明
      enhancedHistoryContext +=
        "\n\n你可以随时使用analyze_screenshot工具通过WebSocket请求获取前端当前场景的截图，" +
        "当你需要了解当前场景的视觉状态，或者需要验证代码修改效果时，可以主动调用此工具。";

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
      const callbackHandler = createMemoryCallbackHandler(
        currentCode,
        promptStr
      );

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

      // 准备系统指令，确保Agent知道如何使用WebSocket截图功能
      let systemInstructions =
        "你是一个能够主动获取场景信息的智能助手。你可以随时使用analyze_screenshot工具请求前端提供当前场景的截图，" +
        "并基于分析结果做出更好的代码修改决策。当你需要了解当前场景外观或验证修改效果时，调用此工具。" +
        "根据用户需求生成或优化Three.js代码。";

      // 如果有截图和渲染完成标志，添加特定指令
      if (screenshot && renderingComplete) {
        systemInstructions +=
          " 你必须首先分析截图，然后根据分析结果进行代码生成或修改。" +
          "步骤1: 调用analyze_screenshot工具分析当前场景。" +
          "步骤2: 根据分析结果，如果需要改进，则生成改进代码；如果不需要改进，则直接返回当前代码。";

        console.log(
          `[${requestId}] [Agent] 🖼️ 已启用截图驱动模式, 将要求Agent首先分析截图`
        );
      } else {
        console.log(
          `[${requestId}] [Agent] ℹ️ 标准模式，将根据用户需求生成代码`
        );
      }

      // 如果有场景状态，添加场景保留指令
      if (sceneState && sceneState.length > 0) {
        systemInstructions +=
          " 当前已有场景对象，您必须保留现有对象，并在其基础上添加或修改，而不是创建全新场景。";
        console.log(
          `[${requestId}] [Agent] 🏗️ 已添加场景保留指令，当前场景有 ${sceneState.length} 个对象`
        );
      }

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
        // 添加forceWebSocket标志，如果没有有效截图但处于自驱动模式
        forceWebSocket: selfDriven && (!screenshot || screenshot.length < 100),
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
          `[${requestId}] [Agent] 🚀 开始执行Agent，模式: ${
            selfDriven ? "自驱动" : "标准"
          }, 截图驱动: ${!!screenshot && renderingComplete ? "是" : "否"}`
        );

        // 执行 agent
        const result = await executorWithMemory.invoke(
          inputForAgent,
          memoryConfig
        );

        console.log(
          `[${requestId}] [Agent] ✅ Agent执行完成，输出长度: ${result.output.length} 字符`
        );

        if (screenshot && renderingComplete) {
          console.log(
            `[${requestId}] [Agent] 🔄 截图驱动流程已完成，检查输出是否包含代码生成内容`
          );
          const includesFixedCode = result.output.includes("function setup");
          console.log(
            `[${requestId}] [Agent] ${
              includesFixedCode
                ? "✅ 输出包含修复后的代码"
                : "ℹ️ 输出不包含新代码，可能截图分析结果表明不需要改进"
            }`
          );
        }

        // 处理结果
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
        return currentCode; // 出错时返回原始代码
      }
    } catch (error) {
      console.error(`[${requestId}] Error running agent loop:`, error);
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

/**
 * 启动基于Socket.IO的Agent循环
 * 该函数使Agent能够通过Socket.IO接口与前端交互，实现自主截图分析和代码修复
 *
 * @param socket Socket.IO连接实例
 */
export async function runAgentWithSocketIO(socket: Socket) {
  try {
    // 设置Socket.IO实例供所有工具使用
    setSocketIOInstance(socket);
    console.log(`[Agent-SocketIO] Socket instance registered: ${socket.id}`);
  } catch (initError) {
    console.error(
      "[Agent-SocketIO] Error during socket initialization:",
      initError
    );
  }

  // 设置事件监听器
  try {
    // 设置start_agent_session事件监听器
    socket.on("start_agent_session", async (data) => {
      try {
        console.log("[Agent-SocketIO] Starting new agent session", data);

        const { code, prompt, clientId } = data;

        if (!code || !prompt) {
          socket.emit("agent_error", {
            message: "Missing required parameters: code and prompt",
            timestamp: Date.now(),
            recoverable: true,
          });
          return;
        }

        // 创建一个带有所有工具的自驱动Agent
        const toolsToUse = [];
        const codeGenTool = ToolRegistry.getInstance().getTool(
          ToolCategory.CODE_GEN
        );
        const searchTool = ToolRegistry.getInstance().getTool(
          ToolCategory.SEARCH
        );

        if (codeGenTool) toolsToUse.push(codeGenTool);
        if (searchTool) toolsToUse.push(searchTool);
        toolsToUse.push(screenshotToolInstance);

        // 通知前端Agent开始执行
        socket.emit("agent_status", {
          status: "starting",
          message: "Agent is analyzing your request...",
          timestamp: Date.now(),
        });

        // 获取历史上下文
        const historyContext = await prepareHistoryContext();

        // 启动Agent循环，启用自驱动模式
        const response = await runAgentLoop(
          "Analyze user request and improve Three.js scene",
          code,
          toolsToUse,
          prompt,
          historyContext,
          undefined, // 无lint错误
          false, // 不需要模型
          undefined, // 无场景状态
          undefined, // 无模型历史
          undefined, // 无场景历史
          undefined, // 无响应对象
          undefined, // 无初始截图
          true, // 渲染完成
          true // 启用自驱动模式，允许Agent自主决策和请求截图
        );

        // 清理输出代码
        const cleanedCode = cleanCodeOutput(response || "");

        // 发送结果回前端
        socket.emit("agent_result", {
          status: "complete",
          directCode: cleanedCode,
          timestamp: Date.now(),
        });

        // 保存交互到内存
        await saveInteractionToMemory(prompt, response || "");
      } catch (sessionError) {
        console.error("[Agent-SocketIO] Error in agent session:", sessionError);
        socket.emit("agent_error", {
          message:
            sessionError instanceof Error
              ? sessionError.message
              : String(sessionError),
          timestamp: Date.now(),
          recoverable: true,
        });
      }
    });

    // 设置agent_request_screenshot事件监听器
    socket.on("agent_request_screenshot", async (data) => {
      console.log("[Agent-SocketIO] Agent requested screenshot:", data);

      try {
        // 确保请求有一个唯一ID
        const requestId = data.requestId || `agent_req_${Date.now()}`;

        // 直接使用当前socket发出截图请求，确保单播而非广播
        try {
          socket.emit("request_screenshot", {
            requestId,
            timestamp: Date.now(),
            fromAgent: true, // 标记这是来自agent的请求
          });

          // 通知agent已发送截图请求
          socket.emit("agent_status", {
            status: "requesting_screenshot",
            message: "请求前端提供场景截图...",
            timestamp: Date.now(),
          });

          console.log(`[Agent-SocketIO] Screenshot request ${requestId} sent`);
        } catch (socketError) {
          console.error(
            "[Agent-SocketIO] Error sending screenshot request:",
            socketError
          );

          // 通知agent截图请求失败但可以继续执行
          socket.emit("agent_status", {
            status: "screenshot_error",
            message: "截图请求失败，但Agent可以继续执行其他任务",
            error:
              socketError instanceof Error
                ? socketError.message
                : String(socketError),
            timestamp: Date.now(),
            recoverable: true,
          });
        }
      } catch (error) {
        console.error(
          "[Agent-SocketIO] Exception in screenshot request handler:",
          error
        );
      }
    });

    // 当Socket断开连接时清理
    socket.on("disconnect", () => {
      try {
        console.log("[Agent-SocketIO] Client disconnected, cleaning up");
      } catch (disconnectError) {
        console.error(
          "[Agent-SocketIO] Error during disconnect cleanup:",
          disconnectError
        );
      }
    });

    console.log(
      "[Agent-SocketIO] Agent ready for Socket.IO driven interactions"
    );
  } catch (setupError) {
    console.error(
      "[Agent-SocketIO] Critical error setting up Socket.IO handlers:",
      setupError
    );
  }
}
