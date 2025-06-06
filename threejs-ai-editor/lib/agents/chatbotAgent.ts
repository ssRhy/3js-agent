import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatMessageHistory } from "langchain/stores/message/in_memory";
import { RunnableSequence } from "@langchain/core/runnables";
import { BaseMessage } from "@langchain/core/messages";
import { createModelClient } from "./agentFactory";

// Three.js 专家系统提示模板
const THREEJS_EXPERT_SYSTEM_PROMPT = `你是一个专业的Three.js 3D场景开发专家和建议顾问。

## 你的职责：
1. 为用户提供Three.js开发建议和指导
2. 分析当前场景状态，给出优化建议
3. 在每次交互结束时，总结完成的工作并提供下一步建议
4. 保持专业、简洁、实用的回复风格

## 回复格式要求：
- 使用简洁明了的中文回复
- 避免冗长的解释，直接给出实用建议
- 在适当时提供代码示例
- 始终关注用户的实际需求

## 当前上下文信息：
- 场景代码: {currentCode}
- 场景状态: {sceneState}
- 最近操作: {lastAction}

请基于当前上下文和用户输入提供专业建议。`;

// 总结提示模板 - 遵循科幻风格UI设计规范
const SUMMARY_PROMPT_TEMPLATE = `基于以下信息，为用户总结刚才完成的工作并提供下一步建议：

## 刚才完成的工作：
{completedWork}

## 当前场景状态：
{currentState}

## 用户原始需求：
{userRequest}

请用简洁专业的语言总结刚才的成果，并给出2-3个具体的下一步建议。

格式要求（严格遵循，不使用emoji）：

[COMPLETED]
[用1-2句话简要描述完成的工作，重点突出技术实现和视觉效果]

[SUGGESTIONS]
- [具体建议1 - 关于功能增强]

- [具体建议2 - 关于视觉优化]

- [具体建议3 - 关于交互体验]

注意：
- 不使用任何emoji图标或表情符号
- 使用纯文本标签
- 保持专业简洁的技术语言
- 每个建议独立成行，用空行分隔`;

// 消息历史记录
let chatHistory: ChatMessageHistory;

// 对话上下文状态
interface ChatbotContext {
  currentCode?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sceneState?: any[];
  lastAction?: string;
  conversationSummary?: string;
}

let chatbotContext: ChatbotContext = {};

/**
 * 初始化聊天机器人
 */
export function initializeChatbot(): void {
  chatHistory = new ChatMessageHistory();
  chatbotContext = {};
  console.log("[Chatbot] Initialized successfully");
}

/**
 * 更新聊天机器人上下文
 */
export function updateChatbotContext(context: Partial<ChatbotContext>): void {
  chatbotContext = { ...chatbotContext, ...context };
  console.log("[Chatbot] Context updated:", Object.keys(context));
}

/**
 * 处理用户输入的主要函数
 */
export async function handleUserChatInput(
  userInput: string,
  contextData?: {
    currentCode?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sceneState?: any[];
    lastAction?: string;
  }
): Promise<string> {
  try {
    // 更新上下文数据
    if (contextData) {
      updateChatbotContext(contextData);
    }

    // 确保聊天历史已初始化
    if (!chatHistory) {
      initializeChatbot();
    }

    // 创建模型客户端
    const chatModel = createModelClient();

    // 设置提示模板
    const prompt = ChatPromptTemplate.fromMessages([
      ["system", THREEJS_EXPERT_SYSTEM_PROMPT],
      ["placeholder", "{chat_history}"],
      ["human", "{input}"],
    ]);

    // 构建对话链
    const chain = RunnableSequence.from([
      {
        input: (input: { input: string }) => input.input,
        chat_history: async () => {
          const messages = await chatHistory.getMessages();
          return messages;
        },
        currentCode: () => chatbotContext.currentCode || "// 暂无代码",
        sceneState: () =>
          chatbotContext.sceneState
            ? JSON.stringify(chatbotContext.sceneState, null, 2)
            : "暂无场景数据",
        lastAction: () => chatbotContext.lastAction || "暂无最近操作",
      },
      prompt,
      chatModel,
    ]);

    // 添加用户消息到历史记录
    await chatHistory.addUserMessage(userInput);

    // 生成响应
    const response = await chain.invoke({ input: userInput });

    // 提取响应内容
    const responseContent =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    // 添加助手响应到历史记录
    await chatHistory.addAIMessage(responseContent);

    // 更新对话摘要
    chatbotContext.conversationSummary =
      responseContent.substring(0, 200) + "...";

    console.log("[Chatbot] Generated response for user input");
    return responseContent;
  } catch (error) {
    console.error("[Chatbot] Error handling user input:", error);
    return "抱歉，处理您的请求时出现了错误。请稍后再试。";
  }
}

/**
 * 生成工作总结和建议
 */
export async function generateWorkSummaryAndSuggestions(
  completedWork: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  currentState: any,
  userRequest: string
): Promise<string> {
  try {
    // 确保聊天历史已初始化
    if (!chatHistory) {
      initializeChatbot();
    }

    const chatModel = createModelClient();

    // 创建总结提示
    const summaryPrompt = ChatPromptTemplate.fromTemplate(
      SUMMARY_PROMPT_TEMPLATE
    );

    // 构建总结链
    const summaryChain = RunnableSequence.from([summaryPrompt, chatModel]);

    // 生成总结和建议
    const summaryResponse = await summaryChain.invoke({
      completedWork,
      currentState:
        typeof currentState === "string"
          ? currentState
          : JSON.stringify(currentState, null, 2),
      userRequest,
    });

    const summaryContent =
      typeof summaryResponse.content === "string"
        ? summaryResponse.content
        : JSON.stringify(summaryResponse.content);

    // 将总结添加到聊天历史（如果chatHistory存在）
    if (chatHistory) {
      try {
        await chatHistory.addAIMessage(`[系统总结] ${summaryContent}`);
      } catch (historyError) {
        console.warn(
          "[Chatbot] Failed to add summary to chat history:",
          historyError
        );
      }
    }

    console.log("[Chatbot] Generated work summary and suggestions");
    return summaryContent;
  } catch (error) {
    console.error("[Chatbot] Error generating summary:", error);
    return "生成工作总结时出现错误。";
  }
}

/**
 * 获取对话历史
 */
export async function getChatHistory(): Promise<BaseMessage[]> {
  if (!chatHistory) {
    initializeChatbot();
  }
  return await chatHistory.getMessages();
}

/**
 * 清除对话历史
 */
export async function clearChatHistory(): Promise<void> {
  if (chatHistory) {
    await chatHistory.clear();
  }
  chatbotContext = {};
  console.log("[Chatbot] Chat history cleared");
}

/**
 * 获取当前上下文状态
 */
export function getChatbotContext(): ChatbotContext {
  return { ...chatbotContext };
}

/**
 * Agent完成后自动生成总结和建议
 */
export async function onAgentComplete(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agentResult: any,
  userPrompt: string,
  currentCode: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sceneState: any[]
): Promise<string> {
  try {
    // 提取完成的工作内容
    let completedWork = "未知操作";

    if (agentResult.output) {
      completedWork = agentResult.output;
    } else if (agentResult.result) {
      completedWork = agentResult.result;
    }

    // 更新上下文
    updateChatbotContext({
      currentCode,
      sceneState,
      lastAction: completedWork,
    });

    // 生成总结和建议
    const summary = await generateWorkSummaryAndSuggestions(
      completedWork,
      sceneState,
      userPrompt
    );

    return summary;
  } catch (error) {
    console.error("[Chatbot] Error in onAgentComplete:", error);
    return "Agent执行完成，但生成总结时出现错误。";
  }
}
