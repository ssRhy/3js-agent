/* eslint-disable @typescript-eslint/no-unused-vars */
// lib/agents/agentExecutor.ts
import { AgentExecutor } from "langchain/agents";
import { RunnableWithMessageHistory } from "@langchain/core/runnables";
import { BaseChatMessageHistory } from "@langchain/core/chat_history";
import { Tool } from "langchain/tools";
import { NextApiResponse } from "next";
import { ChatMessageHistory } from "langchain/stores/message/in_memory";
import { BufferWindowMemory } from "langchain/memory";

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

// 将screenshotTool转为Tool类型
const screenshotToolInstance = screenshotTool as unknown as Tool;

// 导入类型
import { LintError } from "../types/codeTypes";
import { SceneStateObject } from "../types/sceneTypes";

// 存储常量
const MAX_ITERATIONS = 10;

// 全局会话历史 - 通过ChatMessageHistory保持多轮对话的连贯性
const sessionHistory = new ChatMessageHistory();

// 全局对话上下文管理器 - 用于存储重要的对话上下文信息
const conversationContext = {
  lastUserPrompt: "",
  lastCodeGenerated: "",
  lastModelUrls: [] as { url: string; name: string }[],
  conversationSummary: "",
};

/**
 * 获取消息历史
 */
function getMessageHistory(): BaseChatMessageHistory {
  return sessionHistory;
}

/**
 * 更新对话上下文
 * @param key 上下文键
 * @param value 上下文值
 */
function updateConversationContext(
  key: keyof typeof conversationContext,
  value: unknown
): void {
  (conversationContext as Record<string, unknown>)[key] = value;
  console.log(`[Context] Updated "${key}" in conversation context`);
}

/**
 * 安全地获取字符串值
 * @param value 任意值
 * @returns 字符串值
 */
function safeString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

/**
 * 保存用户交互到内存，增强对话连贯性
 * @param userPrompt 用户提示
 * @param agentResponse 代理响应
 */
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
 * 执行交互流程
 * 按照项目规定的流程：
 * 1. 用户输入自然语言提示
 * 2. AI代理分析请求并选择适当工具
 * 3. 生成3D模型（如果需要）
 * 4. 生成修改代码
 * 5. 截图检查场景并返回建议
 * 6. 接收建议然后修改代码
 * 7. 更新场景并实时渲染结果
 */
export async function runInteractionFlow(
  userPrompt: string | Record<string, unknown>,
  currentCode: string,
  screenshot: string,
  lintErrors?: LintError[],
  options: {
    modelRequired?: boolean;
    sceneState?: SceneStateObject[];
    modelSize?: number;
    renderingComplete?: boolean;
  } = {},
  res?: NextApiResponse
): Promise<string | void> {
  const { modelRequired, sceneState, modelSize, renderingComplete } = options;
  const flowId = `flow_${Date.now()}`;
  const promptStr = safeString(userPrompt);

  // 确保lintErrors是一个数组
  const safeLintErrors = Array.isArray(lintErrors) ? lintErrors : [];

  console.log(
    `[${flowId}] Starting interaction flow for: "${promptStr.substring(
      0,
      50
    )}..."${renderingComplete ? " (rendering complete)" : ""}`
  );

  try {
    // 1. 加载上下文数据
    const historyContext = await prepareHistoryContext();
    const modelHistory = await loadModelHistoryFromMemory();
    const sceneHistory = await loadSceneHistoryFromMemory();

    // 保存场景状态（如果提供）
    if (sceneState && sceneState.length > 0) {
      await saveSceneStateToMemory(promptStr, sceneState);
    }

    // 2. 分析用户需求，检测是否需要生成模型
    const needsModelGeneration =
      modelRequired === true ||
      promptStr.toLowerCase().includes("模型") ||
      promptStr.toLowerCase().includes("model") ||
      promptStr.toLowerCase().includes("生成") ||
      promptStr.toLowerCase().includes("generate");

    // 3. 生成模型（如果需要）
    let modelUrls: { url: string; name: string }[] = [];
    if (needsModelGeneration) {
      console.log(`[${flowId}] Generating 3D model based on user prompt`);
      try {
        const modelResult = await modelGenTool.invoke({
          prompt: promptStr,
          meshMode: "Quad",
          quality: "medium",
        });

        if (typeof modelResult === "string") {
          const parsedResult = JSON.parse(modelResult);
          if (parsedResult.modelUrls && Array.isArray(parsedResult.modelUrls)) {
            modelUrls = parsedResult.modelUrls.map(
              (url: string | { url: string; name: string }) => {
                if (typeof url === "string") {
                  return { url, name: `model_${Date.now()}` };
                }
                return url;
              }
            );
            console.log(
              `[${flowId}] Generated model URLs: ${modelUrls
                .map((m) => m.url)
                .join(", ")}`
            );
          }
        }
      } catch (modelError) {
        console.error(`[${flowId}] Model generation failed:`, modelError);
      }
    }

    // 4. 生成/修改代码
    console.log(`[${flowId}] Generating/modifying Three.js code`);
    let improvedCode = currentCode;

    // 准备代码生成指令
    let codeInstruction = promptStr;
    if (modelSize) {
      codeInstruction += ` (注意：模型大小应为 ${modelSize} 单位，使用 autoScaleModel 函数)`;
    }
    if (modelUrls.length > 0) {
      codeInstruction += ` (使用以下模型: ${modelUrls
        .map((m) => m.url)
        .join(", ")})`;
    }

    try {
      const codeResult = await codeGenTool.invoke({
        instruction: codeInstruction,
      });

      if (typeof codeResult === "string") {
        try {
          const parsedResult = JSON.parse(codeResult);
          if (parsedResult.code) {
            improvedCode = parsedResult.code;
          }
        } catch {
          // 如果结果不是JSON格式，可能是直接返回的代码字符串
          if (codeResult.includes("function setup")) {
            improvedCode = codeResult;
          }
        }
      }
      console.log(
        `[${flowId}] Generated initial code, length: ${improvedCode.length}`
      );
    } catch (codeError) {
      console.error(`[${flowId}] Initial code generation failed:`, codeError);
    }

    // 5. 分析截图，提供改进建议 (只在渲染完成后进行)
    if (screenshot && renderingComplete === true) {
      console.log(
        `[${flowId}] Analyzing screenshot to get suggestions (rendering is complete)`
      );
      try {
        const screenshotResult = await screenshotTool.invoke({
          screenshotBase64: screenshot,
          userRequirement: promptStr,
        });

        const analysisResult = JSON.parse(screenshotResult);
        const suggestion = analysisResult.analysis || "无法分析截图";
        const needsImprovements = analysisResult.needs_improvements === true;

        console.log(
          `[${flowId}] Screenshot analysis: needs improvements = ${needsImprovements}`
        );

        // 6. 基于截图分析改进代码（如果需要）
        if (needsImprovements) {
          console.log(
            `[${flowId}] Improving code based on screenshot analysis`
          );
          try {
            const improvedResult = await codeGenTool.invoke({
              instruction: `基于以下分析改进Three.js代码：${suggestion}\n\n当前代码：${improvedCode.substring(
                0,
                500
              )}${improvedCode.length > 500 ? "...(代码过长已截断)" : ""}`,
            });

            if (typeof improvedResult === "string") {
              try {
                const parsedResult = JSON.parse(improvedResult);
                if (parsedResult.code) {
                  improvedCode = parsedResult.code;
                  console.log(
                    `[${flowId}] Code improved based on screenshot analysis`
                  );
                }
              } catch {
                // 如果结果不是JSON格式，可能是直接返回的代码字符串
                if (improvedResult.includes("function setup")) {
                  improvedCode = improvedResult;
                  console.log(
                    `[${flowId}] Code improved based on screenshot analysis`
                  );
                }
              }
            }
          } catch (improvementError) {
            console.error(
              `[${flowId}] Code improvement based on screenshot failed:`,
              improvementError
            );
          }
        }
      } catch (analysisError) {
        console.error(`[${flowId}] Screenshot analysis failed:`, analysisError);
      }
    } else if (screenshot) {
      console.log(
        `[${flowId}] Skipping screenshot analysis as rendering is not complete yet`
      );
    }

    // 7. 使用Agent完成最终优化（如果需要）
    if (safeLintErrors && safeLintErrors.length > 0) {
      console.log(
        `[${flowId}] Running final agent optimization for lint errors`
      );
      // 获取所有工具
      const registry = ToolRegistry.getInstance();
      const tools = registry.getAllTools();

      // 如果需要模型生成，优先使用模型工具
      let optimizedTools = tools;
      if (needsModelGeneration) {
        const modelTools = registry.getToolsByCategory(ToolCategory.MODEL);
        const codeTools = registry.getToolsByCategory(ToolCategory.CODE);
        const utilityTools = registry.getToolsByCategory(ToolCategory.UTILITY);
        optimizedTools = [...modelTools, ...codeTools, ...utilityTools];
      }

      try {
        // 运行完整的Agent优化循环
        const agentResult = await runAgentLoop(
          "请修复代码中的语法错误",
          improvedCode,
          optimizedTools,
          promptStr,
          historyContext,
          safeLintErrors,
          needsModelGeneration,
          sceneState,
          modelHistory,
          sceneHistory,
          undefined,
          undefined,
          undefined
        );

        if (agentResult && typeof agentResult === "string") {
          improvedCode = agentResult;
          console.log(`[${flowId}] Code optimized by agent`);
        }
      } catch (agentError) {
        console.error(`[${flowId}] Agent optimization failed:`, agentError);
      }
    }

    // 8. 提取模型URL信息（如果有）用于响应
    const extractedModelInfo = extractModelUrls(improvedCode);
    // 合并手动生成和代码中的模型URL
    if (modelUrls.length > 0) {
      if (!extractedModelInfo.modelUrls) {
        extractedModelInfo.modelUrls = [];
      }

      // 确保所有 URL 都是正确格式
      modelUrls.forEach((model) => {
        if (!extractedModelInfo.modelUrls!.some((m) => m.url === model.url)) {
          extractedModelInfo.modelUrls!.push(model);
        }
      });
    }

    // 9. 返回结果
    console.log(`[${flowId}] Interaction flow completed successfully`);
    if (res && typeof res.status === "function") {
      return res.status(200).json({
        directCode: improvedCode,
        ...extractedModelInfo,
      });
    }

    return improvedCode;
  } catch (error) {
    console.error(`[${flowId}] Interaction flow failed:`, error);
    if (res && typeof res.status === "function") {
      return res.status(500).json({ error: "处理失败", details: error });
    }
    throw error;
  }
}

/**
 * 运行 agent 循环 - 用于复杂场景的代码优化
 * 增强版本：添加了更强大的内存管理和对话连贯性支持
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
  renderingComplete?: boolean
): Promise<string | void> {
  const requestId = `req_${Date.now()}`;
  const promptStr = safeString(userPrompt);

  console.log(
    `[${requestId}] Starting agent loop: "${promptStr.substring(0, 50)}..."`
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

    // 添加有关截图分析的上下文信息(如果有)
    if (screenshot && renderingComplete === true) {
      enhancedHistoryContext +=
        "\n\n场景截图已提供，你可以使用analyze_screenshot工具分析当前场景是否符合需求。";
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

    // 准备输入和会话配置
    const inputForAgent = {
      input: promptStr,
      suggestion,
      currentCode,
      userPrompt: promptStr || "无特定需求",
      historyContext: enhancedHistoryContext || "", // 使用增强版历史上下文
      lintErrors: safeLintErrors || [],
      modelRequired: modelRequired === true,
      // 添加上下文信息
      conversationSummary: conversationContext.conversationSummary || "",
      // 添加截图相关信息，允许agent在循环中使用
      screenshot: screenshot || "",
      renderingComplete: renderingComplete === true,
    };

    const memoryConfig = {
      configurable: {
        sessionId: "global_session",
        // 添加会话流水号以帮助追踪
        requestId: requestId,
      },
    };

    try {
      // 执行 agent
      const result = await executorWithMemory.invoke(
        inputForAgent,
        memoryConfig
      );

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
      if (res && typeof res.status === "function") {
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
}

/**
 * 运行完整优化流程 - 包括截图分析和代码生成
 * 现在改为直接调用runAgentLoop以便在agent循环中使用截图分析
 */
export async function runCompleteOptimizationFlow(
  screenshot: string,
  code: string,
  tools: Tool[],
  prompt?: string | Record<string, unknown>,
  lintErrors?: LintError[],
  options: {
    modelRequired?: boolean;
    sceneState?: SceneStateObject[];
    sceneHistory?: string;
    modelSize?: number;
    renderingComplete?: boolean;
  } = {},
  res?: NextApiResponse
): Promise<string | void> {
  console.log(
    `[Legacy] Using runCompleteOptimizationFlow, consider switching to runInteractionFlow`
  );

  // 获取必要数据
  const { modelRequired, sceneState, sceneHistory, renderingComplete } =
    options;

  // 准备上下文数据
  const historyContext = await prepareHistoryContext();
  const modelHistory = await loadModelHistoryFromMemory();

  // 确保lintErrors是一个数组
  const safeLintErrors = Array.isArray(lintErrors) ? lintErrors : [];

  // 使用agent循环处理，将screenshot直接传递给agent
  return runAgentLoop(
    "根据用户需求和截图分析生成Three.js代码", // 初始建议
    code,
    tools,
    prompt || "",
    historyContext,
    safeLintErrors,
    modelRequired,
    sceneState,
    modelHistory,
    sceneHistory,
    res,
    screenshot, // 传递截图
    renderingComplete // 传递渲染状态
  );
}

// 确保工具已初始化
ToolRegistry.getInstance();

export { clearSessionState };
