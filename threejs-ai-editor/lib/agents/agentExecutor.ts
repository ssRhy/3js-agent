/* eslint-disable @typescript-eslint/no-unused-vars */
// lib/agents/agentExecutor.ts
import { AgentExecutor } from "langchain/agents";
import { RunnableWithMessageHistory } from "@langchain/core/runnables";
import { BaseChatMessageHistory } from "@langchain/core/chat_history";
import { Tool } from "langchain/tools";
import { NextApiResponse } from "next";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { ChatMessageHistory } from "langchain/stores/message/in_memory";

// 导入 agent 创建工厂
import { createAgent } from "./agentFactory";

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
  generateSessionId,
  initializeSessionHistory,
  validateModelUrlsInOutput,
  ModelHistoryEntry,
} from "../memory/memoryManager";

// 导入工具

// 导入类型
import { LintError } from "../types/codeTypes";
import { SceneStateObject } from "../types/sceneTypes";
import { analyzeScreenshotDirectly } from "@/pages/api/screenshotAnalyzer";

// 存储常量以提高可维护性
const MAX_ITERATIONS = 10; // agent 循环的默认最大迭代次数

// 会话历史存储
const sessionHistories: Record<string, BaseChatMessageHistory> = {};

/**
 * 本地封装获取消息历史功能，解决命名冲突
 */
function getMessageHistory(sessionId: string): BaseChatMessageHistory {
  return getMessageHistoryFromManager(sessionId);
}

/**
 * 运行 agent 优化循环
 * @param suggestion 来自截图分析的建议
 * @param currentCode 当前代码
 * @param tools 工具数组
 * @param maxIterations 最大迭代次数（默认为 MAX_ITERATIONS）
 * @param userPrompt 用户需求（默认为空字符串）
 * @param historyContext 历史上下文（默认为空字符串）
 * @param lintErrors ESLint 错误（可选）
 * @param modelRequired 是否需要 3D 模型生成（可选）
 * @param sceneState 当前场景状态（可选）
 * @param modelHistory 模型历史记录（可选）
 * @param sceneHistory 场景历史记录（可选）
 * @param res 响应对象（可选，用于直接处理响应）
 * @param providedSessionId 提供的会话ID（可选）
 * @returns 优化的代码或者 void，如果响应直接处理
 */
export async function runAgentLoop(
  suggestion: string,
  currentCode: string,
  tools: Tool[],
  maxIterations = MAX_ITERATIONS,
  userPrompt: string = "",
  historyContext: string = "",
  lintErrors?: LintError[],
  modelRequired?: boolean,
  sceneState?: SceneStateObject[],
  modelHistory?: ModelHistoryEntry[],
  sceneHistory?: string,
  res?: NextApiResponse,
  providedSessionId?: string
): Promise<string | void> {
  // 使用提供的会话ID或为当前会话生成唯一的会话ID
  const sessionId = providedSessionId || generateSessionId(userPrompt);

  // 如果提供了会话ID并且想要重置会话状态，请先清除
  if (providedSessionId && userPrompt.toLowerCase().includes("重置")) {
    console.log(`[${sessionId}] Resetting session state based on user request`);
    clearSessionState(providedSessionId);
  }

  console.log(
    `[${sessionId}] Starting agent loop for: "${userPrompt.substring(
      0,
      50
    )}..."`
  );
  console.log(
    `[${sessionId}] Current code length: ${currentCode.length}, Suggestion length: ${suggestion.length}`
  );

  // 日志状态信息
  if (modelHistory?.length) {
    console.log(
      `[${sessionId}] Model history available: ${modelHistory.length} models`
    );
  }
  if (sceneState?.length) {
    console.log(
      `[${sessionId}] Scene state available: ${sceneState.length} objects`
    );
  }

  try {
    // 创建 agent
    console.log(`[${sessionId}] Creating agent with ${tools.length} tools`);
    const agent = await createAgent(
      currentCode,
      userPrompt,
      lintErrors,
      historyContext,
      modelRequired,
      modelHistory,
      sceneState,
      sceneHistory,
      tools
    );

    // 创建回调处理器，用于内存管理和日志记录
    const callbackHandler = createMemoryCallbackHandler(
      currentCode,
      userPrompt
    );

    // 创建执行器
    console.log(
      `[${sessionId}] Creating agent executor with ${
        tools.length
      } tools: ${tools.map((t) => t.name).join(", ")}`
    );

    const executor = AgentExecutor.fromAgentAndTools({
      agent,
      tools,
      maxIterations,
      verbose: true,
      handleParsingErrors: true,
      returnIntermediateSteps: true,
      callbacks: [callbackHandler],
    });

    // 使用 RunnableWithMessageHistory 包装 executor
    console.log(`[${sessionId}] Setting up message history for session`);
    const executorWithMemory = new RunnableWithMessageHistory({
      runnable: executor,
      getMessageHistory: () => getMessageHistory(sessionId),
      inputMessagesKey: "input",
      historyMessagesKey: "chat_history",
    });

    // 为调用准备配置
    const memoryConfig = {
      configurable: {
        sessionId: sessionId,
      },
    };

    // 准备输入对象
    const inputForAgent = {
      input: userPrompt,
      suggestion,
      currentCode,
      userPrompt: userPrompt || "无特定需求",
      historyContext: historyContext || "",
      lintErrors: lintErrors || [],
    };

    try {
      // 初始化会话历史，添加模型历史内容
      console.log(`[${sessionId}] Initializing session history`);
      await initializeSessionHistory(sessionId, modelHistory);

      // 执行带记忆功能的 Agent
      console.log(`[${sessionId}] Executing agent with memory`);
      const result = await executorWithMemory.invoke(
        inputForAgent,
        memoryConfig
      );

      // 清理并处理输出
      console.log(`[${sessionId}] Cleaning and processing agent output`);
      const cleanedOutput = cleanCodeOutput(result.output);

      // 检查输出是否包含所有模型 URL
      await validateModelUrlsInOutput(cleanedOutput, modelHistory, sessionId);

      // 提取模型 URL
      const modelInfo = extractModelUrls(cleanedOutput);
      console.log(
        `[${sessionId}] Extracted model URLs: ${
          modelInfo.modelUrls?.length || 0
        }`
      );

      // 如果提供了响应对象，则直接处理响应
      if (res) {
        console.log(
          `[${sessionId}] Sending response directly via provided response object`
        );
        return res.status(200).json({
          directCode: cleanedOutput,
          suggestion,
          ...modelInfo,
        });
      }

      console.log(`[${sessionId}] Agent loop completed successfully`);
      return cleanedOutput;
    } catch (agentError) {
      // 当 agent 失败时回退到直接改进
      console.error(`[${sessionId}] Agent execution failed:`, agentError);
      return handleAgentFailure(
        agentError as Error,
        suggestion,
        currentCode,
        userPrompt,
        sessionId
      );
    }
  } catch (error) {
    console.error(`[${sessionId}] Error running agent loop:`, error);
    return currentCode; // 出错时返回原始代码
  }
}

/**
 * 处理 agent 执行失败情况
 * @param error 发生的错误
 * @param suggestion 原始建议
 * @param currentCode 当前代码
 * @param userPrompt 用户需求
 * @param sessionId 会话 ID
 * @param res 响应对象（可选）
 * @returns 回退代码或者 void，如果响应直接处理
 */
async function handleAgentFailure(
  error: Error,
  suggestion: string,
  currentCode: string,
  userPrompt: string,
  sessionId: string
) {
  console.error(`[${sessionId}] Agent execution error:`, error);
  console.log(`[${sessionId}] Falling back to direct code improvement...`);
}

/**
 * 运行完整的优化流程，包括截图分析和代码优化
 * @param screenshot 屏幕截图的 base64 编码
 * @param currentCode 当前代码
 * @param tools 工具数组
 * @param userPrompt 用户需求
 * @param lintErrors lint 错误（可选）
 * @param options 选项对象，包含 modelRequired 和 sceneState 等
 * @param res 响应对象（可选）
 * @returns 优化的代码或 void（如果响应直接处理）
 */
export async function runCompleteOptimizationFlow(
  screenshot: string,
  currentCode: string,
  tools: Tool[],
  userPrompt: string = "",
  lintErrors?: LintError[],
  options: {
    modelRequired?: boolean;
    sceneState?: SceneStateObject[];
    sceneHistory?: string;
    sessionId?: string;
  } = {},
  res?: NextApiResponse
): Promise<string | void> {
  const { modelRequired, sceneState, sceneHistory, sessionId } = options;

  // 生成唯一的流程 ID
  const flowId =
    sessionId ||
    `flow_${Date.now()}_${userPrompt.slice(0, 10).replace(/\s+/g, "_")}`;

  console.log(`[${flowId}] Starting complete optimization flow`);

  try {
    // 1. 分析截图
    console.log(`[${flowId}] Analyzing screenshot...`);
    const suggestion = await analyzeScreenshotDirectly(
      screenshot,
      currentCode,
      userPrompt
    );
    console.log(
      `[${flowId}] Screenshot analysis complete. Suggestion length: ${suggestion.length}`
    );

    // 2. 加载存储的上下文数据
    console.log(`[${flowId}] Loading context data...`);
    const historyContext = await prepareHistoryContext();
    const loadedSceneHistory =
      sceneHistory || (await loadSceneHistoryFromMemory());
    const modelHistory = await loadModelHistoryFromMemory();

    // 3. 保存场景状态（如果提供）
    if (sceneState && sceneState.length > 0) {
      console.log(
        `[${flowId}] Saving scene state with ${sceneState.length} objects`
      );
      await saveSceneStateToMemory(userPrompt || "", sceneState);
    }

    // 4. 运行 agent 循环
    console.log(`[${flowId}] Starting agent loop with optimized context`);
    return await runAgentLoop(
      suggestion,
      currentCode,
      tools,
      MAX_ITERATIONS,
      userPrompt,
      historyContext,
      lintErrors,
      modelRequired,
      sceneState,
      modelHistory,
      loadedSceneHistory,
      res,
      sessionId
    );
  } catch (error) {
    console.error(`[${flowId}] Complete optimization flow failed:`, error);
    throw error;
  }
}
export { clearSessionState };

/**
 * 获取会话历史管理器
 * @param sessionId 会话ID
 * @returns 会话历史实例
 */
function getMessageHistoryFromManager(
  sessionId: string
): BaseChatMessageHistory {
  if (!sessionHistories[sessionId]) {
    // 创建一个新的会话历史实例
    sessionHistories[sessionId] = new ChatMessageHistory();
    console.log(`[${sessionId}] Created new chat history instance`);
  } else {
    console.log(`[${sessionId}] Using existing chat history instance`);
  }
  return sessionHistories[sessionId];
}
