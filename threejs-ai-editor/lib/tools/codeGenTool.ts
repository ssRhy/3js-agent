import { DynamicTool } from "@langchain/core/tools";
import { AzureChatOpenAI } from "@langchain/openai";

// Initialize Azure OpenAI client for code generation
const codeGenModel = new AzureChatOpenAI({
  model: "gpt-4o",
  temperature: 0.2, // Slightly higher temperature for more creative code generation
  azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
  azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
  azureOpenAIApiVersion: "2024-02-15-preview",
  azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
  azureOpenAIEndpoint: process.env.AZURE_OPENAI_API_ENDPOINT,
  maxTokens: 4000,
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
 * Code Generation Tool - Generates initial Three.js code based on user instructions
 * Only used during the first interaction to create the base code
 */
export const codeGenTool = new DynamicTool({
  name: "generate_code",
  description: "生成初始Three.js代码，基于用户指令",
  func: async (instruction: string): Promise<string> => {
    try {
      console.log("Generating initial Three.js code...");

      // Generate initial Three.js code based on user instructions
      const prompt = `You are a Three.js expert. Generate a complete, functional Three.js setup function 
based on the following user instructions:

"${instruction}"

Requirements:
1. The code must be a complete "function setup(scene, camera, renderer, THREE, OrbitControls) { ... }" function
2. The function must properly use the provided scene, camera, and renderer parameters
3. Add appropriate lighting, materials, and objects as required by the instructions
4. Include any necessary animation or interaction logic
5. Return the main object/scene at the end of the function
6. Do not include imports or other code outside the function
7. Ensure the code follows Three.js best practices
8. Ensure the code is clean, optimized, and well-structured

Return ONLY the complete code without explanations or markdown formatting.
The code should be ready to run immediately.`;

      const result = await codeGenModel.invoke(prompt);
      const responseContent = handleLLMResponseContent(result.content);

      // Extract code from the response
      let code = responseContent.trim();

      // Remove markdown code blocks if present
      if (code.includes("```")) {
        const codeMatch = code.match(/```(?:js|javascript)?\s*([\s\S]*?)```/);
        if (codeMatch && codeMatch[1]) {
          code = codeMatch[1].trim();
        }
      }

      // Ensure the code is a setup function
      if (!code.startsWith("function setup")) {
        code = `function setup(scene, camera, renderer, THREE, OrbitControls) {
  ${code}
  // Return the main object or scene
  return scene.children.find(child => child instanceof THREE.Mesh) || scene;
}`;
      }

      // 返回JSON格式结果
      return JSON.stringify({
        code,
        status: "success",
        message: "已成功生成Three.js代码",
      });
    } catch (error) {
      console.error("Error in code generation tool:", error);
      // 返回错误信息和备用代码
      const fallbackCode = `function setup(scene, camera, renderer, THREE, OrbitControls) {
  // Basic fallback code - a simple colored cube
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);
  
  // Add some basic lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);
  
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.position.set(5, 5, 5);
  scene.add(directionalLight);
  
  return cube;
}`;

      return JSON.stringify({
        code: fallbackCode,
        status: "error",
        message: `代码生成出错: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  },
});
