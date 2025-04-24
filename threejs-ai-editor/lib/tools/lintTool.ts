// tools/lintTool.ts
import { DynamicTool } from "@langchain/core/tools";
import { ESLint } from "eslint";

// // ESLint message interface
// interface ESLintMessage {
//   line: number;
//   column: number;
//   ruleId: string | null;
//   severity: number;
//   message: string;
// }

export const lintTool = new DynamicTool({
  name: "lint",
  description:
    "检查代码质量并返回结构化的检查结果，输入格式为 { code: string }",
  func: async (input: string) => {
    try {
      const { code } = JSON.parse(input);

      // 创建一个内存中的ESLint实例
      const eslint = new ESLint({
        useEslintrc: false,
        overrideConfig: {
          rules: {
            "no-undef": 2,
            "no-unused-vars": 1,
          },
        },
      } as ESLint.Options);

      // 直接检查代码字符串
      const results = await eslint.lintText(code);
      const firstResult = results[0] || {
        messages: [],
        errorCount: 0,
        warningCount: 0,
      };

      return {
        errorCount: firstResult.errorCount,
        warningCount: firstResult.warningCount,
        messages: firstResult.messages.map((m) => ({
          line: m.line,
          column: m.column,
          ruleId: m.ruleId,
          severity: m.severity === 2 ? "error" : "warning",
          message: m.message,
        })),
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        error: `Lint失败: ${errorMessage}`,
        errorCount: 0,
        warningCount: 0,
        messages: [],
      };
    }
  },
});
