// lib/analyzers/screenshotAnalyzer.ts

import { HumanMessage } from "@langchain/core/messages";
import { createModelClient } from "../../lib/agents/agentFactory";
import { extractTextContent } from "../../lib/processors/codeProcessor";
import { saveAnalysisToMemory } from "../../lib/memory/memoryManager";
import { prepareHistoryContext } from "../../lib/memory/memoryManager";
import { codeGenTool } from "../../lib/tools/codeGenTool";

/**
 * 分析 Three.js 场景截图并生成优化建议
 *
 * @param screenshotBase64 Base64 编码的截图
 * @param currentCode 当前代码
 * @param userPrompt 用户需求（可选）
 * @returns 分析结果
 */
export async function analyzeScreenshotDirectly(
  screenshotBase64: string,
  currentCode: string,
  userPrompt: string = ""
): Promise<string> {
  const requestId = `analysis_${Date.now()}`;

  console.log(
    `[${requestId}] [Screenshot Analysis] Started at ${new Date().toISOString()}`
  );
  console.log(
    `[${requestId}] [Screenshot Analysis] User prompt: "${userPrompt}"`
  );

  try {
    const imageDataSize = screenshotBase64.length;
    console.log(
      `[${requestId}] [Screenshot Analysis] Image data size: ${imageDataSize} bytes`
    );

    const historyContext = await prepareHistoryContext();
    console.log(
      `[${requestId}] [Screenshot Analysis] Building prompt with history context: ${
        historyContext ? "Available" : "Not available"
      }`
    );

    // 构建分析提示词
    const prompt = `Analyze this Three.js scene screenshot and suggest scene improvements:
    
User requirements:
${userPrompt || "No specific requirements provided"}

${historyContext ? `Historical context:\n${historyContext}\n\n` : ""}

Based on the photo and the user requirements, provide brief suggestions for improving the Three.js scene. 
don't generate the code at this stage.
`;

    // 创建图像消息
    const imageUrl = screenshotBase64.startsWith("data:")
      ? screenshotBase64
      : `data:image/png;base64,${screenshotBase64}`;

    console.log(
      `[${requestId}] [Screenshot Analysis] Sending request to model at ${new Date().toISOString()}`
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

    // 调用模型
    const result = await model.invoke([message]);
    const contentText = extractTextContent(result.content);

    console.log(
      `[${requestId}] [Screenshot Analysis] Analysis completed at ${new Date().toISOString()}`
    );
    console.log(
      `[${requestId}] [Screenshot Analysis] Suggestion length: ${contentText.length} chars`
    );

    // 传递分析结果给 codeGenTool
    try {
      console.log(
        `[${requestId}] [Screenshot Analysis] Passing suggestions to codeGenTool`
      );

      const instruction = `Apply the following improvements based on screenshot analysis:
${userPrompt || "No specific requirements"}

Scene improvement suggestions:
${contentText}

 implement these suggestions in the Three.js scene.`;

      // 调用代码生成工具
      await codeGenTool.invoke({ instruction });

      console.log(
        `[${requestId}] [Screenshot Analysis] Successfully passed suggestions to codeGenTool`
      );
    } catch (toolError) {
      console.error(
        `[${requestId}] [Screenshot Analysis] Failed to pass suggestions to codeGenTool:`,
        toolError
      );
    }

    // 将分析摘要保存到内存
    await saveAnalysisToMemory(userPrompt, contentText);
    console.log(
      `[${requestId}] [Screenshot Analysis] Analysis saved to memory`
    );

    return contentText;
  } catch (error) {
    console.error(`[${requestId}] [Screenshot Analysis] Error:`, error);
    return "Could not analyze the screenshot. Please try again.";
  }
}
