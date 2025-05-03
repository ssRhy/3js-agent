// 关键是：即使 canvas 元素在视觉上不可见或未挂载到 DOM 中，Three.js 仍然可以在其上渲染场景并获取截图。
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
 * Validates a base64 string to ensure it's properly formatted
 * @param base64String The base64 string to validate
 * @returns Whether the string appears to be valid base64
 */
function isValidBase64Image(base64String: string): boolean {
  // If it's already a data URL, extract just the base64 part
  if (base64String.startsWith("data:image")) {
    const parts = base64String.split(",");
    if (parts.length !== 2) return false;
    base64String = parts[1];
  }

  // Check if it follows base64 pattern (length is multiple of 4, valid chars)
  const regex = /^[A-Za-z0-9+/]+(=|==)?$/;
  return regex.test(base64String) && base64String.length % 4 === 0;
}

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
      // Log information about the screenshot data to help with debugging
      console.log(
        `[${requestId}] [Screenshot Tool] Screenshot data type: ${typeof screenshotBase64}, ` +
          `length: ${
            screenshotBase64 ? screenshotBase64.length : 0
          } characters, ` +
          `is string: ${typeof screenshotBase64 === "string"}, ` +
          `starts with data: ${
            screenshotBase64 && screenshotBase64.startsWith("data:")
          }`
      );

      // Check if the screenshot data is a placeholder or missing
      if (
        !screenshotBase64 ||
        screenshotBase64 === "<screenshot>" ||
        screenshotBase64.length < 100
      ) {
        console.error(
          `[${requestId}] [Screenshot Tool] Invalid screenshot data detected: ` +
            `${
              !screenshotBase64
                ? "empty"
                : screenshotBase64.length < 100
                ? "too short"
                : "placeholder"
            }`
        );
        throw new Error("Screenshot data is too short or empty");
      }

      // Check if the base64 data appears valid
      if (
        !isValidBase64Image(screenshotBase64) &&
        !screenshotBase64.startsWith("data:image")
      ) {
        console.error(
          `[${requestId}] [Screenshot Tool] Invalid image format detected. ` +
            `Starts with: ${screenshotBase64.substring(0, 30)}...`
        );
        throw new Error("Invalid image data format");
      }

      // 获取历史上下文
      const historyContext = await prepareHistoryContext();

      // 构建分析提示词
      const prompt = `Analyze this Three.js scene screenshot and determine if it meets the user requirements:
      
User requirements:
${userRequirement || "No specific requirements provided"}

${historyContext ? `Historical context:\n${historyContext}\n\n` : ""}

Based on the screenshot, provide your analysis in the following structure:
1. Overall Assessment: Does the scene match the user requirements? (Yes/No/Partially)
2. Visual Elements: What objects are visible in the scene?
3. Missing Components: What aspects of the requirements are missing or incomplete?
4. Position/Scale Issues: Are there any problems with object positioning or scaling?
5. Visual Quality: Evaluate lighting, colors, textures, and overall appearance
6. Concrete Improvements: List specific, actionable changes needed

Focus on being specific and precise. Your analysis will be used to decide if code modifications are needed.
`;

      // 创建图像 URL转格式
      const imageUrl = screenshotBase64.startsWith("data:")
        ? screenshotBase64
        : `data:image/png;base64,${screenshotBase64}`;

      console.log(
        `[${requestId}] [Screenshot Tool] Prepared image URL for analysis, format: ${
          screenshotBase64.startsWith("data:")
            ? "data URL"
            : "Base64 converted to data URL"
        }`
      );

      // 获取模型客户端
      const model = createModelClient();

      // 创建带图像的消息
      const message = new HumanMessage({
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      });

      console.log(
        `[${requestId}] [Screenshot Tool] Sending request to vision model`
      );

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
        analysis.toLowerCase().includes("yes") &&
        (analysis.toLowerCase().includes("match") ||
          analysis.toLowerCase().includes("符合需求"));

      const needsImprovements =
        analysis.toLowerCase().includes("no") ||
        analysis.toLowerCase().includes("partially") ||
        analysis.toLowerCase().includes("improve") ||
        analysis.toLowerCase().includes("missing") ||
        analysis.toLowerCase().includes("需要改进");

      // 提取关键改进点
      const improvementRegex = /Concrete Improvements:(.*?)(?:\n\n|\n$|$)/i;
      const improvementMatch = analysis.match(improvementRegex);
      const improvements = improvementMatch
        ? improvementMatch[1].trim()
        : "No specific improvements listed";

      // 返回结构化分析结果
      return JSON.stringify({
        status: "success",
        analysis: analysis,
        matches_requirements: matches,
        needs_improvements: needsImprovements,
        key_improvements: improvements,
        recommendation: needsImprovements
          ? "场景需要调整，请使用generate_fix_code工具修改代码"
          : "场景符合要求，无需大幅修改",
      });
    } catch (error) {
      console.error(`[${requestId}] [Screenshot Tool] Error:`, error);
      return JSON.stringify({
        status: "error",
        message: `Error analyzing screenshot: ${
          error instanceof Error ? error.message : String(error)
        }`,
        needs_improvements: true, // 默认需要改进
        recommendation: "截图分析出错，建议尝试修改代码或重新执行",
      });
    }
  },
});
