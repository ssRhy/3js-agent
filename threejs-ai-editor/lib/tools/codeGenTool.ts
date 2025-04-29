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
  description:
    "生成或修复基于用户提示的Three.js代码。提供完整的setup函数代码。",
  schema: z.object({
    instruction: z.string().describe("要实现的功能或需要修复的问题描述"),
  }),
  func: async ({ instruction }) => {
    try {
      const prompt = `作为Three.js专家，请根据以下指令生成或修复代码：

${instruction}

要求：
1. 代码必须是可直接执行的JavaScript代码，使用Three.js库
2. 使用function setup(scene, camera, renderer, THREE, OrbitControls) { ... } 函数格式
3. 所有交互控制器只能用OrbitControls.create(camera, renderer.domElement)方式创建
4. 返回scene.children.find(child => child instanceof THREE.Mesh) || scene;
6.永远不要直接使用new OrbitControls()，必须通过OrbitControls.create(camera, renderer.domElement)创建或获取控制器
7.结构保持**：保持setup函数结构不变
8.
"\n记住，模型不要重复放在同一个地方" +
      "\n记住，场景可以保留多个模型，不要generate_3d_model生成的模型重叠在一起。" +
      "\n\n# 重要规则\n" +
      记住，模型不要重复放在同一个地方，为每个新模型设置唯一的位置坐标
8. 场景可以保留多个模型，确保generate_3d_model生成的模型不会重叠在一起
      "- **直接返回可完整（有上下文）执行代码**：无论任何情况，最终必须只返回可执行的threejs代码，不要返回思考过程、解释或列表\n" +
9. 确保功能完整、代码规范


注意：你的回答必须只包含可执行的JavaScript代码，不要包含任何解释或描述性文本。不要使用markdown代码块标记。`;

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
        originalCode: getCachedCode(),
        status: "success",
        message: "Successfully generated Three.js code",
        isFirstGeneration: true,
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
