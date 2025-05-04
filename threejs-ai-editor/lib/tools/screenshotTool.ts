// 关键是：即使 canvas 元素在视觉上不可见或未挂载到 DOM 中，Three.js 仍然可以在其上渲染场景并获取截图。
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { requestScreenshot } from "../../pages/api/socket";
import { prepareHistoryContext } from "../memory/memoryManager";
import { analyzeScreenshot } from "./screenshotAnalyzer";

/**
 * 验证base64字符串是否合法
 * @param base64String 需要验证的base64字符串
 * @returns 是否是有效的base64图像数据
 */
function isValidBase64Image(base64String: string): boolean {
  try {
    // 如果已经是Data URL，提取base64部分
    if (base64String.startsWith("data:image")) {
      const parts = base64String.split(",");
      if (parts.length !== 2) return false;
      base64String = parts[1];
    }

    // 检查是否符合base64模式（长度是4的倍数，只包含有效字符）
    if (base64String.length % 4 !== 0) return false;
    if (!/^[A-Za-z0-9+/=]+$/.test(base64String)) return false;

    // 检查大小（base64图像通常至少有几百字节）
    return base64String.length >= 100;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_) {
    // 捕获任何验证过程中的异常，直接返回false
    return false;
  }
}

/**
 * 截图分析工具 - 分析当前场景截图并检查是否符合用户要求
 * Agent可以通过调用这个工具主动请求前端截图，并分析是否符合要求
 */
export const screenshotTool = new DynamicStructuredTool({
  name: "analyze_screenshot",
  description:
    "Analyzes a Three.js scene screenshot to determine if it meets user requirements. If no screenshot is provided, the tool will request one via Socket.IO from the frontend.",
  schema: z.object({
    userRequirement: z
      .string()
      .describe("User's original requirement description"),
    // screenshotBase64现在是可选的 - 如果未提供，将通过Socket.IO获取
    screenshotBase64: z
      .string()
      .optional()
      .describe(
        "Base64 encoded screenshot (optional, will be requested via Socket.IO if not provided)"
      ),
    forceWebSocket: z
      .boolean()
      .optional()
      .describe(
        "Force using Socket.IO to request a new screenshot, even if one is already provided"
      ),
  }),
  func: async ({
    screenshotBase64,
    userRequirement,
    forceWebSocket = false,
  }) => {
    const requestId = `tool_analysis_${Date.now()}`;
    const timestamp = new Date().toISOString();
    console.log(
      `[${requestId}] [Screenshot Tool] 🔍 Agent requesting screenshot analysis - ${timestamp}`
    );
    console.log(
      `[${requestId}] [Screenshot Tool] 📝 User requirement: "${userRequirement.substring(
        0,
        50
      )}${userRequirement.length > 50 ? "..." : ""}"`
    );

    try {
      let screenshot = screenshotBase64;
      let wasRequested = false;

      // 如果未提供截图或强制使用Socket.IO，则通过Socket.IO请求
      if (
        forceWebSocket ||
        !screenshot ||
        screenshot === "<screenshot>" ||
        screenshot.length < 100
      ) {
        console.log(
          `[${requestId}] [Screenshot Tool] 🔄 ${
            forceWebSocket ? "Force" : "No valid screenshot data,"
          } requesting screenshot via Socket.IO`
        );

        try {
          // 通过Socket.IO从客户端请求截图
          const wsRequestTime = Date.now();

          // 使用Socket.IO实现请求截图
          screenshot = await requestScreenshot(requestId);
          wasRequested = true;

          const wsResponseTime = Date.now();
          console.log(
            `[${requestId}] [Screenshot Tool] ✅ Successfully received screenshot via Socket.IO, time: ${
              wsResponseTime - wsRequestTime
            }ms, data size: ${screenshot.length} bytes`
          );
        } catch (wsError) {
          console.error(
            `[${requestId}] [Screenshot Tool] ❌ Socket.IO screenshot request failed:`,
            wsError
          );

          // 增加更详细的错误报告
          const errorMessage =
            wsError instanceof Error ? wsError.message : String(wsError);
          const errorReport = {
            status: "error",
            message: `Failed to get screenshot via Socket.IO: ${errorMessage}`,
            error_type: "socket_request_failed",
            request_id: requestId,
            timestamp: new Date().toISOString(),
            needs_improvements: true,
          };

          return JSON.stringify(errorReport);
        }
      } else {
        console.log(
          `[${requestId}] [Screenshot Tool] ℹ️ Valid screenshot data already provided, size: ${screenshot.length} chars`
        );
      }

      // 检查Socket.IO请求后截图数据是否仍然无效
      if (
        !screenshot ||
        screenshot === "<screenshot>" ||
        (screenshot && screenshot.length < 100)
      ) {
        console.error(
          `[${requestId}] [Screenshot Tool] ❌ ${
            wasRequested ? "After Socket.IO attempt " : ""
          }Screenshot data invalid: ` +
            `${
              !screenshot
                ? "empty"
                : screenshot.length < 100
                ? "too short"
                : "placeholder"
            }`
        );

        const errorReport = {
          status: "error",
          message: "Screenshot data too short or empty",
          error_type: "invalid_screenshot_data",
          request_id: requestId,
          timestamp: new Date().toISOString(),
          needs_improvements: true,
        };

        return JSON.stringify(errorReport);
      }

      // 检查base64数据是否有效
      if (
        !isValidBase64Image(screenshot) &&
        !screenshot.startsWith("data:image")
      ) {
        console.error(
          `[${requestId}] [Screenshot Tool] ❌ Invalid image format detected. ` +
            `Starts with: ${screenshot.substring(0, 30)}...`
        );

        const errorReport = {
          status: "error",
          message: "Invalid image data format",
          error_type: "invalid_image_format",
          request_id: requestId,
          timestamp: new Date().toISOString(),
          needs_improvements: true,
        };

        return JSON.stringify(errorReport);
      }

      // 获取历史上下文
      const historyContext = await prepareHistoryContext();

      console.log(
        `[${requestId}] [Screenshot Tool] 🔍 Starting screenshot analysis, calling analyzer module...`
      );
      const analysisStartTime = Date.now();

      // 使用共享的分析器模块
      const analysisResult = await analyzeScreenshot(
        screenshot,
        userRequirement,
        historyContext
      );

      const analysisEndTime = Date.now();
      console.log(
        `[${requestId}] [Screenshot Tool] ✅ Analysis complete, time: ${
          analysisEndTime - analysisStartTime
        }ms, status: ${analysisResult.status}`
      );
      console.log(
        `[${requestId}] [Screenshot Tool] 📊 Analysis result: matches_requirements=${analysisResult.matches_requirements}, needs_improvements=${analysisResult.needs_improvements}`
      );

      // 添加来源信息以帮助Agent了解截图来源
      const resultWithSource = {
        ...analysisResult,
        source: wasRequested ? "socket_io_request" : "provided_by_api",
        timestamp: new Date().toISOString(),
        request_id: requestId,
      };

      // 返回分析结果的JSON字符串
      return JSON.stringify(resultWithSource);
    } catch (error) {
      console.error(`[${requestId}] [Screenshot Tool] ❌ Error:`, error);
      return JSON.stringify({
        status: "error",
        message: `Screenshot analysis error: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error_type: "analysis_failure",
        needs_improvements: true, // 默认需要改进
        recommendation:
          "Screenshot analysis failed, try modifying code or rerunning",
        timestamp: new Date().toISOString(),
        request_id: requestId,
      });
    }
  },
});
