// lib/agents/agentFactory.ts
import { AzureChatOpenAI } from "@langchain/openai";
import {
  createOpenAIFunctionsAgent,
  AgentExecutor,
  AgentFinish,
  AgentAction,
} from "langchain/agents";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { CallbackManager } from "@langchain/core/callbacks/manager";
import { Tool } from "@langchain/core/tools";
import { Runnable } from "@langchain/core/runnables";
import { ChainValues } from "@langchain/core/utils/types";

// 导入提示词模块
import { createSystemPrompt } from "../prompts/systemPrompts";
import { createHumanPrompt } from "../prompts/humanPrompts";

// 导入内存管理功能
import {
  createMemoryCallbackHandler,
  initializeChromaDB,
} from "../memory/memoryManager";

// 导入工具
import { retrievalTool } from "../tools/retrievalTool";
import { writeChromaTool } from "../tools/writeChromaTool";

// 导入类型
import { LintError } from "../types/codeTypes";
import { SceneStateObject, ModelHistoryEntry } from "../types/sceneTypes";

/**
 * 创建 OpenAI 模型客户端实例
 * @returns 配置好的 ChatOpenAI 实例
 */
export function createModelClient(): AzureChatOpenAI {
  return new AzureChatOpenAI({
    modelName: "gpt-4.1",
    azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
    azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
    azureOpenAIApiVersion: "2024-12-01-preview",
    azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
  });
}

// 初始化 ChromaDB
initializeChromaDB().catch((error) => {
  console.error("[AgentFactory] Failed to initialize ChromaDB:", error);
});

/**
 * 创建 Agent 的工厂函数 - 使用 LangChain.js 0.3 API
 * 创建一个能够使用所有注册工具的通用 Agent
 *
 * @param userPrompt 用户需求
 * @param currentCode 当前代码
 * @param tools 要使用的工具数组
 * @param options 其他可选配置选项
 * @returns 创建好的 LangChain Agent 实例
 */
export async function createAgent(
  userPrompt: string,
  currentCode: string = "",
  tools: Tool[] = [],
  options: {
    lintErrors?: LintError[];
    historyContext?: string;
    modelHistory?: ModelHistoryEntry[];
    sceneState?: SceneStateObject[];
    sceneHistory?: string;
    useChromaDB?: boolean;
  } = {}
) {
  const {
    lintErrors = [],
    historyContext = "",
    modelHistory = [],
    sceneState = [],
    sceneHistory = "",
    useChromaDB = true,
  } = options;

  // 初始化 OpenAI 客户端
  const model = createModelClient();

  // 创建自定义回调处理器用于内存管理
  const callbackHandler = createMemoryCallbackHandler(currentCode, userPrompt);

  // 设置回调管理器
  const callbackManager = new CallbackManager();
  callbackManager.addHandler(callbackHandler);

  // 确保 ChromaDB 工具已添加
  if (useChromaDB) {
    const hasRetrievalTool = tools.some(
      (tool) => tool.name === retrievalTool.name
    );
    const hasWriteTool = tools.some(
      (tool) => tool.name === writeChromaTool.name
    );

    if (!hasRetrievalTool) {
      console.log("[AgentFactory] Adding retrieval tool for ChromaDB");
      tools.push(retrievalTool as unknown as Tool);
    }

    if (!hasWriteTool) {
      console.log("[AgentFactory] Adding write tool for ChromaDB");
      tools.push(writeChromaTool as unknown as Tool);
    }
  }

  // 确保apply_patch工具有正确的描述
  tools.forEach((tool) => {
    if (tool.name === "apply_patch") {
      tool.description =
        "应用unified diff格式的补丁到内存中保存的代码。可以提交两种格式：1) 包含完整代码，用于初始化：{ code: string } 2) 包含标准unified diff补丁：{ patch: string }。初次必须先提交完整代码，之后只需提交补丁文本即可增量更新。也可以使用 { getCode: true } 来获取当前缓存的代码。";
    }
  });

  // 添加 ChromaDB 相关提示到系统消息
  let enhancedHistoryContext = historyContext;
  if (useChromaDB) {
    enhancedHistoryContext +=
      "\n\n你可以使用retrieve_objects工具从ChromaDB中搜索和检索已存储的Three.js对象，" +
      "以便在新场景中重用这些对象。搜索可以基于对象的语义描述（如'红色立方体'）或对象ID（如'id:cube_1'）。" +
      "检索到对象后，你可以在新代码中引用它们的属性。每次生成新对象后，使用write_to_chroma工具将其保存到持久化存储。";
  }

  // 创建系统消息提示
  const systemMessage = createSystemPrompt(
    lintErrors,
    enhancedHistoryContext,
    false, // 是否需要模型生成 - 由 Agent 在运行时使用工具决定
    modelHistory,
    sceneState,
    sceneHistory
  );

  // 创建人类消息提示
  const humanPromptTemplate = createHumanPrompt(modelHistory, sceneState);

  // 创建提示模板，包含系统消息、人类消息和 Agent 工作区
  const promptTemplate = ChatPromptTemplate.fromMessages([
    systemMessage,
    humanPromptTemplate,
    new MessagesPlaceholder("agent_scratchpad"),
  ]);

  // 创建并返回 Agent
  const agent = await createOpenAIFunctionsAgent({
    llm: model,
    tools,
    prompt: promptTemplate,
  });

  return agent;
}

/**
 * 创建Agent执行器
 * @param agent Agent实例
 * @param tools 工具列表
 * @param maxIterations 最大迭代次数
 * @returns Agent执行器
 */
export function createAgentExecutor(
  agent: Runnable<ChainValues, AgentAction | AgentFinish>,
  tools: Tool[],
  maxIterations: number = 10
): AgentExecutor {
  return AgentExecutor.fromAgentAndTools({
    agent,
    tools,
    maxIterations,
    verbose: true,
    handleParsingErrors: true,
    returnIntermediateSteps: true,
  });
}
