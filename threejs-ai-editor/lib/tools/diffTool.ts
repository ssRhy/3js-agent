import { DynamicTool } from "@langchain/core/tools";
import jsdiff from "diff";

export const diffTool = new DynamicTool({
  name: "diff",
  description:
    "生成原始代码和更新代码之间的语义diff，输入格式为 { original: string, updated: string }",
  func: async (input: string) => {
    try {
      // 尝试解析JSON格式输入
      let params;
      try {
        params = JSON.parse(input);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_) {
        // 如果不是有效的JSON，假设是单个代码字符串
        return {
          error:
            "输入格式错误，需要 { original: string, updated: string } 格式",
        };
      }

      const { original, updated } = params;

      if (!original || !updated) {
        return { error: "缺少original或updated参数" };
      }

      const patch = jsdiff.createPatch("code", original, updated);
      return { patch };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { error: `生成diff失败: ${errorMessage}` };
    }
  },
});
