// screenshotAnalyzer.ts - 集成API端点和核心分析逻辑
import { NextApiRequest, NextApiResponse } from "next";
import { saveAnalysisToMemory } from "../../lib/memory/memoryManager";
import { screenshotTool } from "../../lib/tools/screenshotTool";

/**
 * API端点处理程序 - 分析截图并返回结果
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const requestId = `req_${Date.now()}`;
  console.log(`[${requestId}] Received screenshot analysis request`);

  // 只接受POST请求
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ error: "Method not allowed, please use POST" });
  }

  try {
    // 从请求体中获取截图数据和用户需求
    const { screenshot, userRequirement } = req.body;

    // 验证必要参数
    if (!screenshot) {
      console.error(`[${requestId}] Missing required parameter: screenshot`);
      return res.status(400).json({
        error: "Missing required parameter: screenshot",
        status: "error",
      });
    }

    console.log(
      `[${requestId}] Processing screenshot analysis, data length: ${screenshot.length} bytes`
    );

    // 调用核心分析功能
    const result = await analyzeScreenshot(
      screenshot,
      userRequirement,
      requestId
    );
    return res.status(200).json(result);
  } catch (error) {
    console.error(`[${requestId}] Screenshot analysis failed:`, error);
    return res.status(500).json({
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error occurred",
      needs_improvements: true,
      recommendation: "截图分析出错，请检查截图数据或稍后重试",
    });
  }
}

/**
 * 核心截图分析函数 - 可直接调用或通过API使用
 *
 * @param screenshotData Base64编码的截图数据
 * @param userRequirement 用户需求
 * @param requestId 请求ID (可选)
 * @returns 分析结果对象
 */
export async function analyzeScreenshot(
  screenshotData: string,
  userRequirement: string = "",
  requestId: string = `analysis_${Date.now()}`
): Promise<Record<string, unknown>> {
  console.log(`[${requestId}] Running screenshot analysis`);

  try {
    // 直接使用screenshotTool进行分析
    const analysisResult = await screenshotTool.func({
      screenshotBase64: screenshotData,
      userRequirement: userRequirement || "",
    });

    // 解析JSON结果
    try {
      const parsedResult = JSON.parse(analysisResult);
      console.log(
        `[${requestId}] Analysis completed successfully, status: ${parsedResult.status}`
      );
      return parsedResult;
    } catch (parseError) {
      console.error(
        `[${requestId}] Failed to parse analysis result:`,
        parseError
      );
      throw new Error("Failed to parse analysis result");
    }
  } catch (error) {
    console.error(`[${requestId}] Error in screenshot analysis:`, error);
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "Unknown error occurred",
      needs_improvements: true,
      recommendation: "截图分析出错，请检查截图数据或稍后重试",
    };
  }
}

/**
 * 直接分析截图并返回文本建议 (为兼容旧代码保留)
 */
export async function analyzeScreenshotDirectly(
  screenshotBase64: string,
  userPrompt: string = "",
  requestId: string = `analysis_${Date.now()}`
): Promise<string> {
  try {
    const result = await analyzeScreenshot(
      screenshotBase64,
      userPrompt,
      requestId
    );

    // 保存分析结果到内存
    if (result.analysis && typeof result.analysis === "string") {
      await saveAnalysisToMemory(userPrompt, result.analysis);
    }

    // 返回分析文本或完整的JSON字符串
    return result.analysis && typeof result.analysis === "string"
      ? result.analysis
      : JSON.stringify(result);
  } catch (error) {
    console.error(`[${requestId}] Direct analysis failed:`, error);
    return "Could not analyze the screenshot. Please try again.";
  }
}
