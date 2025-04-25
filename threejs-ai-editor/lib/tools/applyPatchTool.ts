import { DynamicTool } from "@langchain/core/tools";
import { applyPatch, parsePatch } from "diff";

/**
 * Apply Patch Tool - 应用补丁到原始代码
 */
export const applyPatchTool = new DynamicTool({
  name: "apply_patch",
  description:
    "应用补丁到代码，输入格式为 { code: string, patch: string } 或 { originalCode: string, improvedCode: string }",
  func: async (input: string) => {
    try {
      // 解析输入
      let params;
      try {
        params = JSON.parse(input);
      } catch {
        return JSON.stringify({
          success: false,
          message:
            "输入格式错误，需要 { code: string, patch: string } 或 { originalCode: string, improvedCode: string } 格式",
        });
      }

      const { code, patch, originalCode, improvedCode } = params;

      // 如果提供了originalCode和improvedCode，直接从两者之间提取改进后的代码
      if (originalCode && improvedCode) {
        try {
          return JSON.stringify({
            success: true,
            updatedCode: improvedCode,
            message: "已直接使用改进后的代码",
          });
        } catch (patchError) {
          return JSON.stringify({
            success: false,
            message: `处理代码失败: ${
              patchError instanceof Error
                ? patchError.message
                : String(patchError)
            }`,
          });
        }
      }

      // 传统模式：使用code和patch
      if (!code || !patch) {
        return JSON.stringify({
          success: false,
          message:
            "缺少 code 或 patch 参数，或者缺少 originalCode 和 improvedCode 参数",
        });
      }

      // 验证补丁格式
      try {
        const patches = parsePatch(patch);
        if (patches.length === 0) {
          return JSON.stringify({
            success: false,
            message: "补丁格式有效，但没有实际的更改",
          });
        }
      } catch (parseError) {
        return JSON.stringify({
          success: false,
          message: `补丁格式无效: ${
            parseError instanceof Error
              ? parseError.message
              : String(parseError)
          }`,
        });
      }

      // 使用 diff 库的 applyPatch 在内存中应用补丁
      const updatedCode = applyPatch(code, patch);

      // 返回结构化JSON结果
      return JSON.stringify({
        success: true,
        updatedCode,
        message: "补丁应用成功",
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
