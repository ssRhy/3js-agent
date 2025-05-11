import { DynamicStructuredTool } from "@langchain/core/tools";
import { AzureChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { getCachedCode } from "@/lib/tools/applyPatchTool";
import { loadModelHistoryFromMemory } from "@/lib/memory/memoryManager";
import { ensureValidUrlsInCode } from "@/lib/processors/codeUrlValidator";

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
        "以下是已生成的3D模型URL，请在代码中直接引用这些hyper3d的URL以保持场景一致性：\n" +
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
    const requestId = `codegen_${Date.now()}`;
    const startTime = Date.now();
    console.log(
      `[${requestId}] [CodeGen Tool] 🚀 Agent请求生成/修复代码 - ${new Date().toISOString()}`
    );
    console.log(
      `[${requestId}] [CodeGen Tool] 📝 指令内容: "${instruction.substring(
        0,
        100
      )}${instruction.length > 100 ? "..." : ""}"`
    );

    // 检测是否是来自截图分析的请求
    const isFromScreenshotAnalysis =
      instruction.includes("截图分析") ||
      instruction.includes("分析结果") ||
      instruction.includes("needs_improvements") ||
      instruction.includes("场景需要调整");

    if (isFromScreenshotAnalysis) {
      console.log(
        `[${requestId}] [CodeGen Tool] 🖼️ 检测到基于截图分析的代码修复请求`
      );
    }

    try {
      // 获取模型历史，确保在生成代码时引用这些模型
      console.log(`[${requestId}] [CodeGen Tool] 📚 正在获取模型历史数据...`);
      const modelHistorySection = await formatModelHistoryForPrompt();
      console.log(
        `[${requestId}] [CodeGen Tool] ✅ 模型历史数据获取完成，包含 ${
          modelHistorySection.split("\n").length - 4 > 0
            ? modelHistorySection.split("\n").length - 4
            : 0
        } 个模型`
      );

      const prompt = `作为Three.js专家，请根据以下指令生成或修复代码：

${instruction}

${modelHistorySection}

要求：
1. 代码必须是可直接执行的JavaScript代码，使用Three.js库
2. 使用function setup(scene, camera, renderer, THREE, OrbitControls) { ... } 函数格式
3. 所有交互控制器只能用OrbitControls.create(camera, renderer.domElement)方式创建
4. 最后一行：return scene.
5. 永远不要直接使用new OrbitControls()，必须通过OrbitControls.create(camera, renderer.domElement)创建或获取控制器
6. 保持setup函数结构不变
7. 记住，模型不要重复放在同一个地方
8. 场景可以保留多个模型，确保generate_3d_model生成的模型不会重叠在一起，根据模型实际包围盒大小，自动计算合适的缩放因子，参考周围物体，模型位置摆放符合生活实际。
9. 返回scene对象或主要mesh
10. 确保功能完整、代码规范，只用generate_3d_model返回的url。
11. 不要重复声明变量名，多个材质，建议使用不同名字区分
12.threejs代码构建简单物体可以寻找在线有效的url库
13. 确保所有URL正确有效，可以通过浏览器访问。无效URL会导致场景无法加载
14. 如果用户要求删除场景中的特定物体，请识别该物体并在代码中移除相关创建和添加语句
15. 删除物体时，请确保从场景或其父对象中正确移除 (使用parent.remove(object))
16. 当需要识别物体时，可以使用物体的类型、颜色、位置或其他特征进行匹配

⚠️ 注意：你的回答必须只包含可执行的threejs代码，不要包含任何解释、思考过程或描述性文本。不要使用markdown代码块标记。不要加任何前缀或后缀。直接返回可执行的setup函数代码。`;

      // 调用LLM生成或修改代码
      console.log(`[${requestId}] [CodeGen Tool] 🤖 调用LLM生成代码...`);
      const llmCallStartTime = Date.now();
      const result = await codeGenModel.invoke(prompt);
      const llmResponseTime = Date.now();

      console.log(
        `[${requestId}] [CodeGen Tool] ✅ LLM响应完成，耗时: ${
          llmResponseTime - llmCallStartTime
        }ms`
      );

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
          console.log(
            `[${requestId}] [CodeGen Tool] ℹ️ 从markdown代码块中提取代码`
          );
        }
      }

      // 确保代码是setup函数格式
      if (!improvedCode.startsWith("function setup")) {
        console.log(
          `[${requestId}] [CodeGen Tool] ⚠️ 生成的代码不是setup函数格式，添加封装`
        );
        improvedCode = `function setup(scene, camera, renderer, THREE, OrbitControls) {
  ${improvedCode}
  // Return the main object or scene
  return scene.children.find(child => child instanceof THREE.Mesh) || scene;
}`;
      }

      // 获取原始缓存代码
      const originalCode = getCachedCode() || "";
      console.log(
        `[${requestId}] [CodeGen Tool] ℹ️ 获取到原始代码, 长度: ${originalCode.length} 字符`
      );

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
                `[${requestId}] [CodeGen Tool] 🔄 保留模型URL: ${model.modelUrl.substring(
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
          console.log(`[${requestId}] [CodeGen Tool] ✅ 已保留历史模型URL`);
        }
      }

      // URL验证：检查代码中的URL是否可访问，如果不可访问则清理
      console.log(`[${requestId}] [CodeGen Tool] 🔍 验证代码中的URL...`);
      const validationStartTime = Date.now();
      const validatedCode = await ensureValidUrlsInCode(improvedCode);

      if (validatedCode !== improvedCode) {
        console.log(`[${requestId}] [CodeGen Tool] ⚠️ 检测到无效URL并已修正`);
        improvedCode = validatedCode;
      } else {
        console.log(`[${requestId}] [CodeGen Tool] ✅ 代码中所有URL验证通过`);
      }
      console.log(
        `[${requestId}] [CodeGen Tool] URL验证耗时: ${
          Date.now() - validationStartTime
        }ms`
      );

      const totalTime = Date.now() - startTime;
      console.log(
        `[${requestId}] [CodeGen Tool] 🏁 代码生成完成，总耗时: ${totalTime}ms，代码长度: ${improvedCode.length} 字符`
      );

      if (isFromScreenshotAnalysis) {
        console.log(
          `[${requestId}] [CodeGen Tool] 🔄 已完成基于截图分析的代码修复`
        );
      }

      // 返回生成的代码
      const finalResponse = JSON.stringify({
        code: improvedCode,
        originalCode: originalCode,
        status: "success",
        message: "Successfully generated Three.js code",
        isFirstGeneration: true,
      });

      // After code generation, add a hint to the agent about object persistence
      const sceneState = {
        // Add scene state extraction logic here
      };
      const userPrompt = instruction;
      const persistenceHint =
        `\n\n// 注意：生成代码后，调用write_to_chroma工具将场景对象保存到ChromaDB\n` +
        `// 示例: { \"tool\": \"write_to_chroma\", \"params\": { \"objects\": ${JSON.stringify(
          sceneState
        )}, \"prompt\": "${userPrompt}" } }`;

      return finalResponse + persistenceHint;
    } catch (error) {
      const totalTime = Date.now() - startTime;
      console.error(
        `[${requestId}] [CodeGen Tool] ❌ 代码生成失败，错误: ${error}, 耗时: ${totalTime}ms`
      );
      throw error;
    }
  },
});
