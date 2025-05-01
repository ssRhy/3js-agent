import { DynamicStructuredTool } from "@langchain/core/tools";
import { AzureChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { getCachedCode } from "./applyPatchTool";
import { loadModelHistoryFromMemory } from "@/lib/memory/memoryManager";

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

// Add a function to format model history for inclusion in prompts
async function formatModelHistoryForPrompt(): Promise<string> {
  try {
    const modelHistory = await loadModelHistoryFromMemory();
    if (modelHistory && modelHistory.length > 0) {
      return (
        "\n# 可用的3D模型\n" +
        "以下是已生成的3D模型URL，请在代码中直接引用这些URL以保持场景一致性：\n" +
        modelHistory
          .map(
            (m: { modelUrl: string }, i: number) =>
              `- 模型${i + 1}: ${m.modelUrl}`
          )
          .join("\n") +
        "\n确保代码中包含这些模型。"
      );
    }
  } catch (error) {
    console.error("Failed to load model history:", error);
  }
  return "";
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
      // 获取模型历史，确保在生成代码时引用这些模型
      const modelHistorySection = await formatModelHistoryForPrompt();

      const prompt = `作为Three.js专家，请根据以下指令生成或修复代码：

${instruction}

${modelHistorySection}

要求：
1. 代码必须是可直接执行的JavaScript代码，使用Three.js库
2. 使用function setup(scene, camera, renderer, THREE, OrbitControls) { ... } 函数格式
3. 所有交互控制器只能用OrbitControls.create(camera, renderer.domElement)方式创建
4. 返回scene.children.find(child => child instanceof THREE.Mesh) || scene;
5. 永远不要直接使用new OrbitControls()，必须通过OrbitControls.create(camera, renderer.domElement)创建或获取控制器
6. 保持setup函数结构不变
7. 记住，模型不要重复放在同一个地方
8. 场景可以保留多个模型，确保generate_3d_model生成的模型不会重叠在一起
9. 返回scene对象或主要mesh
10. 确保功能完整、代码规范
11. 确保代码中包含所有模型URL

⚠️ 注意：你的回答必须只包含可执行的threejs代码，不要包含任何解释、思考过程或描述性文本。不要使用markdown代码块标记。不要加任何前缀或后缀。直接返回可执行的setup函数代码。`;

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

      // 获取原始缓存代码
      const originalCode = getCachedCode() || "";

      // 检查生成的代码是否包含模型URL，如果不包含，尝试从原始代码中提取并保留
      const modelHistory = await loadModelHistoryFromMemory();
      if (modelHistory && modelHistory.length > 0) {
        let hasPreservedModels = false;

        // 检查新代码是否包含了历史模型URL
        for (const model of modelHistory) {
          if (!improvedCode.includes(model.modelUrl)) {
            // 如果生成的代码不包含此URL，检查原始代码是否包含
            if (originalCode.includes(model.modelUrl)) {
              // 如果原始代码包含但新代码不包含，我们需要确保保留这个模型
              console.log(
                `Preserving model URL in code: ${model.modelUrl.substring(
                  0,
                  30
                )}...`
              );

              // 简单方法：在代码开头添加注释确保模型URL被包含
              const modelComment = `  // MODEL_URL: ${model.modelUrl}\n`;

              // 在setup函数的第一行之后插入
              improvedCode = improvedCode.replace(
                /function setup\([^)]*\)\s*{/,
                `$&\n${modelComment}  // 保留之前生成的模型 - ${new Date().toISOString()}`
              );

              hasPreservedModels = true;
            }
          }
        }

        if (hasPreservedModels) {
          console.log("Preserved model URLs from history in generated code");
        }
      }

      // 返回生成的代码
      return JSON.stringify({
        code: improvedCode,
        originalCode: originalCode,
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
