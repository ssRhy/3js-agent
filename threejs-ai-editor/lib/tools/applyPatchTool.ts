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
    "应用补丁到内存中保存的代码。直接提交完整代码或补丁文本，无需JSON格式。初次必须先提交完整代码，之后只需提交补丁文本即可增量更新。",
  schema: z.object({
    input: z.string().describe("代码或补丁文本"),
  }),
  func: async ({ input }) => {
    try {
      console.log(`[apply_patch] 收到输入，长度: ${input.length}`);

      // 检查内容是否看起来像补丁（包含标准的patch格式标记）
      if (
        input.includes("---") &&
        input.includes("+++") &&
        input.includes("@@")
      ) {
        // 内容看起来像补丁
        if (!cachedCode) {
          return JSON.stringify({
            success: false,
            message: "没有缓存的代码，请先提交完整代码初始化",
          });
        }

        // 应用补丁到缓存的代码
        try {
          // @ts-expect-error - applyPatch 函数接受string但类型定义需要ParsedDiff
          const result = applyPatch(cachedCode, input);

          if (typeof result === "boolean") {
            return JSON.stringify({
              success: false,
              message: "补丁应用失败，可能与当前代码不匹配",
            });
          }

          // 更新缓存的代码
          cachedCode = result as string;

          return JSON.stringify({
            success: true,
            message: "补丁应用成功",
            updatedCode: cachedCode,
            codeLength: cachedCode.length,
          });
        } catch (patchError) {
          return JSON.stringify({
            success: false,
            message: `补丁应用失败: ${
              patchError instanceof Error
                ? patchError.message
                : String(patchError)
            }`,
          });
        }
      } else {
        // 不是补丁，假定是完整代码
        cachedCode = input;
        return JSON.stringify({
          success: true,
          message: "代码已成功缓存，准备接收补丁进行增量更新",
          codeLength: input.length,
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return JSON.stringify({
        success: false,
        message: `处理失败: ${errorMessage}`,
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
