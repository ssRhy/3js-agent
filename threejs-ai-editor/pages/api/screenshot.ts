import { NextApiRequest, NextApiResponse } from "next";
import { screenshotTool } from "../../lib/tools/screenshotTool";

/**
 * API 路由处理截图分析请求
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { screenshotBase64, userPrompt } = req.body;

    if (!screenshotBase64) {
      return res.status(400).json({ error: "No screenshot provided" });
    }

    // 直接调用截图分析工具
    const requestId = `api_${Date.now()}`;
    console.log(
      `[${requestId}] [Screenshot API] Processing screenshot analysis request`
    );

    const result = await screenshotTool.invoke({
      screenshotBase64,
      userRequirement: userPrompt || "",
    });

    console.log(`[${requestId}] [Screenshot API] Analysis completed`);

    // 解析工具返回的JSON结果
    const analysisResult = JSON.parse(result);

    // 返回分析结果
    return res.status(200).json({
      success: true,
      ...analysisResult,
    });
  } catch (error) {
    console.error("Error in screenshot analysis:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
