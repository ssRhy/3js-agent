import { applyPatch } from "diff";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

// 保存在内存中的代码
let cachedCode: string | null = null;

/**
 * Apply Patch Tool - 应用补丁到内存中保存的代码
 */
export const applyPatchTool = new DynamicStructuredTool({
  name: "apply_patch",
  description:
    "应用unified diff格式的补丁到内存中保存的代码。可以提交两种格式：1) 包含完整代码，用于初始化：{ code: string } 2) 包含标准unified diff补丁：{ patch: string }。初次必须先提交完整代码，之后只需提交补丁文本即可增量更新。也可以使用 { getCode: true } 来获取当前缓存的代码。",
  schema: z.object({
    input: z.string().describe("JSON格式的输入"),
  }),
  func: async ({ input }) => {
    try {
      // 解析输入
      let params;
      try {
        params = JSON.parse(input);
      } catch {
        // 尝试清理输入并重新解析
        try {
          // 如果直接解析失败，尝试清理输入中的转义字符
          const cleanedInput = input
            .replace(/\\n/g, "\n")
            .replace(/\\t/g, "\t")
            .replace(/\\\\/g, "\\");

          // 如果输入看起来像一个patch（含有标准的patch格式标记）
          if (
            cleanedInput.includes("---") &&
            cleanedInput.includes("+++") &&
            cleanedInput.includes("@@")
          ) {
            // 直接将其视为patch内容
            if (!cachedCode) {
              return JSON.stringify({
                success: false,
                message: "没有缓存的代码，请先使用 { code: string } 初始化代码",
              });
            }

            // 应用补丁到缓存的代码
            // @ts-expect-error - applyPatch 函数接受string但类型定义需要ParsedDiff
            const result = applyPatch(cachedCode, cleanedInput);

            // 检查结果类型
            if (typeof result === "boolean") {
              return JSON.stringify({
                success: false,
                message: "补丁应用失败，可能与当前代码不匹配",
              });
            }

            // 到这里，result应该是字符串类型
            const resultStr = result as string;

            // 更新缓存的代码
            cachedCode = resultStr;

            return JSON.stringify({
              success: true,
              message: "补丁应用成功（直接使用）",
              updatedCode: resultStr,
              codeLength: resultStr.length,
            });
          }

          // 尝试解析清理后的JSON
          params = JSON.parse(cleanedInput);
        } catch {
          // 无法解析JSON或处理补丁
          return JSON.stringify({
            success: false,
            message: "输入格式错误，需要有效的JSON格式",
          });
        }
      }

      // 处理获取当前代码的请求
      if (params.getCode === true) {
        return JSON.stringify({
          success: true,
          message: "返回当前缓存的代码",
          code: cachedCode,
          codeLength: cachedCode ? cachedCode.length : 0,
        });
      }

      // 提取参数
      const { code, patch } = params;

      // 情况1: 初始化代码
      if (code) {
        cachedCode = code;
        return JSON.stringify({
          success: true,
          message: "代码已成功缓存，准备接收补丁进行增量更新",
          codeLength: code.length,
        });
      }

      // 情况2: 应用补丁
      if (patch) {
        // 检查是否已有缓存的代码
        if (!cachedCode) {
          return JSON.stringify({
            success: false,
            message: "没有缓存的代码，请先使用 { code: string } 初始化代码",
          });
        }

        // 验证补丁格式
        try {
          // 确保patch是字符串
          if (typeof patch !== "string") {
            return JSON.stringify({
              success: false,
              message: "patch必须是字符串格式",
              receivedType: typeof patch,
            });
          }

          // 清理补丁中的转义字符
          const cleanedPatch = patch
            .replace(/\\n/g, "\n")
            .replace(/\\t/g, "\t")
            .replace(/\\\\/g, "\\");

          // 检查是否包含必要的patch标记
          if (
            !cleanedPatch.includes("---") ||
            !cleanedPatch.includes("+++") ||
            !cleanedPatch.includes("@@")
          ) {
            return JSON.stringify({
              success: false,
              message: "patch格式无效，缺少必要的diff标记(---, +++, @@)",
            });
          }

          // 应用补丁到缓存的代码
          // @ts-expect-error - applyPatch 函数接受string但类型定义需要ParsedDiff
          const result = applyPatch(cachedCode, cleanedPatch);

          // 处理应用结果
          if (typeof result === "boolean") {
            return JSON.stringify({
              success: false,
              message: "补丁应用失败，可能与当前代码不匹配",
            });
          }

          // 处理结果为字符串的情况
          const resultStr = result as string;

          // 更新缓存的代码
          cachedCode = resultStr;

          // 返回结构化JSON结果
          return JSON.stringify({
            success: true,
            message: "补丁应用成功",
            updatedCode: resultStr,
            codeLength: resultStr.length,
          });
        } catch (patchError) {
          return JSON.stringify({
            success: false,
            message: `补丁格式无效或应用失败: ${
              patchError instanceof Error
                ? patchError.message
                : String(patchError)
            }`,
          });
        }
      }

      // 既没有code也没有patch
      return JSON.stringify({
        success: false,
        message:
          "缺少必要参数，需要 { code: string } 或 { patch: string } 或 { getCode: true }",
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return JSON.stringify({
        success: false,
        message: `应用补丁失败: ${errorMessage}`,
      });
    }
  },
});

// 获取当前缓存的代码
export const getCachedCode = (): string | null => cachedCode;

// 清除缓存的代码
export const clearCachedCode = (): { success: boolean; message: string } => {
  cachedCode = null;
  return { success: true, message: "代码缓存已清除" };
};

// 直接更新缓存的代码
export const updateCachedCode = (
  newCode: string
): { success: boolean; message: string; codeLength: number } => {
  cachedCode = newCode;
  return {
    success: true,
    message: "代码缓存已更新",
    codeLength: newCode.length,
  };
};
