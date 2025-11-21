import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatMessageHistory } from "langchain/stores/message/in_memory";
import { RunnableSequence } from "@langchain/core/runnables";
import { BaseMessage } from "@langchain/core/messages";
import { createModelClient } from "./agentFactory";

// Three.js Expert System Prompt Template
const THREEJS_EXPERT_SYSTEM_PROMPT = `You are a professional Three.js 3D scene development expert and advisor.

## Your Responsibilities:
1. Provide Three.js development guidance and recommendations
2. Analyze current scene state and provide optimization suggestions
3. Summarize completed work and provide next steps after each interaction
4. Maintain professional, concise, and practical responses

## Response Format Requirements:
- Provide clear and concise responses
- Avoid lengthy explanations, focus on actionable advice
- Include code examples when appropriate
- Always focus on user's practical needs

## Current Context Information:
- Scene Code: {currentCode}
- Scene State: {sceneState}
- Last Action: {lastAction}

Please provide professional advice based on the current context and user input.`;

// Summary Prompt Template - Following Sci-fi UI Design Guidelines
const SUMMARY_PROMPT_TEMPLATE = `Based on the following information, summarize the completed work and provide next steps for the user:

## Completed Work:
{completedWork}

## Current Scene State:
{currentState}

## Original User Request:
{userRequest}

Please summarize the recent achievements and provide 2-3 specific next-step suggestions using professional language.

Format Requirements (Strictly follow, no emojis):

[COMPLETED]
[1-2 sentences describing completed work, emphasizing technical implementation and visual effects]

[SUGGESTIONS]
- [Specific suggestion 1 - Regarding functionality enhancement]

- [Specific suggestion 2 - Regarding visual optimization]

- [Specific suggestion 3 - Regarding interaction experience]

Note:
- Do not use any emoji icons or emoticons
- Use pure text labels
- Maintain professional and concise technical language
- Each suggestion on separate line, separated by blank lines`;

// Message history
let chatHistory: ChatMessageHistory;

// Chat context state
interface ChatbotContext {
  currentCode?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sceneState?: any[];
  lastAction?: string;
  conversationSummary?: string;
}

let chatbotContext: ChatbotContext = {};

/**
 * Initialize chatbot
 */
export function initializeChatbot(): void {
  chatHistory = new ChatMessageHistory();
  chatbotContext = {};
  console.log("[Chatbot] Initialized successfully");
}

/**
 * Update chatbot context
 */
export function updateChatbotContext(context: Partial<ChatbotContext>): void {
  chatbotContext = { ...chatbotContext, ...context };
  console.log("[Chatbot] Context updated:", Object.keys(context));
}

/**
 * Handle user input
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
    // Update context data
    if (contextData) {
      updateChatbotContext(contextData);
    }

    // Ensure chat history is initialized
    if (!chatHistory) {
      initializeChatbot();
    }

    // Create model client
    const chatModel = createModelClient();

    // Set prompt template
    const prompt = ChatPromptTemplate.fromMessages([
      ["system", THREEJS_EXPERT_SYSTEM_PROMPT],
      ["placeholder", "{chat_history}"],
      ["human", "{input}"],
    ]);

    // Build conversation chain
    const chain = RunnableSequence.from([
      {
        input: (input: { input: string }) => input.input,
        chat_history: async () => {
          const messages = await chatHistory.getMessages();
          return messages;
        },
        currentCode: () => chatbotContext.currentCode || "// No code available",
        sceneState: () =>
          chatbotContext.sceneState
            ? JSON.stringify(chatbotContext.sceneState, null, 2)
            : "No scene data available",
        lastAction: () => chatbotContext.lastAction || "No recent actions",
      },
      prompt,
      chatModel,
    ]);

    // Add user message to history
    await chatHistory.addUserMessage(userInput);

    // Generate response
    const response = await chain.invoke({ input: userInput });

    // Extract response content
    const responseContent =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    // Add assistant response to history
    await chatHistory.addAIMessage(responseContent);

    // Update conversation summary
    chatbotContext.conversationSummary =
      responseContent.substring(0, 200) + "...";

    console.log("[Chatbot] Generated response for user input");
    return responseContent;
  } catch (error) {
    console.error("[Chatbot] Error handling user input:", error);
    return "Sorry, an error occurred while processing your request. Please try again later.";
  }
}

/**
 * Generate work summary and suggestions
 */
export async function generateWorkSummaryAndSuggestions(
  completedWork: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  currentState: any,
  userRequest: string
): Promise<string> {
  try {
    // Ensure chat history is initialized
    if (!chatHistory) {
      initializeChatbot();
    }

    const chatModel = createModelClient();

    // Create summary prompt
    const summaryPrompt = ChatPromptTemplate.fromTemplate(
      SUMMARY_PROMPT_TEMPLATE
    );

    // Build summary chain
    const summaryChain = RunnableSequence.from([summaryPrompt, chatModel]);

    // Generate summary and suggestions
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

    // Add summary to chat history (if chatHistory exists)
    if (chatHistory) {
      try {
        await chatHistory.addAIMessage(`[System Summary] ${summaryContent}`);
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
    return "An error occurred while generating the work summary.";
  }
}

/**
 * Get chat history
 */
export async function getChatHistory(): Promise<BaseMessage[]> {
  if (!chatHistory) {
    initializeChatbot();
  }
  return await chatHistory.getMessages();
}

/**
 * Clear chat history
 */
export async function clearChatHistory(): Promise<void> {
  if (chatHistory) {
    await chatHistory.clear();
  }
  chatbotContext = {};
  console.log("[Chatbot] Chat history cleared");
}

/**
 * Get current context state
 */
export function getChatbotContext(): ChatbotContext {
  return { ...chatbotContext };
}

/**
 * Generate summary and suggestions automatically after Agent completes
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
    // Extract completed work content
    let completedWork = "Unknown operation";

    if (agentResult.output) {
      completedWork = agentResult.output;
    } else if (agentResult.result) {
      completedWork = agentResult.result;
    }

    // Update context
    updateChatbotContext({
      currentCode,
      sceneState,
      lastAction: completedWork,
    });

    // Generate summary and suggestions
    const summary = await generateWorkSummaryAndSuggestions(
      completedWork,
      sceneState,
      userPrompt
    );

    return summary;
  } catch (error) {
    console.error("[Chatbot] Error in onAgentComplete:", error);
    return "Agent execution completed, but an error occurred while generating the summary.";
  }
}
