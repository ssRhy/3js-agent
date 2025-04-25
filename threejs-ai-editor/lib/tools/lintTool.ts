import { DynamicTool } from "@langchain/core/tools";
import { ESLint } from "eslint";
import { AzureChatOpenAI } from "@langchain/openai";
import { StructuredOutputParser } from "langchain/output_parsers";
import { createPatch } from "diff";

// 初始化 LLM
const model = new AzureChatOpenAI({
  model: "gpt-4o",
  temperature: 0,
  azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
  azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
  azureOpenAIApiVersion: "2024-02-15-preview",
  azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
  azureOpenAIEndpoint: process.env.AZURE_OPENAI_API_ENDPOINT,
  maxTokens: 4000,
});

// 定义输出解析器
const outputParser = StructuredOutputParser.fromNamesAndDescriptions({
  fixedCode: "修复后的Three.js代码",
  issues: "代码中发现的问题列表",
  summary: "对代码修复的总结说明",
});

// 处理LLM响应内容
function handleLLMResponseContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "text" &&
          "text" in item
      )
      .map((item) => (item as { text: string }).text)
      .join("\n");
  }

  return JSON.stringify(content);
}

// ESLint Lint工具与LLM集成
export const lintTool = new DynamicTool({
  name: "lint_with_llm",
  description: "检查代码质量，修复语法问题，使用LLM修复更复杂的逻辑和结构问题",
  func: async (input: string) => {
    try {
      // 解析输入
      let params;
      try {
        params = JSON.parse(input);
      } catch {
        return JSON.stringify({
          error: "输入格式错误，需要 { code: string } 格式",
          errorCount: 0,
          warningCount: 0,
          messages: [],
        });
      }

      const { code } = params;
      if (!code) {
        return JSON.stringify({
          error: "缺少code参数",
          errorCount: 0,
          warningCount: 0,
          messages: [],
        });
      }

      // 创建ESLint实例
      const eslint = new ESLint({
        fix: true,
        overrideConfig: {
          rules: {
            "no-undef": 2,
            "no-unused-vars": 1,
          },
        },
      });

      // 检查代码
      const results = await eslint.lintText(code);
      const firstResult = results[0] || {
        messages: [],
        errorCount: 0,
        warningCount: 0,
        output: code,
      };

      // 格式化ESLint结果
      const formattedMessages = firstResult.messages.map((m) => ({
        line: m.line,
        column: m.column,
        ruleId: m.ruleId,
        severity: m.severity === 2 ? "error" : "warning",
        message: m.message,
      }));

      const fixedCode = firstResult.output || code;

      // 如果没有错误，直接返回
      if (firstResult.errorCount === 0 && firstResult.warningCount === 0) {
        const patch = createPatch("code.js", code, fixedCode);
        return JSON.stringify({
          success: true,
          fixedCode,
          patch,
          issues: [],
          summary: "代码检查通过，没有发现问题",
        });
      }

      // 构建LLM提示
      const issues = firstResult.messages.map((msg) => msg.message).join("\n");
      const promptText = `
      以下是代码中的问题：
      ${issues}

      请修复以下threejs代码中的逻辑或结构问题（代码返回JSON格式），并提供改进建议：
      ${fixedCode}
      `;

      // 添加格式说明
      const format_instructions = outputParser.getFormatInstructions();
      const structured_prompt = `${promptText}\n\n${format_instructions}`;

      // 使用LLM修复
      const response = await model.invoke(structured_prompt);
      const responseContent = handleLLMResponseContent(response.content);

      try {
        // 尝试使用结构化输出
        const parsed_output = await outputParser.parse(responseContent);
        const patch = createPatch("code.js", code, parsed_output.fixedCode);
        return JSON.stringify({
          ...parsed_output,
          patch,
        });
      } catch {
        // 回退方案：提取代码块
        let extractedCode = fixedCode;
        if (responseContent.includes("```")) {
          const match = responseContent.match(
            /```(?:js|javascript)?([\s\S]*?)```/
          );
          if (match && match[1]) {
            extractedCode = match[1].trim();
          }
        } else {
          extractedCode = responseContent;
        }

        const patch = createPatch("code.js", code, extractedCode);
        return JSON.stringify({
          success: true,
          fixedCode: extractedCode,
          patch,
          issues: formattedMessages,
          summary: "代码已修复，逻辑和结构问题已解决。",
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return JSON.stringify({
        error: `修复失败: ${errorMessage}`,
        success: false,
        issues: [],
        fixedCode: "",
      });
    }
  },
});
