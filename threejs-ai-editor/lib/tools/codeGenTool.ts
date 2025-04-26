import { DynamicStructuredTool } from "@langchain/core/tools";
import { AzureChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { getCachedCode } from "./applyPatchTool";

// Initialize Azure OpenAI client for code generation
const codeGenModel = new AzureChatOpenAI({
  model: "gpt-4.1",
  temperature: 0.2, // Slightly higher temperature for more creative code generation
  azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
  azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
  azureOpenAIApiVersion: "2024-12-01-preview",
  azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
  azureOpenAIEndpoint: process.env.AZURE_OPENAI_API_ENDPOINT,
});

/**
 * Process LLM response content - supports string or array format
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
 * Code Generation Tool - Generates initial Three.js code or fixes existing code based on errors
 */
export const codeGenTool = new DynamicStructuredTool({
  name: "generate_fix_code",
  description: "Generate or modify Three.js code based on instruction",
  schema: z.object({
    instruction: z.string().describe("用户指令或代码修复要求"),
    code: z
      .string()
      .optional()
      .describe("当前代码，如不提供则使用系统缓存中的代码"),
  }),
  func: async ({ instruction, code }) => {
    try {
      console.log("Processing Three.js code request...");

      // 确定当前代码：优先使用传入的code，否则使用缓存的代码
      const currentCode = code || getCachedCode();
      const isInitialGeneration = !currentCode;

      // 根据情况生成提示语
      let prompt: string;

      if (isInitialGeneration) {
        // 首次生成代码
        prompt = `You are a Three.js expert. Generate complete, functional Three.js code 
based on the following user instructions:

"${instruction}"

Requirements for generation:
1. Create a complete "function setup(scene, camera, renderer, THREE, OrbitControls) { ... }" function
2. The function must properly use the provided scene, camera, and renderer parameters
3. Add appropriate lighting, materials, and objects as required by the instructions
4. Include any necessary animation or interaction logic
5. Return the main object/scene at the end of the function
6. Do not include imports or other code outside the function
7. Ensure the code follows Three.js best practices
8. Ensure the code is clean, optimized, and well-structured

Return ONLY the complete code without explanations or markdown formatting.
The code should be ready to run immediately.`;
      } else {
        // 修复或改进现有代码
        prompt = `You are a Three.js expert. Fix or improve the Three.js code based on the following requirement:

"${instruction}"

Here is the current code:
\`\`\`javascript
${currentCode}
\`\`\`

Requirements for fixing/improving:
1. Maintain the setup function structure: "function setup(scene, camera, renderer, THREE, OrbitControls) { ... }"
2. Address the specific requirement or issue mentioned
3. Keep all existing functionality that is working correctly
4. Ensure the code is clean, optimized, and follows Three.js best practices
5. Return the complete improved function, ready to run immediately

Return ONLY the complete code without explanations or markdown formatting.`;
      }

      // 调用LLM生成或修改代码
      const result = await codeGenModel.invoke(prompt);
      const responseContent = handleLLMResponseContent(result.content);

      // 提取生成的代码
      let improvedCode = responseContent.trim();

      // 移除代码块标记（如果有）
      if (improvedCode.includes("```")) {
        const codeMatch = improvedCode.match(
          /```(?:js|javascript)?\s*([\s\S]*?)```/
        );
        if (codeMatch && codeMatch[1]) {
          improvedCode = codeMatch[1].trim();
        }
      }

      // 确保代码是setup函数格式
      if (!improvedCode.startsWith("function setup")) {
        improvedCode = `function setup(scene, camera, renderer, THREE, OrbitControls) {
  ${improvedCode}
  // Return the main object or scene
  return scene.children.find(child => child instanceof THREE.Mesh) || scene;
}`;
      }

      // 返回生成的代码
      return JSON.stringify({
        code: improvedCode,
        originalCode: currentCode,
        status: "success",
        message: isInitialGeneration
          ? "Successfully generated Three.js code"
          : "Successfully improved Three.js code",
        isFirstGeneration: isInitialGeneration,
      });
    } catch (error) {
      console.error("Failed to generate or modify Three.js code:", error);
      return JSON.stringify({
        status: "error",
        message: `Failed to generate or modify Three.js code: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  },
});
