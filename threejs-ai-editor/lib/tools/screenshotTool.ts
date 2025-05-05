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

// Import screenshot requesting functionality
import { requestScreenshot } from "../socket-client";

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
 * Internal helper function to analyze a screenshot image
 * @param screenshot Base64 encoded screenshot data
 * @param userRequirement User's requirement text
 * @returns Analysis result object
 */
async function analyzeScreenshot(
  screenshot: string,
  userRequirement: string
): Promise<{
  status: string;
  analysis?: string;
  matches_requirements?: boolean;
  needs_improvements?: boolean;
  key_improvements?: string;
  recommendation?: string;
  message?: string;
}> {
  const requestId = `tool_analysis_${Date.now()}`;
  console.log(
    `[${requestId}] [Screenshot Tool] Started analysis at ${new Date().toISOString()}`
  );

  try {
    // Validate screenshot
    if (!screenshot || screenshot.length < 100) {
      console.error(
        `[${requestId}] [Screenshot Tool] Invalid screenshot data: too short or empty`
      );
      throw new Error("Screenshot data is too short or empty");
    }

    if (
      !isValidBase64Image(screenshot) &&
      !screenshot.startsWith("data:image")
    ) {
      console.error(
        `[${requestId}] [Screenshot Tool] Invalid image format detected`
      );
      throw new Error("Invalid image data format");
    }

    // Get historical context
    const historyContext = await prepareHistoryContext();

    // Build analysis prompt
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

    // Create image URL
    const imageUrl = screenshot.startsWith("data:")
      ? screenshot
      : `data:image/png;base64,${screenshot}`;

    console.log(
      `[${requestId}] [Screenshot Tool] Prepared image URL for analysis`
    );

    // Get model client
    const model = createModelClient();

    // Create message with image
    const message = new HumanMessage({
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
    });

    console.log(
      `[${requestId}] [Screenshot Tool] Sending request to vision model`
    );

    // Call model
    const result = await model.invoke([message]);
    const analysis = extractTextContent(result.content);

    console.log(
      `[${requestId}] [Screenshot Tool] Analysis completed at ${new Date().toISOString()}`
    );

    // Save analysis to memory
    await saveAnalysisToMemory(userRequirement, analysis);

    // Determine if scene matches requirements
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

    // Extract key improvements
    const improvementRegex = /Concrete Improvements:(.*?)(?:\n\n|\n$|$)/i;
    const improvementMatch = analysis.match(improvementRegex);
    const improvements = improvementMatch
      ? improvementMatch[1].trim()
      : "No specific improvements listed";

    return {
      status: "success",
      analysis,
      matches_requirements: matches,
      needs_improvements: needsImprovements,
      key_improvements: improvements,
      recommendation: needsImprovements
        ? "场景需要调整，请使用generate_fix_code工具修改代码"
        : "场景符合要求，无需大幅修改",
    };
  } catch (error) {
    console.error(`[${requestId}] [Screenshot Tool] Error:`, error);
    return {
      status: "error",
      message: `Error analyzing screenshot: ${
        error instanceof Error ? error.message : String(error)
      }`,
      needs_improvements: true,
      recommendation: "截图分析出错，建议尝试修改代码或重新执行",
    };
  }
}

/**
 * Screenshot tool - LangChain tool that can request and analyze Three.js scene screenshots
 * This tool supports both getting a new screenshot via WebSocket and analyzing provided screenshots
 */
export const screenshotTool = new DynamicStructuredTool({
  name: "analyze_screenshot",
  description:
    "分析Three.js场景截图，判断当前场景是否符合用户需求，并提供改进建议",
  schema: z.object({
    userRequirement: z.string().describe("用户的原始需求描述"),
    useProvidedScreenshot: z
      .boolean()
      .optional()
      .describe("是否使用提供的截图，默认为false将请求新截图"),
    screenshotBase64: z
      .string()
      .optional()
      .describe("Base64编码的场景截图，仅当useProvidedScreenshot为true时使用"),
  }),
  func: async ({
    userRequirement,
    useProvidedScreenshot = false,
    screenshotBase64 = "",
  }) => {
    const requestId = `screenshot_tool_${Date.now()}`;
    console.log(
      `[${requestId}] [Screenshot Tool] Tool invoked with requirement: ${userRequirement.substring(
        0,
        50
      )}...`
    );

    try {
      // Step 1: Get screenshot - either use provided one or request via WebSocket
      let screenshot = "";
      if (useProvidedScreenshot && screenshotBase64) {
        console.log(
          `[${requestId}] [Screenshot Tool] Using provided screenshot`
        );
        screenshot = screenshotBase64;
      } else {
        console.log(
          `[${requestId}] [Screenshot Tool] Requesting new screenshot via WebSocket`
        );
        // Request screenshot via WebSocket using the imported function
        screenshot = await requestScreenshot(requestId);
        if (!screenshot) {
          return JSON.stringify({
            status: "error",
            message: "Failed to get screenshot from client",
            needs_improvements: true,
            recommendation: "无法获取截图，请检查浏览器连接",
          });
        }
      }

      // Step 2: Analyze the screenshot
      const analysis = await analyzeScreenshot(screenshot, userRequirement);

      // Return the structured result
      return JSON.stringify(analysis);
    } catch (error) {
      console.error(
        `[${requestId}] [Screenshot Tool] Tool execution error:`,
        error
      );
      return JSON.stringify({
        status: "error",
        message: `Error in screenshot tool: ${
          error instanceof Error ? error.message : String(error)
        }`,
        needs_improvements: true,
        recommendation: "工具执行出错，建议重试",
      });
    }
  },
});
