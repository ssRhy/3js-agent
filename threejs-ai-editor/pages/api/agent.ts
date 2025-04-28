import { AzureChatOpenAI } from "@langchain/openai";
import { createOpenAIFunctionsAgent, AgentExecutor } from "langchain/agents";
import {
  MessagesPlaceholder,
  HumanMessagePromptTemplate,
  ChatPromptTemplate,
  SystemMessagePromptTemplate,
} from "@langchain/core/prompts";
import { CallbackManager } from "@langchain/core/callbacks/manager";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { BufferMemory } from "langchain/memory";
import { createPatch } from "diff";
import { HumanMessage } from "@langchain/core/messages";
import { applyPatchTool, getCachedCode } from "@/lib/tools/applyPatchTool";
import { codeGenTool } from "@/lib/tools/codeGenTool";
import { modelGenTool } from "@/lib/tools/modelGenTool";
import { NextApiRequest, NextApiResponse } from "next";

// Store constants for better maintainability
// Maximum characters to store in memory
const MAX_ITERATIONS = 10; // Default max iterations for agent loop

// Interface for ESLint errors
interface LintError {
  ruleId: string | null;
  severity: number;
  message: string;
  line: number;
  column: number;
}

// Custom callback handler for agent execution
class AgentCallbackHandler extends BaseCallbackHandler {
  currentCodeState: string;
  agentMemory: BufferMemory;
  userPrompt: string;
  name = "AgentCallbackHandler"; // Implement the abstract name property

  constructor(initialCode: string, memory: BufferMemory, userPrompt: string) {
    super();
    this.currentCodeState = initialCode;
    this.agentMemory = memory;
    this.userPrompt = userPrompt;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async handleToolStart(data: any) {
    const normalizedInput = this.prepareToolInput(data.name, data.input);
    console.log(`Starting tool ${data.name} with input:`, normalizedInput);
    return normalizedInput;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async handleToolEnd(data: any) {
    if (data.name === "apply_patch") {
      await this.processApplyPatchResult(data.output);
    } else if (data.name === "generate_3d_model") {
      await this.processModelGenResult(data.output);
    }
  }

  async handleToolError(data: { name: string; error: Error }) {
    console.error(`Error in tool ${data.name}:`, data.error);

    if (data.name === "apply_patch") {
      return JSON.stringify({
        success: false,
        message: `Apply patch failed: ${data.error.message}`,
        suggestion:
          'Please try using {"input":{"originalCode":"...","improvedCode":"..."}} format',
      });
    } else if (data.name === "generate_fix_code") {
      return JSON.stringify({
        status: "error",
        message: `Code generation failed: ${data.error.message}`,
        suggestion:
          "Please simplify instructions or implement improvements step by step",
      });
    }
    return null;
  }

  // Process apply_patch tool results and update memory
  async processApplyPatchResult(resultStr: string) {
    try {
      const result = JSON.parse(resultStr);
      if (result.success && result.updatedCode) {
        this.currentCodeState = result.updatedCode;

        // Save a summary to memory - no long strings
        await this.agentMemory.saveContext(
          { userPrompt: this.userPrompt },
          {
            codeStateContext: {
              lastUpdateTimestamp: new Date().toISOString(),
              codeSize: this.currentCodeState.length,
              codeDigest: this.getCodeDigest(this.currentCodeState),
            },
          }
        );
      }
    } catch (e) {
      console.error("Failed to parse apply_patch result:", e);
    }
  }

  // Process model generation results and update memory
  async processModelGenResult(resultStr: string) {
    try {
      const result = JSON.parse(resultStr);
      if (result.success && result.modelUrl) {
        const memoryVars = await this.agentMemory.loadMemoryVariables({});
        const ctx = memoryVars.codeStateContext || {};

        // Initialize or update model history
        const modelHistory = ctx.modelHistory || [];
        modelHistory.push({
          modelUrl: result.modelUrl,
          timestamp: new Date().toISOString(),
          prompt: this.userPrompt,
        });

        // Only keep the last 5 models in history
        const trimmedHistory = modelHistory.slice(-5);

        await this.agentMemory.saveContext(
          { userPrompt: this.userPrompt },
          {
            codeStateContext: {
              ...ctx,
              modelHistory: trimmedHistory,
              lastModelUrl: result.modelUrl,
              lastModelTimestamp: new Date().toISOString(),
            },
          }
        );
      }
    } catch (e) {
      console.error("Failed to process model generation result:", e);
    }
  }

  // Generate a short digest of code for reference
  getCodeDigest(code: string) {
    // Get first 40 chars and last 40 chars with length in the middle
    return `${code.substring(0, 40)}...[${
      code.length
    } chars]...${code.substring(code.length - 40)}`;
  }

  // Prepare and normalize tool inputs
  prepareToolInput(toolName: string, input: unknown) {
    if (toolName !== "apply_patch") {
      return input;
    }

    try {
      // Handle JSON
      const inputObj = typeof input === "string" ? JSON.parse(input) : input;

      // Handle nested input field
      if (inputObj.input && typeof inputObj.input === "string") {
        try {
          const innerObj = JSON.parse(inputObj.input);

          // Handle originalCode/improvedCode format
          if (innerObj.originalCode && innerObj.improvedCode) {
            return this.handleCodeComparison(
              innerObj.originalCode,
              innerObj.improvedCode
            );
          }

          return JSON.stringify(innerObj);
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (_e) {
          // Not JSON, check if it looks like a patch
          if (
            typeof inputObj.input === "string" &&
            inputObj.input.includes("---") &&
            inputObj.input.includes("+++")
          ) {
            return JSON.stringify({
              patch: inputObj.input
                .replace(/\\n/g, "\n")
                .replace(/\\\\/g, "\\"),
              description: "Extracted patch data",
            });
          }
        }
      }

      // Direct originalCode/improvedCode format
      if (inputObj.originalCode && inputObj.improvedCode) {
        return this.handleCodeComparison(
          inputObj.originalCode,
          inputObj.improvedCode
        );
      }

      // Already in correct format
      if (inputObj.code || inputObj.patch) {
        if (!inputObj.description) {
          inputObj.description = `Update: ${new Date()
            .toISOString()
            .slice(0, 19)}`;
        }
        return JSON.stringify(inputObj);
      }

      return input;
    } catch (e) {
      // Trying to handle non-JSON input
      if (typeof input === "string") {
        // Look for patch data
        if (input.includes("---") && input.includes("+++")) {
          return JSON.stringify({
            patch: input.replace(/\\n/g, "\n").replace(/\\\\/g, "\\"),
            description: "Direct patch extraction",
          });
        }
      }

      console.error("Failed to parse input for apply_patch:", e);
      return input;
    }
  }

  // Handle code comparison and generate patch if needed
  handleCodeComparison(originalCode: string, improvedCode: string) {
    // First-time call or empty state - use full code
    if (!this.currentCodeState || this.currentCodeState === "") {
      return JSON.stringify({
        code: improvedCode,
        description: `Initial code based on prompt: ${this.userPrompt.substring(
          0,
          50
        )}...`,
      });
    }

    // Subsequent call - generate a patch
    const patch = createPatch("code.js", this.currentCodeState, improvedCode);
    return JSON.stringify({
      patch,
      description: `Patch for: ${this.userPrompt.substring(0, 50)}...`,
    });
  }
}

// Create a memory instance for storing agent work state
const agentMemory = new BufferMemory({
  memoryKey: "codeState",
  inputKey: "userPrompt",
  returnMessages: false,
  outputKey: "codeStateContext",
});

// Initialize Azure OpenAI client
const model = new AzureChatOpenAI({
  modelName: "gpt-4.1",
  temperature: 0,
  azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
  azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
  azureOpenAIApiVersion: "2024-12-01-preview",
  azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
});

/**
 * Extract model URLs from generated code
 * @param code The generated code to analyze
 * @returns Object containing model URL information
 */
function extractModelUrls(code: string) {
  const modelUrls: Array<{ url: string; name: string }> = [];
  let primaryModelUrl: string | null = null;

  // Check for MODEL_URL comment format
  const modelUrlMatch = code.match(/\/\/\s*MODEL_URL:\s*(\S+)/);
  if (modelUrlMatch && modelUrlMatch[1]) {
    primaryModelUrl = modelUrlMatch[1];
    modelUrls.push({ url: primaryModelUrl, name: "model.glb" });
  }

  // Check for embedded Hyper3D URLs in the code
  const hyper3dMatches = code.match(
    /['"]https:\/\/hyperhuman-file\.deemos\.com\/[^'"]+\.glb[^'"]*['"]/g
  );
  if (hyper3dMatches && hyper3dMatches.length > 0) {
    hyper3dMatches.forEach((match: string, index: number) => {
      const url = match.replace(/^['"]|['"]$/g, "");
      if (!primaryModelUrl) {
        primaryModelUrl = url;
      }
      modelUrls.push({ url, name: `model_${index}.glb` });
    });
  }

  return {
    modelUrl: primaryModelUrl,
    modelUrls: modelUrls.length > 0 ? modelUrls : null,
  };
}

/**
 * Clean up and extract valid code from raw output
 * @param output Raw output from agent
 * @returns Cleaned code
 */
function cleanCodeOutput(output: unknown): string {
  if (typeof output !== "string") {
    return "";
  }

  let codeOutput = output;

  // Extract code from HTML if present
  if (codeOutput.includes("<!DOCTYPE html>") || codeOutput.includes("<html>")) {
    const scriptMatch = codeOutput.match(/<script>([\s\S]*?)<\/script>/);
    if (scriptMatch && scriptMatch[1]) {
      codeOutput = scriptMatch[1].trim();
    }
  }

  // Remove Markdown code blocks
  if (codeOutput.includes("```")) {
    const codeBlockMatch = codeOutput.match(
      /```(?:js|javascript)?([\s\S]*?)```/
    );
    if (codeBlockMatch && codeBlockMatch[1]) {
      codeOutput = codeBlockMatch[1].trim();
    }
  }

  // Ensure code is a setup function
  if (!codeOutput.includes("function setup")) {
    codeOutput = `function setup(scene, camera, renderer, THREE, OrbitControls) {
      /* Add the output here */
      ${codeOutput}
      return scene.children.find(child => child instanceof THREE.Mesh) || scene;
    }`;
  }

  return codeOutput;
}

/**
 * Create a system prompt with the required context
 * @param lintErrors ESLint errors to include
 * @param historyContext Historical context to include
 * @param modelRequired Whether 3D model generation is required
 * @param modelHistory 最近生成的模型历史
 * @returns Formatted system prompt template
 */
function createSystemPrompt(
  lintErrors?: LintError[],
  historyContext?: string,
  modelRequired?: boolean,
  modelHistory?: { modelUrl: string; timestamp: string; prompt: string }[]
) {
  // Format lint errors
  let lintErrorsMessage = "";
  if (lintErrors && lintErrors.length > 0) {
    lintErrorsMessage =
      "# 当前代码存在的问题\n" +
      lintErrors
        .map(
          (err: LintError) =>
            `- 行 ${err.line}:${err.column} - ${err.message} (${
              err.ruleId || "未知规则"
            })`
        )
        .join("\n");
  }

  const modelGenSection = modelRequired
    ? "\n当用户需求明确表示需要生成3D模型(如人物、动物、物品等)时，调用generate_3d_model工具。模型生成后，确保在代码中正确加载并展示该模型。"
    : "\n如果你判断实现用户需求需要复杂3D模型(如人物、动物、物品等)，调用generate_3d_model工具生成。";

  const historyContextSection = historyContext
    ? "# 历史上下文\n" +
      historyContext +
      "\n\n请参考上述历史编辑记录，保持代码风格和功能一致性。\n"
    : "";

  // 新增：拼接最近模型url
  let modelHistorySection = "";
  if (modelHistory && modelHistory.length > 0) {
    modelHistorySection =
      "\n# 最近生成的3D模型\n" +
      modelHistory
        .map(
          (m, i) =>
            `- [${i + 1}] ${m.timestamp}: ${
              m.modelUrl
            }（需求: ${m.prompt?.slice(0, 20)}...）`
        )
        .join("\n") +
      "\n如需复用3D模型，请直接加载上述url。";
  }

  return SystemMessagePromptTemplate.fromTemplate(
    "你是专业的Three.js代码优化AI助手。以下是你的工作指南：\n\n" +
      "# 工具说明\n" +
      "- **generate_fix_code**：生成或修复代码\n" +
      "- **不使用apply_patch**：应用代码更新\n" +
      "- **generate_3d_model**：生成复杂3D模型并返回加载URL\n" +
      "# 工作循环\n" +
      "请遵循以下增量迭代步骤进行代码优化：\n" +
      "1. **分析**：理解当前代码、截图分析的建议、用户需求\n" +
      "2. **改进**：使用generate_fix_code工具和generate_3d_model工具生成优化后的完整代码\n" +
      "3. **应用更新**：不使用apply_patch工具将改进后的代码应用到当前代码\n" +
      "4. **实时检查**：根据ESLint反馈，修复代码质量问题，确保无语法错误\n" +
      "5. **迭代优化**：如需要进步一步改进，返回第2步\n\n" +
      "# 3D模型生成集成" +
      modelGenSection +
      "\n记住，你拥有内存功能，能够记住之前生成的模型和代码上下文,在之前代码的基础上增加或者修改，不要重新写代码" +
      "\n记住，模型不要重复放在同一个地方" +
      "\n记住，场景可以保留多个模型，不要generate_3d_model生成的模型重叠在一起。" +
      "\n\n# 重要规则\n" +
      "- **直接返回可完整（有上下文）执行代码**：无论任何情况，最终必须只返回可执行的threejs代码，不要返回思考过程、解释或列表\n" +
      +(lintErrorsMessage ? lintErrorsMessage + "\n\n" : "") +
      historyContextSection +
      (modelHistorySection ? modelHistorySection + "\n\n" : "")
  );
}

/**
 * Analyze screenshot directly using LLM without agent loop
 * @param screenshotBase64 Base64 encoded screenshot
 * @param currentCode Current code to analyze
 * @param userPrompt User's requirements
 * @param lintErrors ESLint errors if available
 * @returns Analysis result as string
 */
export async function analyzeScreenshotDirectly(
  screenshotBase64: string,
  currentCode: string,
  userPrompt: string = "",
  lintErrors?: LintError[]
): Promise<string> {
  try {
    console.log("Analyzing screenshot directly...");

    // Prepare context sections
    const lintErrorsSection = prepareLintErrorsText(lintErrors);
    const historyContext = await prepareHistoryContext();

    const prompt = `Analyze this Three.js scene screenshot and suggest code improvements:
    
Current code:
\`\`\`javascript
${currentCode}
\`\`\`

User requirements:
${
  userPrompt || "No specific requirements provided"
}${lintErrorsSection}${historyContext}

Based on the screenshot (provided as base64), the ESLint errors, and the user requirements, suggest specific Three.js code changes to improve the scene.
Focus on implementing the user requirements while also fixing any code quality issues highlighted by ESLint.
If there are ESLint errors, make sure to address them in your solution.

IMPORTANT: RESPOND ONLY WITH VALID JAVASCRIPT CODE, NO EXPLANATIONS OR COMMENTS ABOUT YOUR THOUGHT PROCESS. 
The code must be complete and directly executable in the browser. 
Use 'function setup(scene, camera, renderer, THREE, OrbitControls) { ... }' format. 
DO NOT include phrases like "Here's the improved code" or numbered explanations.`;

    // Create image message
    const imageUrl = screenshotBase64.startsWith("data:")
      ? screenshotBase64
      : `data:image/png;base64,${screenshotBase64}`;

    const message = new HumanMessage({
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
    });

    const result = await model.invoke([message]);
    const contentText = extractTextContent(result.content);

    // Save a summary of the analysis to memory
    await saveAnalysisToMemory(userPrompt, contentText);

    return contentText;
  } catch (error) {
    console.error("Error analyzing screenshot:", error);
    return "Could not analyze the screenshot. Please try again.";
  }
}

/**
 * Extract text content from LLM response
 * @param content Response content
 * @returns Extracted text
 */
function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter((item) => typeof item === "object" && item?.type === "text")
      .map((item) => item.text || "")
      .join("\n");
  }

  return JSON.stringify(content);
}

/**
 * Format lint errors for inclusion in prompts
 * @param lintErrors Array of lint errors
 * @returns Formatted text
 */
function prepareLintErrorsText(lintErrors?: LintError[]): string {
  if (!lintErrors || lintErrors.length === 0) {
    return "";
  }

  return (
    "\n\nESLint errors found in current code:\n" +
    lintErrors
      .map(
        (err: LintError) =>
          `Line ${err.line}:${err.column} - ${err.message} (${
            err.ruleId || "unknown rule"
          })`
      )
      .join("\n")
  );
}

/**
 * Load and prepare history context from memory
 * @returns Formatted history context
 */
async function prepareHistoryContext() {
  try {
    const memoryVariables = await agentMemory.loadMemoryVariables({});
    if (memoryVariables.codeState) {
      return `\n\n历史上下文:\n${memoryVariables.codeState}\n`;
    }
  } catch (memoryError) {
    console.warn("Failed to load memory:", memoryError);
  }
  return "";
}

/**
 * Save analysis results to agent memory
 * @param userPrompt User's requirements
 * @param contentText Analysis content
 */
async function saveAnalysisToMemory(userPrompt: string, contentText: string) {
  const summary =
    contentText.length > 200
      ? contentText.substring(0, 200) + "..."
      : contentText;

  await agentMemory.saveContext(
    { userPrompt },
    {
      codeStateContext: {
        analysisTimestamp: new Date().toISOString(),
        analysisSummary: summary,
      },
    }
  );
}

/**
 * Run the agent optimization loop
 * @param suggestion Suggestion from screenshot analysis
 * @param currentCode Current code to optimize
 * @param maxIterations Maximum iterations for optimization
 * @param userPrompt User's requirements
 * @param historyContext Historical context
 * @param lintErrors ESLint errors if available
 * @param modelRequired Whether 3D model generation is required
 * @param res Response object for direct response handling
 * @returns Optimized code or void if response handled directly
 */
export async function runAgentLoop(
  suggestion: string,
  currentCode: string,
  maxIterations = MAX_ITERATIONS,
  userPrompt: string = "",
  historyContext: string = "",
  lintErrors?: LintError[],
  modelRequired?: boolean,
  res?: NextApiResponse
): Promise<string | void> {
  // Load latest code state from memory if available
  const currentCodeState = await loadLatestCodeState(currentCode);

  // 新增：读取模型历史
  let modelHistory: { modelUrl: string; timestamp: string; prompt: string }[] =
    [];
  try {
    const memoryVars = await agentMemory.loadMemoryVariables({});
    const ctx = memoryVars.codeStateContext || {};
    if (ctx.modelHistory) {
      modelHistory = ctx.modelHistory;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    // ignore
  }

  // Create tool array for agent
  const loopTools = [applyPatchTool, codeGenTool, modelGenTool];

  // Create prompt templates
  const systemMessage = createSystemPrompt(
    lintErrors,
    historyContext,
    modelRequired,
    modelHistory
  );
  const humanPromptTemplate = HumanMessagePromptTemplate.fromTemplate(
    [
      "请在以下Three.js代码基础上增量优化，不要重写全部代码：",
      "```js",
      "{currentCode}",
      "```",
      modelHistory && modelHistory.length > 0
        ? "\n最近生成的3D模型URL（复用）:\n" +
          modelHistory.map((m, i) => `- [${i + 1}] ${m.modelUrl}`).join("\n")
        : "",
      "\n分析建议：\n{suggestion}",
      "\n用户需求：\n{userPrompt}",
    ].join("\n")
  );

  // Create the prompt template
  const promptTemplate = ChatPromptTemplate.fromMessages([
    systemMessage,
    humanPromptTemplate,
    new MessagesPlaceholder("agent_scratchpad"),
  ]);

  try {
    // Create custom callback handler for agent
    const callbackHandler = new AgentCallbackHandler(
      currentCodeState,
      agentMemory,
      userPrompt
    );

    // Setup callback manager
    const callbackManager = new CallbackManager();
    callbackManager.addHandler(callbackHandler);

    // Create the agent
    const agent = await createOpenAIFunctionsAgent({
      llm: model,
      tools: loopTools,
      prompt: promptTemplate,
    });

    // Create the executor
    const executor = AgentExecutor.fromAgentAndTools({
      agent,
      tools: loopTools,
      maxIterations,
      verbose: true,
      handleParsingErrors: true,
      returnIntermediateSteps: true,
      callbacks: [callbackHandler],
    });

    try {
      // Execute the agent
      const result = await executor.invoke({
        suggestion,
        currentCode: currentCodeState,
        userPrompt: userPrompt || "无特定需求",
        historyContext: historyContext || "",
        lintErrors: lintErrors || [],
      });

      // Clean and process the output
      const cleanedOutput = cleanCodeOutput(result.output);

      // Update final state in memory
      await agentMemory.saveContext(
        { userPrompt },
        {
          codeStateContext: {
            codeDigest: callbackHandler.getCodeDigest(cleanedOutput),
            lastCompletionTimestamp: new Date().toISOString(),
            lastRequest: userPrompt,
          },
        }
      );

      // Extract model URLs from code
      const modelInfo = extractModelUrls(cleanedOutput);

      // Handle response if response object provided
      if (res) {
        return res.status(200).json({
          directCode: cleanedOutput,
          suggestion,
          ...modelInfo,
        });
      }

      return cleanedOutput;
    } catch (agentError) {
      // Fall back to direct improvement when agent fails
      return handleAgentFailure(
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore - agentError is likely an Error but TypeScript sees it as unknown
        agentError,
        suggestion,
        currentCode,
        userPrompt,
        res
      );
    }
  } catch (error) {
    console.error("Error running agent loop:", error);
    return currentCode; // Return original code on error
  }
}

/**
 * Load the latest code state from memory
 * @param currentCode Default code to use if memory load fails
 * @returns Latest code state
 */
async function loadLatestCodeState(currentCode: string): Promise<string> {
  try {
    // Try to get the cached code directly
    const cachedCode = getCachedCode();
    if (cachedCode && cachedCode !== currentCode) {
      console.log("Loading latest code state from cached code");
      return cachedCode;
    }
  } catch (memoryError) {
    console.warn("Failed to load cached code:", memoryError);
  }
  return currentCode;
}

/**
 * Handle agent execution failure
 * @param error Error that occurred
 * @param suggestion Original suggestion
 * @param currentCode Current code
 * @param userPrompt User requirements
 * @param res Response object if available
 * @returns Fallback code or void if response handled directly
 */
async function handleAgentFailure(
  error: Error,
  suggestion: string,
  currentCode: string,
  userPrompt: string,
  res?: NextApiResponse
) {
  console.error("Agent execution error:", error);
  console.log("Falling back to direct code improvement...");

  // Try to extract code from suggestion
  let improvedCode = extractCodeFromSuggestion(suggestion);

  // If no code extracted, try using codeGenTool directly
  if (!improvedCode) {
    improvedCode = await generateCodeWithFallback(currentCode, userPrompt);
  }

  // If still no code, return original
  if (!improvedCode) {
    improvedCode = currentCode;
  }

  // Record fallback to memory
  await agentMemory.saveContext(
    { userPrompt },
    {
      codeStateContext: {
        codeDigest:
          improvedCode.length > 100
            ? improvedCode.substring(0, 50) +
              "..." +
              improvedCode.substring(improvedCode.length - 50)
            : improvedCode,
        lastFallbackTimestamp: new Date().toISOString(),
        error: "Agent execution failed, used fallback",
      },
    }
  );

  // Handle response if response object provided
  if (res) {
    const modelInfo = extractModelUrls(improvedCode);
    return res.status(200).json({
      directCode: improvedCode,
      suggestion,
      ...modelInfo,
    });
  }

  return improvedCode;
}

/**
 * Extract code from a suggestion string
 * @param suggestion Suggestion string
 * @returns Extracted code or empty string
 */
function extractCodeFromSuggestion(suggestion: string): string {
  if (suggestion.includes("```")) {
    const codeMatch = suggestion.match(/```(?:js|javascript)?\s*([\s\S]*?)```/);
    if (codeMatch && codeMatch[1]) {
      return codeMatch[1].trim();
    }
  }
  return "";
}

/**
 * Generate code using codeGenTool as fallback
 * @param currentCode Current code
 * @param userPrompt User requirements
 * @returns Generated code or empty string
 */
async function generateCodeWithFallback(
  currentCode: string,
  userPrompt: string
): Promise<string> {
  try {
    console.log("Using codeGenTool to generate improved code...");
    const instruction = `改进以下Three.js代码，实现用户需求: ${
      userPrompt || "无特定需求"
    }\n\n${currentCode}`;

    const codeGenResult = await codeGenTool.invoke({ instruction });
    const parsedResult = JSON.parse(codeGenResult);

    if (parsedResult.code) {
      return parsedResult.code;
    }
  } catch (codeGenError) {
    console.error("codeGenTool failed:", codeGenError);
  }
  return "";
}

/**
 * Default export function for the API route
 * Handles API requests based on the request method and body
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Process the request based on the action type
  const { action, code, prompt, screenshot, lintErrors, modelRequired } =
    req.body;

  console.log(
    `Agent API called with action: ${action}, prompt: ${
      typeof prompt === "string" ? prompt.substring(0, 50) + "..." : "N/A"
    }`
  );

  try {
    switch (action) {
      case "analyze-screenshot":
        // Validate required parameters
        if (!screenshot || !code) {
          return res.status(400).json({
            error: "Missing required parameters: screenshot and code",
          });
        }

        // Execute screenshot analysis
        const suggestion = await analyzeScreenshotDirectly(
          screenshot,
          code,
          prompt,
          lintErrors
        );

        // Run the agent loop with user requirements
        return runAgentLoop(
          suggestion,
          code,
          MAX_ITERATIONS,
          prompt,
          "",
          lintErrors,
          modelRequired,
          res
        );

      default:
        return res.status(400).json({ error: "Invalid action: " + action });
    }
  } catch (error) {
    console.error("Error in agent handler:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
      stack:
        process.env.NODE_ENV === "development"
          ? error instanceof Error
            ? error.stack
            : null
          : null,
    });
  }
}
