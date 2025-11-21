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
    "Apply patches to the code saved in memory. Submit complete code or patch text directly, no JSON format required. Must submit complete code first, then submit patch text for incremental updates. Can include object deletion instructions.",
  schema: z.object({
    input: z.string().describe("Code or patch text"),
  }),
  func: async ({ input }) => {
    try {
      console.log(`[apply_patch] Received input, length: ${input.length}`);

      // 检查输入是否是JSON格式，如果是，提取code属性
      let codeInput = input;
      try {
        const parsedInput = JSON.parse(input);
        if (
          parsedInput &&
          typeof parsedInput === "object" &&
          parsedInput.code
        ) {
          codeInput = parsedInput.code;
          console.log(
            `[apply_patch] Detected JSON input, extracted code property, length: ${codeInput.length}`
          );
        }
      } catch {
        // 不是JSON格式，继续使用原始输入
      }

      // 检查内容是否看起来像补丁（包含标准的patch格式标记）
      if (
        codeInput.includes("---") &&
        codeInput.includes("+++") &&
        codeInput.includes("@@")
      ) {
        // 内容看起来像补丁
        if (!cachedCode) {
          return JSON.stringify({
            success: false,
            message:
              "No cached code, please submit complete code first to initialize",
          });
        }

        // 应用补丁到缓存的代码
        try {
          // @ts-expect-error - applyPatch 函数接受string但类型定义需要ParsedDiff
          const result = applyPatch(cachedCode, codeInput);

          if (typeof result === "boolean") {
            return JSON.stringify({
              success: false,
              message:
                "Patch application failed, possibly not compatible with the current code",
            });
          }

          // 更新缓存的代码
          cachedCode = result as string;

          return JSON.stringify({
            success: true,
            message: "Patch application successful",
            updatedCode: cachedCode,
            codeLength: cachedCode.length,
          });
        } catch (patchError) {
          return JSON.stringify({
            success: false,
            message: `Patch application failed: ${
              patchError instanceof Error
                ? patchError.message
                : String(patchError)
            }`,
          });
        }
      } else {
        // 不是补丁，假定是完整代码
        cachedCode = codeInput;
        return JSON.stringify({
          success: true,
          message:
            "Code has been successfully cached, ready to receive patches for incremental updates",
          updatedCode: cachedCode,
          codeLength: codeInput.length,
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return JSON.stringify({
        success: false,
        message: `Processing failed: ${errorMessage}`,
      });
    }
  },
});

// 获取当前缓存的代码
export const getCachedCode = (): string | null => cachedCode;

// 清除缓存的代码
export const clearCachedCode = (): { success: boolean; message: string } => {
  cachedCode = null;
  return { success: true, message: "Code cache has been cleared" };
};

// 直接更新缓存的代码
export const updateCachedCode = (
  newCode: string
): { success: boolean; message: string; codeLength: number } => {
  cachedCode = newCode;
  return {
    success: true,
    message: "Code cache has been updated",
    codeLength: newCode.length,
  };
};
