import { AzureChatOpenAI } from "@langchain/openai";
import { AgentExecutor, createOpenAIToolsAgent } from "langchain/agents";
import {
  MessagesPlaceholder,
  HumanMessagePromptTemplate,
  SystemMessagePromptTemplate,
  ChatPromptTemplate,
} from "@langchain/core/prompts";
import { lintTool } from "@/lib/tools/lintTool";
import { diffTool } from "@/lib/tools/diffTool";
import { applyPatchTool } from "@/lib/tools/applyPatchTool";
import { codeGenTool } from "@/lib/tools/codeGenTool";
import { HumanMessage } from "@langchain/core/messages";
import { NextApiRequest, NextApiResponse } from "next";
import { DynamicTool } from "@langchain/core/tools";
import { StructuredTool } from "langchain/tools";

// Define custom interface for AgentExecutor with callbacks
interface CustomAgentExecutor extends AgentExecutor {
  onToolStart?: (tool: StructuredTool, input: string) => Promise<void>;
  onToolEnd?: (output: { tool: string; result: string }) => Promise<void>;
  onToolError?: (tool: StructuredTool, error: Error) => Promise<string | null>;
}

// Initialize Azure OpenAI client
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

/**
 * Generate initial code based on user instructions
 * Only called once during the first interaction
 */
export async function generate_code(instruction: string): Promise<string> {
  try {
    console.log("Generating initial code based on instruction...");
    const result = await codeGenTool.func(instruction);

    // 解析JSON结果
    const jsonResult = JSON.parse(result);
    return jsonResult.code;
  } catch (error) {
    console.error("Error generating initial code:", error);
    // Return default code if generation fails
    return `function setup(scene, camera, renderer, THREE, OrbitControls) {
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      const cube = new THREE.Mesh(geometry, material);
      scene.add(cube);
      return cube;
    }`;
  }
}

/**
 * Directly analyze screenshot using LLM without the agent loop
 * Used for subsequent interactions
 */
export async function analyzeScreenshotDirectly(
  screenshotBase64: string,
  currentCode: string
): Promise<string> {
  try {
    console.log("Analyzing screenshot directly...");

    const prompt = `Analyze this Three.js scene screenshot and suggest code improvements:
    
Current code:
\`\`\`javascript
${currentCode}
\`\`\`

Based on the screenshot (provided as base64), suggest specific Three.js code changes to improve the scene.
Focus on visual improvements, object positioning, lighting, materials, and user interaction.`;

    // Create a message with multimodal content (text + image)
    const message = new HumanMessage({
      content: [
        { type: "text", text: prompt },
        {
          type: "image_url",
          image_url: {
            url: screenshotBase64.startsWith("data:")
              ? screenshotBase64
              : `data:image/png;base64,${screenshotBase64}`,
          },
        },
      ],
    });

    const result = await model.invoke([message]);

    // Handle different types of content responses
    let contentText = "";
    if (typeof result.content === "string") {
      contentText = result.content;
    } else if (Array.isArray(result.content)) {
      contentText = result.content
        .filter(
          (item) =>
            typeof item === "object" && "type" in item && item.type === "text"
        )
        .map((item) => {
          if ("text" in item) {
            return item.text as string;
          }
          return "";
        })
        .join("\n");
    } else {
      contentText = JSON.stringify(result.content);
    }

    return contentText;
  } catch (error) {
    console.error("Error analyzing screenshot:", error);
    return "Could not analyze the screenshot. Please try again.";
  }
}

/**
 * Main agent function that handles the optimization loop
 * This creates an agent that uses the tools to improve the code
 */
export async function runAgentLoop(
  suggestion: string,
  currentCode: string,
  maxIterations = 3
): Promise<string> {
  // 保存当前代码状态
  let currentCodeState = currentCode;

  // 创建具有代码状态的工具包装器
  const wrappedDiffTool = new DynamicTool({
    name: diffTool.name,
    description: diffTool.description,
    func: async (input: string) => {
      // 尝试解析输入
      try {
        // Just try to parse, it doesn't matter what we do with parsed here
        JSON.parse(input);
        // 继续使用原始工具
        return await diffTool.func(input);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_) {
        // 如果输入不是JSON，假设它是改进后的代码
        const formattedInput = JSON.stringify({
          originalCode: currentCodeState,
          improvedCode: input.trim(),
        });
        return await diffTool.func(formattedInput);
      }
    },
  });

  // 工具集合现在使用包装后的diffTool
  const loopTools = [lintTool, wrappedDiffTool, applyPatchTool];

  // Create system message for the agent
  const systemMessage = SystemMessagePromptTemplate.fromTemplate(
    "你是专业的Three.js代码优化AI助手。请按照精确的步骤工作：\n" +
      "1. 工具使用说明：\n" +
      "   - diff_code：必须使用格式 包含originalCode和improvedCode的JSON对象\n" +
      "   - lint_with_llm：检查代码质量，输入为 包含code属性的JSON对象\n" +
      "   - apply_patch：应用补丁，输入为 包含code和patch属性的JSON对象\n" +
      "2. 工作流程：\n" +
      "   - 先用diff_code对比原始代码和改进代码\n" +
      "   - 然后用lint_with_llm检查改进后的代码\n" +
      "   - 如有必要，再次改进并使用diff_code\n" +
      "   - 最后用apply_patch应用最终修改\n" +
      "3. 重要规则：\n" +
      "   - 不要嵌套JSON或添加额外字段\n" +
      "   - 不要在输入中添加Markdown格式或注释\n" +
      "   - 当代码没有lint错误或尝试修复3次后停止循环"
  );

  // Create human message template
  const humanPrompt =
    "按照以下步骤优化Three.js代码：\n\n" +
    "1. 用diff_code生成改进代码。使用包含originalCode和improvedCode的JSON对象\n" +
    "2. 用lint_with_llm检查代码\n" +
    "3. 根据需要修复问题并重新使用diff_code\n" +
    "4. 最后使用apply_patch应用更改\n\n" +
    "当前代码：```javascript\n{currentCode}\n```\n\n" +
    "截图分析：\n{suggestion}\n\n" +
    "注意: 保持setup函数结构，只在没有lint错误或无法进一步优化时停止循环";

  // Create the prompt template
  const promptTemplate = ChatPromptTemplate.fromMessages([
    systemMessage,
    HumanMessagePromptTemplate.fromTemplate(humanPrompt),
    new MessagesPlaceholder("agent_scratchpad"),
  ]);

  try {
    // Create the agent
    const agent = await createOpenAIToolsAgent({
      llm: model,
      tools: loopTools,
      prompt: promptTemplate,
    });

    // Create executor
    const executor = new AgentExecutor({
      agent,
      tools: loopTools,
      maxIterations,
      verbose: true,
      handleParsingErrors: true,
      returnIntermediateSteps: true,
    }) as CustomAgentExecutor;

    // 跟踪执行中的代码更新
    executor.onToolEnd = async (output) => {
      if (output.tool === "apply_patch") {
        try {
          const result = JSON.parse(output.result);
          if (result.success && result.updatedCode) {
            currentCodeState = result.updatedCode;
          }
        } catch (e) {
          console.error("Failed to parse apply_patch result:", e);
        }
      }
    };

    // 添加工具调用拦截
    executor.onToolStart = async (tool, input) => {
      console.log(`Starting tool ${tool.name} with input:`, input);
      if (tool.name === "diff_code" && !input.includes("originalCode")) {
        console.warn(
          "Warning: diff_code tool called without proper JSON format"
        );
      }
    };

    executor.onToolError = async (tool, error) => {
      console.error(`Error in tool ${tool.name}:`, error);

      // 对于 diffTool 错误，尝试恢复
      if (tool.name === "diff_code") {
        return JSON.stringify({
          error: "工具调用失败，请确保提供正确格式的输入",
          details: error.message,
        });
      }

      return null; // 其他工具错误由 AgentExecutor 处理
    };

    // 执行agent
    const result = await executor.invoke({
      suggestion,
      currentCode: currentCodeState,
    });

    // Extract and clean the output
    let output = result.output as string;

    // Clean code - remove HTML structure if present
    if (output.includes("<!DOCTYPE html>") || output.includes("<html>")) {
      const scriptMatch = output.match(/<script>([\s\S]*?)<\/script>/);
      if (scriptMatch && scriptMatch[1]) {
        output = scriptMatch[1].trim();
      }
    }

    // Remove Markdown code blocks
    if (output.includes("```")) {
      const codeBlockMatch = output.match(/```(?:js|javascript)?([\s\S]*?)```/);
      if (codeBlockMatch && codeBlockMatch[1]) {
        output = codeBlockMatch[1].trim();
      }
    }

    // Ensure code is a setup function
    if (!output.includes("function setup")) {
      output = `function setup(scene, camera, renderer, THREE, OrbitControls) {
        ${output}
        return scene.children.find(child => child instanceof THREE.Mesh) || scene;
      }`;
    }

    return output;
  } catch (error) {
    console.error("Error running agent loop:", error);
    return currentCode; // 出错时返回原始代码
  }
}

/**
 * Default export function for the API route
 * Handles API requests based on the request method and body
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    // Extract parameters from the request body
    // The client sends 'prompt', 'currentCode', and 'image' (screenshot base64)
    const { prompt, currentCode, image } = req.body;

    if (req.method === "POST") {
      // Initial code generation (when only prompt is provided)
      if (prompt && !currentCode) {
        const generatedCode = await generate_code(prompt);
        return res.status(200).json({ directCode: generatedCode });
      }

      // Screenshot analysis and code improvement
      if (image && currentCode) {
        // First analyze the screenshot directly
        const suggestion = await analyzeScreenshotDirectly(image, currentCode);

        // Then run the agent loop to implement improvements
        const improvedCode = await runAgentLoop(suggestion, currentCode);

        return res.status(200).json({
          directCode: improvedCode,
          suggestion,
        });
      }

      return res.status(400).json({ error: "Missing required parameters" });
    }

    // Method not allowed
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("API handler error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
