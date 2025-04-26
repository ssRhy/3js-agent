import { AzureChatOpenAI } from "@langchain/openai";
import { createOpenAIFunctionsAgent, AgentExecutor } from "langchain/agents";
import {
  MessagesPlaceholder,
  HumanMessagePromptTemplate,
  ChatPromptTemplate,
} from "@langchain/core/prompts";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { BufferMemory } from "langchain/memory";
import { createPatch } from "diff";

import {
  applyPatchTool,
  loadFromMemory,
  getPatchHistory,
  PatchRecord,
} from "@/lib/tools/applyPatchTool";
import { codeGenTool } from "@/lib/tools/codeGenTool";
import { NextApiRequest, NextApiResponse } from "next";

import { StructuredTool } from "@langchain/core/tools";

// 创建内存实例，用于存储agent的工作状态
const agentMemory = new BufferMemory({
  memoryKey: "codeState",
  inputKey: "userPrompt",
  returnMessages: false,
  outputKey: "codeStateContext",
});

// Define custom interface for AgentExecutor with callbacks
interface CustomAgentExecutor extends AgentExecutor {
  onToolStart?: (tool: StructuredTool, input: string) => Promise<void>;
  onToolEnd?: (output: { tool: string; result: string }) => Promise<void>;
  onToolError?: (tool: StructuredTool, error: Error) => Promise<string | null>;
}

// Interface for ESLint errors
interface LintError {
  ruleId: string | null;
  severity: number;
  message: string;
  line: number;
  column: number;
}

// Initialize Azure OpenAI client
const model = new AzureChatOpenAI({
  modelName: "gpt-4.1",
  temperature: 0,
  azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
  azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
  azureOpenAIApiVersion: "2024-12-01-preview",
  azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
  azureOpenAIEndpoint: process.env.AZURE_OPENAI_API_ENDPOINT,
});

/**
 * Generate initial code based on user instructions
 * Only called once during the first interaction
 */

/**
 * Directly analyze screenshot using LLM without the agent loop
 * Used for subsequent interactions
 */
export async function analyzeScreenshotDirectly(
  screenshotBase64: string,
  currentCode: string,
  userPrompt: string = "",
  lintErrors?: LintError[]
): Promise<string> {
  try {
    console.log("Analyzing screenshot directly...");

    // Format lint errors for the prompt if available
    let lintErrorsText = "";
    if (lintErrors && lintErrors.length > 0) {
      lintErrorsText = `\n\nESLint errors found in current code:\n${lintErrors
        .map(
          (err) =>
            `Line ${err.line}:${err.column} - ${err.message} (${
              err.ruleId || "unknown rule"
            })`
        )
        .join("\n")}`;
    }

    // 从内存中获取历史上下文
    let historyContext = "";
    try {
      const memoryVariables = await agentMemory.loadMemoryVariables({});
      if (memoryVariables.codeState) {
        historyContext = `\n\n历史上下文:\n${memoryVariables.codeState}\n`;
      }
    } catch (memoryError) {
      console.warn("Failed to load memory:", memoryError);
    }

    // 获取patch历史
    const patchHistoryItems = getPatchHistory();
    let patchHistoryText = "";
    if (patchHistoryItems.length > 0) {
      patchHistoryText =
        "\n\n最近的代码修改历史:\n" +
        patchHistoryItems
          .map(
            (item: PatchRecord) =>
              `- ${item.timestamp}: ${item.description || "应用补丁"}`
          )
          .join("\n");
    }

    const prompt = `Analyze this Three.js scene screenshot and suggest code improvements:
    
Current code:
\`\`\`javascript
${currentCode}
\`\`\`

User requirements:
${
  userPrompt || "No specific requirements provided"
}${lintErrorsText}${historyContext}${patchHistoryText}

Based on the screenshot (provided as base64), the ESLint errors, and the user requirements, suggest specific Three.js code changes to improve the scene.
Focus on implementing the user requirements while also fixing any code quality issues highlighted by ESLint.
If there are ESLint errors, make sure to address them in your solution.`;

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

    // 保存分析结果到内存
    await agentMemory.saveContext(
      { userPrompt },
      {
        codeState: `分析图像后的建议: ${contentText.substring(0, 200)}...`,
        lastAnalysisTimestamp: new Date().toISOString(),
      }
    );

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
  maxIterations = 5,
  userPrompt: string = "",
  historyContext: string = "",
  lintErrors?: LintError[]
): Promise<string> {
  // 保存当前代码状态
  let currentCodeState = currentCode;

  // 尝试从内存加载最新状态
  try {
    const memoryState = await loadFromMemory();
    if (memoryState.latestCode) {
      console.log("从内存加载最新代码状态");
      // 只有当内存中的代码和当前代码不同时才更新
      if (memoryState.latestCode !== currentCode) {
        console.log("内存中的代码与当前代码不同，使用最新状态");
        currentCodeState = memoryState.latestCode;
      }
    }
  } catch (memoryError) {
    console.warn("Failed to load from memory:", memoryError);
  }

  // 在函数内部定义处理工具输入的函数
  function prepareToolInput(toolName: string, input: string): string {
    if (toolName === "apply_patch") {
      try {
        // 尝试解析为对象
        const inputObj = JSON.parse(input);

        // 如果是嵌套的input字段，提取出来
        if (inputObj.input && typeof inputObj.input === "string") {
          if (inputObj.input.startsWith("{") && inputObj.input.endsWith("}")) {
            try {
              // 尝试解析内部JSON
              const innerObj = JSON.parse(inputObj.input);

              // 如果包含originalCode和improvedCode，转换为正确的格式
              if (innerObj.originalCode && innerObj.improvedCode) {
                // 首次调用，使用code参数传递完整代码
                if (!currentCodeState || currentCodeState === "") {
                  console.log("First-time call, using full code");
                  return JSON.stringify({
                    code: innerObj.improvedCode,
                    description: `Initial code based on user prompt: ${userPrompt.substring(
                      0,
                      50
                    )}...`,
                  });
                } else {
                  // 后续调用，生成并使用patch
                  console.log("Subsequent call, generating patch");
                  const patch = createPatch(
                    "code.js",
                    currentCodeState,
                    innerObj.improvedCode
                  );

                  return JSON.stringify({
                    patch,
                    description: `Patch generated for: ${userPrompt.substring(
                      0,
                      50
                    )}...`,
                  });
                }
              }

              return JSON.stringify(innerObj);
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
            } catch (e) {
              // 如果无法解析，返回原始输入
              return input;
            }
          }
        }

        // 如果直接包含originalCode和improvedCode，转换为正确的格式
        if (inputObj.originalCode && inputObj.improvedCode) {
          // 首次调用，使用code参数传递完整代码
          if (!currentCodeState || currentCodeState === "") {
            console.log("First-time direct call, using full code");
            return JSON.stringify({
              code: inputObj.improvedCode,
              description: `Initial full code: ${userPrompt.substring(
                0,
                50
              )}...`,
            });
          } else {
            // 后续调用，生成patch
            console.log("Subsequent direct call, generating patch");
            const patch = createPatch(
              "code.js",
              currentCodeState,
              inputObj.improvedCode
            );

            return JSON.stringify({
              patch,
              description: `Incremental patch: ${userPrompt.substring(
                0,
                50
              )}...`,
            });
          }
        }

        // 如果已经是正确格式，直接返回
        if (inputObj.code || inputObj.patch) {
          // 如果没有description，添加一个
          if (!inputObj.description) {
            inputObj.description = `Update at ${new Date().toISOString()} - ${userPrompt.substring(
              0,
              30
            )}...`;
            return JSON.stringify(inputObj);
          }
          return input;
        }
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        // 解析失败，尝试检查是否包含原始代码和改进代码的字符串
        try {
          // 简单处理，如果字符串中包含明显的关键词，尝试解析
          if (
            input.includes("originalCode") &&
            input.includes("improvedCode")
          ) {
            const cleanedInput = input
              .replace(/\\"/g, '"')
              .replace(/^"|"$/g, "");
            const matches = cleanedInput.match(
              /"improvedCode"\s*:\s*"([^"]*)"/
            );

            if (matches && matches[1]) {
              console.log("Extracted improved code from string");

              // 首次调用使用完整代码，后续使用patch
              if (!currentCodeState || currentCodeState === "") {
                return JSON.stringify({
                  code: matches[1].replace(/\\n/g, "\n"),
                  description: `Extracted initial code`,
                });
              } else {
                const improvedCode = matches[1].replace(/\\n/g, "\n");
                const patch = createPatch(
                  "code.js",
                  currentCodeState,
                  improvedCode
                );

                return JSON.stringify({
                  patch,
                  description: `Extracted patch from improvedCode`,
                });
              }
            }
          }
        } catch (extractError) {
          console.error("Failed to extract code from string:", extractError);
        }

        // 解析失败，返回原始输入
        return input;
      }
    }

    // 特殊处理diff_code工具的输入
    if (toolName === "diff_code") {
      try {
        // 尝试解析为对象
        const inputObj = JSON.parse(input);

        // 处理嵌套的input字段
        if (inputObj.input && typeof inputObj.input === "string") {
          if (inputObj.input.startsWith("{") && inputObj.input.endsWith("}")) {
            try {
              // 尝试解析内部JSON
              const innerObj = JSON.parse(inputObj.input);

              // 确保输入格式正确
              if (innerObj.originalCode && innerObj.improvedCode) {
                // 正确格式化JSON字符串，确保特殊字符被正确转义
                return JSON.stringify({
                  input: JSON.stringify({
                    originalCode: innerObj.originalCode,
                    improvedCode: innerObj.improvedCode,
                    description: `Diff generated at ${new Date().toISOString()}`,
                  }),
                });
              }
            } catch (e) {
              console.error("解析内部JSON失败:", e);
            }
          }
        }

        // 已经是正确格式的情况
        if (inputObj.originalCode && inputObj.improvedCode) {
          return JSON.stringify({
            input: JSON.stringify({
              originalCode: inputObj.originalCode,
              improvedCode: inputObj.improvedCode,
              description: `Diff for update: ${userPrompt.substring(0, 30)}...`,
            }),
          });
        }
      } catch (e) {
        console.error("解析diff_code输入失败:", e);
      }
    }

    return input;
  }

  // Prepare lint errors message for the system prompt
  let lintErrorsMessage = "";
  if (lintErrors && lintErrors.length > 0) {
    lintErrorsMessage =
      "\n\n# ESLint 检查结果\n" +
      "在当前代码中发现以下 ESLint 错误：\n" +
      lintErrors
        .map(
          (err) =>
            `- 行 ${err.line}:${err.column} - ${err.message} (${
              err.ruleId || "未知规则"
            })`
        )
        .join("\n") +
      "\n\n请优先修复这些代码质量问题。";
  }

  // 加载补丁历史
  const patchHistoryItems = getPatchHistory();
  let patchHistoryText = "";
  if (patchHistoryItems.length > 0) {
    patchHistoryText =
      "\n\n# 补丁历史\n" +
      patchHistoryItems
        .map(
          (item: PatchRecord) =>
            `- ${item.timestamp}: ${item.description || "应用补丁"}`
        )
        .join("\n") +
      "\n\n请参考这些历史变更，确保新改动与之前的修改方向一致。";
  }

  // 工具集合现在使用包装后的diffTool
  const loopTools = [applyPatchTool, codeGenTool];

  // 创建系统消息，使用普通的SystemMessage而非模板
  const systemMessage = new SystemMessage(
    "你是专业的Three.js代码优化AI助手。以下是你的工作指南：\n\n" +
      "# 工具说明\n" +
      "- **generate_fix_code**：生成或修复代码，" +
      "- **apply_patch**：应用代码更新，" +
      "# 工作循环\n" +
      "请遵循以下增量迭代步骤进行代码优化：\n" +
      "1. **分析**：理解当前代码、截图分析的建议、接收ESLint错误报告和用户需求\n" +
      "2. **改进**：使用generate_fix_code工具生成优化后的完整代码，传入明确的用户需求\n" +
      "3. **应用更新**：使用apply_patch工具将改进后的代码应用到当前代码，" +
      "4. **实时检查**：根据ESLint反馈，修复代码质量问题，确保无语法错误\n" +
      "5. **迭代优化**：如需要进一步改进，返回第1步\n\n" +
      "# 重要规则\n" +
      "- **ESLint优先**：优先修复ESLint报告的代码问题，确保代码质量\n" +
      "- **迭代控制**：最多循环3次，或在无法进一步优化时提前结束\n" +
      "- **需求优先**：所有代码改进必须优先实现用户需求，然后才考虑其他优化\n" +
      "- **结构保持**：保持setup函数结构不变\n" +
      "- **控件创建**：永远不要直接使用new OrbitControls()，必须通过OrbitControls.create(camera, renderer.domElement)创建或获取控制器\n\n" +
      (lintErrorsMessage ? lintErrorsMessage + "\n\n" : "") +
      (patchHistoryText ? patchHistoryText + "\n\n" : "") +
      (historyContext
        ? "# 历史上下文\n" +
          historyContext +
          "\n\n请参考上述历史编辑记录，保持代码风格和功能一致性。\n"
        : "")
  );

  // 创建人类消息模板
  const humanPromptTemplate = HumanMessagePromptTemplate.fromTemplate(
    "请按照MDC模式和循环思考优化以下Three.js代码：\n\n```js\n{currentCode}\n```\n\n分析建议：\n{suggestion}\n\n用户需求：\n{userPrompt}"
  );

  // Create the prompt template
  const promptTemplate = ChatPromptTemplate.fromMessages([
    systemMessage,
    humanPromptTemplate,
    new MessagesPlaceholder("agent_scratchpad"),
  ]);

  try {
    // Create the agent
    const agent = await createOpenAIFunctionsAgent({
      llm: model,
      tools: loopTools,
      prompt: promptTemplate,
    });

    // Create executor
    const executor = AgentExecutor.fromAgentAndTools({
      agent,
      tools: loopTools,
      maxIterations,
      verbose: true,
      handleParsingErrors: true,
      returnIntermediateSteps: true,
    }) as CustomAgentExecutor;

    // 修改 onToolStart 函数来使用 prepareToolInput
    executor.onToolStart = async (tool, input) => {
      const normalizedInput = prepareToolInput(tool.name, input);
      console.log(`Starting tool ${tool.name} with input:`, normalizedInput);

      if (
        tool.name === "diff_code" &&
        !normalizedInput.includes("originalCode")
      ) {
        console.warn("Warning: diff_code called without proper JSON format");
      }
    };

    // 跟踪执行中的代码更新
    executor.onToolEnd = async (output) => {
      if (output.tool === "apply_patch") {
        try {
          const result = JSON.parse(output.result);
          if (result.success && result.updatedCode) {
            currentCodeState = result.updatedCode;

            // 更新agent的内存状态 - 将多个键值合并为一个对象
            await agentMemory.saveContext(
              { userPrompt },
              {
                codeStateContext: {
                  codeState: currentCodeState.substring(0, 200) + "...",
                  lastUpdateTimestamp: new Date().toISOString(),
                },
              }
            );
          }
        } catch (e) {
          console.error("Failed to parse apply_patch result:", e);
        }
      }
    };

    // 原始检查逻辑保持不变
    executor.onToolError = async (tool, error) => {
      console.error(`Error in tool ${tool.name}:`, error);

      // 对于 diffTool 错误，尝试恢复
      if (tool.name === "diff_code") {
        // 为agent提供明确的错误信息和恢复建议
        return JSON.stringify({
          error: "工具调用失败，JSON格式不正确",
          details: error.message,
          suggestion:
            "请确保使用正确的JSON格式。应使用以下格式调用diff_code工具：\n" +
            "1. 确保代码中的所有换行符和特殊字符都被正确转义\n" +
            '2. 使用正确的JSON结构: {"input":{"originalCode":"...","improvedCode":"..."}}\n' +
            "3. 可以尝试使用generate_fix_code工具先生成完整的改进代码，然后再使用diff_code工具",
        });
      } else if (tool.name === "apply_patch") {
        // 为apply_patch提供错误恢复信息
        return JSON.stringify({
          success: false,
          message: `应用补丁失败: ${error.message}`,
          suggestion:
            '请尝试直接使用{"input":{"originalCode":"...","improvedCode":"..."}}格式',
        });
      } else if (tool.name === "generate_fix_code") {
        // 为generate_fix_code提供错误恢复信息
        return JSON.stringify({
          status: "error",
          message: `代码生成失败: ${error.message}`,
          suggestion: "请简化指令，或分步骤实现改进",
        });
      }

      return null; // 其他工具错误由 AgentExecutor 处理
    };

    // 执行agent
    try {
      const result = await executor.invoke({
        suggestion,
        currentCode: currentCodeState,
        userPrompt: userPrompt || "无特定需求",
        historyContext: historyContext || "",
        lintErrors: lintErrors || [],
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
        const codeBlockMatch = output.match(
          /```(?:js|javascript)?([\s\S]*?)```/
        );
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

      // 最终更新agent的内存，存储完整的最终结果
      await agentMemory.saveContext(
        { userPrompt },
        {
          codeStateContext: {
            codeState: output,
            lastCompletionTimestamp: new Date().toISOString(),
            lastRequest: userPrompt,
          },
        }
      );

      return output;
    } catch (agentError) {
      console.error("Agent execution error:", agentError);

      // 当agent执行失败时，直接使用suggestion进行改进
      console.log("Falling back to direct code improvement...");

      // 尝试从suggestion中提取代码
      let improvedCode = "";
      if (suggestion.includes("```")) {
        const codeMatch = suggestion.match(
          /```(?:js|javascript)?\s*([\s\S]*?)```/
        );
        if (codeMatch && codeMatch[1]) {
          improvedCode = codeMatch[1].trim();
        }
      }

      // 如果没有提取到代码，尝试使用codeGenTool直接生成
      if (!improvedCode) {
        try {
          console.log("Using codeGenTool to generate improved code...");
          const instruction = `改进以下Three.js代码，实现用户需求: ${
            userPrompt || "无特定需求"
          }\n\n${currentCode}`;
          const codeGenResult = await codeGenTool.invoke({ instruction });
          const parsedResult = JSON.parse(codeGenResult);
          if (parsedResult.code) {
            improvedCode = parsedResult.code;
          }
        } catch (codeGenError) {
          console.error("codeGenTool failed:", codeGenError);
        }
      }

      // 如果还是没有代码，返回原始代码
      if (!improvedCode) {
        return currentCode;
      }

      // 记录回退结果到内存
      await agentMemory.saveContext(
        { userPrompt },
        {
          codeStateContext: {
            codeState: improvedCode,
            lastFallbackTimestamp: new Date().toISOString(),
            error: "Agent execution failed, used fallback",
          },
        }
      );

      return improvedCode;
    }
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
    // 添加prompt和historyContext参数提取
    const { currentCode, image, prompt, historyContext, lintErrors } = req.body;

    // Screenshot analysis and code improvement
    if (image && currentCode) {
      // 修改提示词，将用户需求添加到分析提示中
      const suggestion = await analyzeScreenshotDirectly(
        image,
        currentCode,
        prompt,
        lintErrors
      );

      // 将用户需求和历史上下文也传入到agent循环中
      const improvedCode = await runAgentLoop(
        suggestion,
        currentCode,
        5,
        prompt,
        historyContext,
        lintErrors
      );

      return res.status(200).json({
        directCode: improvedCode,
        suggestion,
      });
    }

    return res.status(400).json({ error: "Missing required parameters" });
  } catch (error) {
    console.error("Error handling API request:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
