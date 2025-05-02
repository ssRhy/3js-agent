import { DynamicStructuredTool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { createModelClient } from "../agents/agentFactory";
import { extractTextContent } from "../processors/codeProcessor";
import {
  saveAnalysisToMemory,
  prepareHistoryContext,
} from "../memory/memoryManager";

/**
 * Screenshot analysis tool - Analyzes the current scene screenshot and checks if it matches user requirements
 */
export const screenshotTool = new DynamicStructuredTool({
  name: "analyze_screenshot",
  description:
    "分析Three.js场景截图，判断当前场景是否符合用户需求，并提供改进建议",
  schema: z.object({
    screenshotBase64: z.string().describe("Base64编码的场景截图"),
    userRequirement: z.string().describe("用户的原始需求描述"),
  }),
  func: async ({ screenshotBase64, userRequirement }) => {
    const requestId = `tool_analysis_${Date.now()}`;
    console.log(
      `[${requestId}] [Screenshot Tool] Started analysis at ${new Date().toISOString()}`
    );

    try {
      // 获取历史上下文
      const historyContext = await prepareHistoryContext();

      // 构建分析提示词
      const prompt = `Analyze this Three.js scene screenshot and determine if it meets the user requirements:
      
User requirements:
${userRequirement || "No specific requirements provided"}

${historyContext ? `Historical context:\n${historyContext}\n\n` : ""}

Based on the screenshot:
1. Does the scene match the user requirements? (Yes/No/Partially)
2. What aspects of the requirements are satisfied?
3. What aspects are missing or need improvement?
4. Provide specific visual feedback ( positioning, scale, etc.)

Focus only on visual analysis without suggesting code changes.
`;

      // 创建图像 URL转格式
      const imageUrl = screenshotBase64.startsWith("data:")
        ? screenshotBase64
        : `data:image/png;base64,${screenshotBase64}`;

      // 获取模型客户端
      const model = createModelClient();

      // 创建带图像的消息
      const message = new HumanMessage({
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      });

      // 调用模型
      const result = await model.invoke([message]);
      const analysis = extractTextContent(result.content);

      console.log(
        `[${requestId}] [Screenshot Tool] Analysis completed at ${new Date().toISOString()}`
      );
      console.log(
        `[${requestId}] [Screenshot Tool] Analysis length: ${analysis.length} chars`
      );

      // 将分析保存到内存
      await saveAnalysisToMemory(userRequirement, analysis);

      // 确定场景是否匹配需求
      const matches =
        analysis.toLowerCase().includes("yes") ||
        analysis.toLowerCase().includes("match") ||
        analysis.toLowerCase().includes("符合需求");

      const needsImprovements =
        analysis.toLowerCase().includes("no") ||
        analysis.toLowerCase().includes("partially") ||
        analysis.toLowerCase().includes("improve") ||
        analysis.toLowerCase().includes("missing") ||
        analysis.toLowerCase().includes("需要改进");

      // 返回分析结果
      return JSON.stringify({
        status: "success",
        analysis,
        matches_requirements: matches,
        needs_improvements: needsImprovements,
        recommendation:
          matches && !needsImprovements
            ? "场景完全符合要求，无需修改"
            : "场景需要调整，请参考分析建议",
      });
    } catch (error) {
      console.error(`[${requestId}] [Screenshot Tool] Error:`, error);
      return JSON.stringify({
        status: "error",
        message: `Error analyzing screenshot: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  },
});
