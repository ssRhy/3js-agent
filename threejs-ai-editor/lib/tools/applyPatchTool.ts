import { DynamicTool } from "@langchain/core/tools";
import { applyPatch } from "diff";

export const applyPatchTool = new DynamicTool({
  name: "apply_patch",
  description: "应用补丁到代码，输入格式为 { code: string, patch: string }",
  func: async (input: string) => {
    try {
      const { code, patch } = JSON.parse(input);

      if (!code || !patch) {
        return { error: "缺少code或patch参数" };
      }

      // 使用diff库的applyPatch在内存中应用补丁
      const updatedCode = applyPatch(code, patch);

      if (typeof updatedCode !== "string") {
        return { error: "补丁应用失败", success: false };
      }

      return { updatedCode, success: true };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { error: `应用补丁失败: ${errorMessage}`, success: false };
    }
  },
});
