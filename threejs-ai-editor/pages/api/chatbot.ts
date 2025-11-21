import { NextApiRequest, NextApiResponse } from "next";
import {
  handleUserChatInput,
  initializeChatbot,
  getChatHistory,
  clearChatHistory,
  getChatbotContext,
} from "../../lib/agents/chatbotAgent";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { action, input, contextData } = req.body;

    switch (action) {
      case "chat":
        // 处理用户聊天输入
        if (!input) {
          return res.status(400).json({ error: "Input is required" });
        }

        const response = await handleUserChatInput(input, contextData);

        return res.status(200).json({
          success: true,
          response,
          timestamp: new Date().toISOString(),
        });

      case "init":
        // 初始化chatbot
        initializeChatbot();
        return res.status(200).json({
          success: true,
          message: "Chatbot initialized successfully",
        });

      case "history":
        // 获取对话历史
        const history = await getChatHistory();
        return res.status(200).json({
          success: true,
          history: history.map((msg) => ({
            type: msg._getType(),
            content: msg.content,
            timestamp: new Date().toISOString(),
          })),
        });

      case "clear":
        // 清除对话历史
        await clearChatHistory();
        return res.status(200).json({
          success: true,
          message: "Chat history cleared successfully",
        });

      case "context":
        // 获取当前上下文
        const context = getChatbotContext();
        return res.status(200).json({
          success: true,
          context,
        });

      default:
        return res.status(400).json({ error: "Invalid action" });
    }
  } catch (error) {
    console.error("Chatbot API error:", error);
    return res.status(500).json({
      error: "Internal server error",
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
