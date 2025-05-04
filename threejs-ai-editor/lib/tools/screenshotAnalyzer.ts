import { createModelClient } from "../agents/agentFactory";
import { HumanMessage } from "@langchain/core/messages";
import { extractTextContent } from "../processors/codeProcessor";
import { saveAnalysisToMemory } from "../memory/memoryManager";

/**
 * Analyzes a screenshot with the vision model to determine if it matches requirements
 *
 * @param screenshot Base64 encoded screenshot image
 * @param userRequirement User's requirements
 * @param historyContext Optional historical context
 * @returns Analysis results
 */
export async function analyzeScreenshot(
  screenshot: string,
  userRequirement: string,
  historyContext: string = ""
): Promise<{
  status: string;
  analysis?: string;
  matches_requirements?: boolean;
  needs_improvements?: boolean;
  key_improvements?: string;
  recommendation?: string;
  message?: string;
}> {
  const requestId = `screenshot_analysis_${Date.now()}`;
  const startTime = Date.now();
  console.log(
    `[${requestId}] [Screenshot Analyzer] 🖼️ 开始分析截图 - ${new Date().toISOString()}`
  );
  console.log(
    `[${requestId}] [Screenshot Analyzer] 📋 用户需求长度: ${userRequirement.length} 字符`
  );

  try {
    // Validate screenshot
    if (!screenshot || screenshot.length < 100) {
      console.error(
        `[${requestId}] [Screenshot Analyzer] ❌ 无效的截图数据: 长度 ${
          screenshot ? screenshot.length : 0
        } 字符`
      );
      throw new Error("Invalid screenshot data");
    }

    console.log(
      `[${requestId}] [Screenshot Analyzer] ✓ 截图数据有效，长度: ${screenshot.length} 字符`
    );

    // Create image URL
    const imageUrl = screenshot.startsWith("data:")
      ? screenshot
      : `data:image/png;base64,${screenshot}`;

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

    console.log(
      `[${requestId}] [Screenshot Analyzer] 🤖 准备调用视觉模型分析截图...`
    );
    const modelCallTime = Date.now();

    // Get model client
    const model = createModelClient();

    // Create message with image
    const message = new HumanMessage({
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
    });

    // Call model
    const modelResult = await model.invoke([message]);
    const analysis = extractTextContent(modelResult.content);

    const modelResponseTime = Date.now();
    console.log(
      `[${requestId}] [Screenshot Analyzer] ✅ 视觉模型响应完成，耗时: ${
        modelResponseTime - modelCallTime
      }ms，分析文本长度: ${analysis.length} 字符`
    );

    // Save analysis to memory
    await saveAnalysisToMemory(userRequirement, analysis);
    console.log(`[${requestId}] [Screenshot Analyzer] 💾 分析结果已保存到内存`);

    // Determine if the scene matches requirements
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

    const analysisResult = {
      status: "success",
      analysis,
      matches_requirements: matches,
      needs_improvements: needsImprovements,
      key_improvements: improvements,
      recommendation: needsImprovements
        ? "场景需要调整，请使用generate_fix_code工具修改代码"
        : "场景符合要求，无需大幅修改",
    };

    const totalTime = Date.now() - startTime;
    console.log(
      `[${requestId}] [Screenshot Analyzer] 🏁 分析完成，总耗时: ${totalTime}ms，结果: ${
        matches ? "符合需求" : "需要改进"
      }${needsImprovements ? "，需要改进" : ""}`
    );
    if (needsImprovements && improvements) {
      console.log(
        `[${requestId}] [Screenshot Analyzer] 🛠️ 主要改进项: ${improvements.substring(
          0,
          100
        )}${improvements.length > 100 ? "..." : ""}`
      );
    }

    return analysisResult;
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(
      `[${requestId}] [Screenshot Analyzer] ❌ 分析失败，总耗时: ${totalTime}ms, 错误:`,
      error
    );
    return {
      status: "error",
      message: `Error analyzing screenshot: ${
        error instanceof Error ? error.message : String(error)
      }`,
      needs_improvements: true,
    };
  }
}
