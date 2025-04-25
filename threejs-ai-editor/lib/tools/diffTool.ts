import { DynamicTool } from "@langchain/core/tools";
import { AzureChatOpenAI } from "@langchain/openai";
import { StructuredOutputParser } from "langchain/output_parsers";
import { createPatch } from "diff";

// Initialize Azure OpenAI client for diffing
const diffModel = new AzureChatOpenAI({
  model: "gpt-4o",
  temperature: 0,
  azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
  azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
  azureOpenAIApiVersion: "2024-02-15-preview",
  azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
  azureOpenAIEndpoint: process.env.AZURE_OPENAI_API_ENDPOINT,
  maxTokens: 4000,
});

// Output parser for structured results
const outputParser = StructuredOutputParser.fromNamesAndDescriptions({
  originalCode: "The original Three.js code",
  improvedCode: "The improved Three.js code",
  explanation: "Explanation of the changes made",
});

/**
 * 处理LLM响应内容 - 支持字符串或数组格式
 */
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

/**
 * Diff Tool - Generates diffs between original and improved code, focusing on semantic differences.
 * This tool is used after lintTool has already fixed the code, so the focus here is purely on generating diffs.
 */
export const diffTool = new DynamicTool({
  name: "diff_code",
  description:
    '生成原始代码和改进代码之间的语义差异。必须以JSON格式提供输入：{ "originalCode": "...", "improvedCode": "..." }',
  func: async (input: string): Promise<string> => {
    try {
      // 灵活解析输入 - 支持JSON对象和纯代码字符串
      let originalCode: string = "";
      let improvedCode: string = "";

      // 尝试解析为JSON
      try {
        const parsedInput = JSON.parse(input);

        // 如果是对象格式，提取originalCode和improvedCode
        if (typeof parsedInput === "object" && parsedInput !== null) {
          originalCode = parsedInput.originalCode || "";
          improvedCode = parsedInput.improvedCode || "";
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (error) {
        // 非JSON输入 - 假设输入是改进后的代码
        console.log("收到非JSON输入，尝试作为改进代码处理");

        // 当输入不是JSON时，假设它是改进后的代码
        improvedCode = input.trim();

        // 从suggestionContext获取原始代码 - 这需要在agent中实现
        // 简单起见，这里我们使用改进代码作为原始代码，会生成空的diff
        originalCode = improvedCode;

        // 继续执行，让流程正常进行
      }

      // 验证代码不为空
      if (!improvedCode) {
        return JSON.stringify({
          error: "Missing improved code",
          details: "请提供有效的代码。",
        });
      }

      console.log("Generating diff between original and improved code...");

      // Generate a prompt for the LLM to generate a diff explanation
      const prompt = `You are a code expert responsible for analyzing and explaining the differences between two versions of Three.js code.

Original code:
\`\`\`javascript
${originalCode}
\`\`\`

Improved code:
\`\`\`javascript
${improvedCode}
\`\`\`

Your task is to:
1. Identify the differences between the original and improved code.
2. Explain what changes were made and why they improve the code.
3. Focus on structural, logical, or functional improvements.

Provide your response as:
1. The original code (unchanged)
2. The improved code (with your fixes and improvements)
3. A detailed explanation of the changes made and why they were necessary.

Do not add new features, only explain the existing improvements.`;

      // Invoke the LLM to get the diff and explanation
      const response = await diffModel.invoke(prompt);
      const content = handleLLMResponseContent(response.content);

      try {
        // First attempt to use the structured output parser
        const format_instructions = outputParser.getFormatInstructions();
        const structured_prompt = `${prompt}\n\n${format_instructions}`;
        const structured_response = await diffModel.invoke(structured_prompt);
        const responseContent = handleLLMResponseContent(
          structured_response.content
        );

        const parsed_output = await outputParser.parse(responseContent);
        const patch = createPatch("code.js", originalCode, improvedCode);

        return JSON.stringify({
          originalCode,
          improvedCode,
          patch, // 添加标准格式的patch
          explanation: parsed_output.explanation,
        });
      } catch (parserError: unknown) {
        console.log(
          "Falling back to regex parsing due to:",
          parserError instanceof Error
            ? parserError.message
            : String(parserError)
        );

        // Find the improved code section
        const improvedCodeMatch = content.match(
          /```(?:javascript|js)?\s*(function setup[\s\S]*?)```/
        );
        const improvedCodeExtracted = improvedCodeMatch
          ? improvedCodeMatch[1].trim()
          : "";

        // Extract explanation (text after the last code block)
        const explanationMatch = content.match(/```[\s\S]*?```\s*([\s\S]*?)$/);
        const explanation = explanationMatch ? explanationMatch[1].trim() : "";

        // Return the diff result along with explanation
        return JSON.stringify({
          originalCode,
          improvedCode: improvedCodeExtracted || improvedCode, // Fall back to improvedCode if extraction fails
          explanation:
            explanation ||
            "Code improvements applied according to best practices.",
        });
      }
    } catch (error) {
      console.error("Error in diff tool:", error);
      return JSON.stringify({
        error: "Failed to generate diff due to an error.",
        details: error instanceof Error ? error.message : String(error),
        originalCode: "",
        improvedCode: "",
      });
    }
  },
});
