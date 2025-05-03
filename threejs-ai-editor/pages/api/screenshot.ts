import { NextApiRequest, NextApiResponse } from "next";
// import { saveAnalysisToMemory } from "../../lib/memory/memoryManager";
import { screenshotTool } from "../../lib/tools/screenshotTool";

/**
 * 统一的截图分析API端点
 * 支持以下格式的请求:
 * - { screenshotBase64, userPrompt } (旧接口)
 * - { screenshot, userRequirement } (新接口)
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const requestId = `screenshot_api_${Date.now()}`;
  console.log(`[${requestId}] Received screenshot analysis request`);

  // 只接受POST请求
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // 支持两种参数命名格式，保持向后兼容
    const { screenshot, screenshotBase64, userRequirement, userPrompt } =
      req.body;

    // 统一参数处理
    const imageData = screenshot || screenshotBase64;
    const requirement = userRequirement || userPrompt || "";

    // 验证必要参数
    if (!imageData) {
      console.error(`[${requestId}] Missing required parameter: screenshot`);
      return res.status(400).json({
        success: false,
        status: "error",
        error: "No screenshot provided",
      });
    }

    console.log(
      `[${requestId}] Processing screenshot analysis, data length: ${imageData.length} bytes`
    );

    // 调用截图分析工具
    const result = await analyzeScreenshot(imageData, requirement, requestId);

    // 统一返回格式
    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error(`[${requestId}] Screenshot analysis failed:`, error);
    return res.status(500).json({
      success: false,
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
    // 使用screenshotTool进行分析 - 保持agent自主调用analyze_screenshot工具的能力
    const analysisResult = await screenshotTool.invoke({
      screenshotBase64: screenshotData,
      userRequirement: userRequirement || "",
    });

    // 解析工具返回的JSON结果
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
      recommendation: "截图分析出错，建议尝试修改代码或重新执行",
    };
  }
}

// /**
//  * 直接分析截图并返回文本建议 (为兼容旧代码保留)
//  *
//  * 此函数供内部代码直接调用
//  */
// export async function analyzeScreenshotDirectly(
//   screenshotBase64: string,
//   userPrompt: string = "",
//   requestId: string = `analysis_${Date.now()}`
// ): Promise<string> {
//   try {
//     const result = await analyzeScreenshot(
//       screenshotBase64,
//       userPrompt,
//       requestId
//     );

//     // 保存分析结果到内存
//     if (result.analysis && typeof result.analysis === "string") {
//       await saveAnalysisToMemory(userPrompt, result.analysis);
//     }

//     // 返回分析文本或完整的JSON字符串
//     return result.analysis && typeof result.analysis === "string"
//       ? result.analysis
//       : JSON.stringify(result);
//   } catch (error) {
//     console.error(`[${requestId}] Direct analysis failed:`, error);
//     return "Could not analyze the screenshot. Please try again.";
//   }
// }
