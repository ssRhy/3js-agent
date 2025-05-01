// lib/agents/agentFactory.ts
import { AzureChatOpenAI } from "@langchain/openai";
import { createOpenAIFunctionsAgent } from "langchain/agents";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { CallbackManager } from "@langchain/core/callbacks/manager";
import { Tool } from "langchain/tools";

// 导入提示词模块
import { createSystemPrompt } from "../prompts/systemPrompts";
import { createHumanPrompt } from "../prompts/humanPrompts";

// 导入内存管理功能
import { createMemoryCallbackHandler } from "../memory/memoryManager";

// 导入类型
import { LintError } from "../types/codeTypes";
import { SceneStateObject, ModelHistoryEntry } from "../types/sceneTypes";

/**
 * 创建 Azure OpenAI 模型客户端实例
 * @returns 配置好的 AzureChatOpenAI 实例
 */
export function createModelClient(): AzureChatOpenAI {
  return new AzureChatOpenAI({
    modelName: "gpt-4.1",
    temperature: 0,
    azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
    azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
    azureOpenAIApiVersion: "2024-12-01-preview",
    azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
  });
}

/**
 * 创建 Agent 的工厂函数
 * 负责根据提供的上下文和工具创建 LangChain Agent 实例
 *
 * @param currentCodeState 当前代码状态
 * @param userPrompt 用户需求
 * @param lintErrors 代码 lint 错误（可选）
 * @param historyContext 历史上下文（可选）
 * @param modelRequired 是否需要生成 3D 模型（可选）
 * @param modelHistory 最近生成的 3D 模型历史（可选）
 * @param sceneState 当前场景状态（可选）
 * @param sceneHistory 场景历史记录（可选）
 * @param tools 要使用的工具数组
 * @returns 创建好的 LangChain Agent 实例
 */
export async function createAgent(
  currentCodeState: string,
  userPrompt: string,
  lintErrors?: LintError[],
  historyContext?: string,
  modelRequired?: boolean,
  modelHistory?: ModelHistoryEntry[],
  sceneState?: SceneStateObject[],
  sceneHistory?: string,
  tools: Tool[] = []
) {
  // 初始化 Azure OpenAI 客户端
  const model = createModelClient();

  // 创建自定义回调处理器用于内存管理
  const callbackHandler = createMemoryCallbackHandler(
    currentCodeState,
    userPrompt
  );

  // 设置回调管理器
  const callbackManager = new CallbackManager();
  callbackManager.addHandler(callbackHandler);

  // 创建系统消息提示
  const systemMessage = createSystemPrompt(
    lintErrors,
    historyContext,
    modelRequired,
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
  return await createOpenAIFunctionsAgent({
    llm: model,
    tools,
    prompt: promptTemplate,
  });
}

/**
 * 根据是否需要 3D 模型生成创建不同配置的 Agent
 * 此函数为高级工厂函数，根据用例创建特定类型的 Agent
 *
 * @param currentCodeState 当前代码状态
 * @param userPrompt 用户需求
 * @param tools 要使用的工具
 * @param options 其他可选配置选项
 * @returns 创建好的 LangChain Agent 实例
 */
export async function createAgentByType(
  currentCodeState: string,
  userPrompt: string,
  tools: Tool[],
  options: {
    type?: "standard" | "model_generation" | "code_only";
    lintErrors?: LintError[];
    historyContext?: string;
    modelHistory?: ModelHistoryEntry[];
    sceneState?: SceneStateObject[];
    sceneHistory?: string;
  } = {}
) {
  const {
    type = "standard",
    lintErrors = [],
    historyContext = "",
    modelHistory = [],
    sceneState = [],
    sceneHistory = "",
  } = options;

  // 根据类型设置不同的 modelRequired 值
  const modelRequired = type === "model_generation";

  // 根据类型可能选择不同的工具子集（示例实现）
  let selectedTools = tools;
  if (type === "code_only") {
    // 仅筛选代码相关工具（在实际应用中可能需要修改）
    selectedTools = tools.filter(
      (tool) => tool.name === "generate_fix_code" || tool.name === "apply_patch"
    );
  }

  // 创建并返回 Agent
  return await createAgent(
    currentCodeState,
    userPrompt,
    lintErrors,
    historyContext,
    modelRequired,
    modelHistory,
    sceneState,
    sceneHistory,
    selectedTools
  );
}
