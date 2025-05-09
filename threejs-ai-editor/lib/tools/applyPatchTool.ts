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
    "应用补丁到内存中保存的代码。可提交完整代码、补丁文本或包含code属性的JSON对象。初次必须先提交完整代码，之后只需提交补丁文本即可增量更新。",
  schema: z.object({
    input: z.string().describe("代码、补丁文本或JSON对象"),
  }),
  func: async ({ input }) => {
    try {
      console.log(`[apply_patch] 收到输入，长度: ${input.length}`);

      // 尝试解析输入为JSON
      let codeContent = input;
      try {
        // 首先尝试解析JSON
        const parsedJson = JSON.parse(input);

        // 如果解析成功且包含code属性，提取code内容
        if (parsedJson && typeof parsedJson === "object") {
          if (parsedJson.code) {
            console.log(`[apply_patch] 检测到JSON格式输入，提取code属性`);
            codeContent = parsedJson.code;
          } else if (parsedJson.input && typeof parsedJson.input === "string") {
            // 处理双重包装的情况: { input: "{\"code\": \"...\"}" }
            try {
              const nestedJson = JSON.parse(parsedJson.input);
              if (nestedJson && nestedJson.code) {
                console.log(
                  `[apply_patch] 检测到嵌套JSON格式输入，提取code属性`
                );
                codeContent = nestedJson.code;
              }
            } catch {
              // 如果嵌套JSON解析失败，使用input字段的值
              console.log(`[apply_patch] 使用input字段值作为代码内容`);
              codeContent = parsedJson.input;
            }
          }
        }
      } catch {
        // 解析JSON失败，假设是原始代码或补丁
        console.log(`[apply_patch] 不是JSON格式，作为原始代码或补丁处理`);
      }

      // 检查内容是否看起来像补丁（包含标准的patch格式标记）
      if (
        codeContent.includes("---") &&
        codeContent.includes("+++") &&
        codeContent.includes("@@")
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
          const result = applyPatch(cachedCode, codeContent);

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
        cachedCode = codeContent;
        return JSON.stringify({
          success: true,
          message: "代码已成功缓存，准备接收补丁进行增量更新",
          codeLength: codeContent.length,
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
