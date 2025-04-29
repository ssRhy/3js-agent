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

// Add interface for scene state object
interface SceneStateObject {
  id: string;
  name?: string;
  type: string;
  position?: number[];
  rotation?: number[];
  scale?: number[];
  isVisible?: boolean;
  metadata?: Record<string, unknown>;
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

// Create a separate memory instance for storing scene history
const sceneHistoryMemory = new BufferMemory({
  memoryKey: "scene_history",
  inputKey: "userPrompt",
  returnMessages: false,
  outputKey: "sceneHistoryContext",
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
 * @param sceneState 当前场景状态
 * @param sceneHistory 场景历史记录
 * @returns Formatted system prompt template
 */
function createSystemPrompt(
  lintErrors?: LintError[],
  historyContext?: string,
  modelRequired?: boolean,
  modelHistory?: { modelUrl: string; timestamp: string; prompt: string }[],
  sceneState?: SceneStateObject[],
  sceneHistory?: string
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

  const modelGenSection =
    "\n# 工作流程\n" +
    "为确保3D模型能正确渲染，请按以下顺序执行：\n" +
    "1. 首先判断是否需要生成新的3D模型\n" +
    "2. 如果需要，调用generate_3d_model工具生成3D模型\n" +
    "3. 获得模型URL后，再调用generate_fix_code工具生成包含该URL的代码\n" +
    "4. 最后使用apply_patch工具应用代码\n" +
    "5. 重要: 为每个模型指定不同的位置，不要让模型堆叠在(0,0,0)\n" +
    "此工作流确保生成的代码始终能正确引用已生成的模型，并且模型不会堆叠在一起。";

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

  // 新增：场景状态信息
  let sceneStateSection = "";
  if (sceneState && sceneState.length > 0) {
    sceneStateSection =
      "\n# 当前场景状态\n" +
      "场景中已有以下对象，在生成代码时考虑它们的位置和属性，避免重叠或覆盖：\n" +
      sceneState
        .map(
          (obj, i) =>
            `- 对象[${i + 1}]: 类型=${obj.type}, 名称=${
              obj.name || "未命名"
            }, ` +
            `位置=(${obj.position?.join(", ") || "0,0,0"}), ` +
            `旋转=(${obj.rotation?.join(", ") || "0,0,0"}), ` +
            `缩放=(${obj.scale?.join(", ") || "1,1,1"})`
        )
        .join("\n") +
      "\n\n请在生成新代码时考虑上述场景状态，不要移除已有对象，添加新对象时选择合适的位置。";
  }

  // 新增：场景历史信息
  let sceneHistorySection = "";
  if (sceneHistory && sceneHistory.length > 0) {
    sceneHistorySection =
      "\n# 场景历史记录\n" +
      sceneHistory +
      "\n\n请参考以上场景历史，理解场景的演变过程，保持场景的连续性。添加新内容时避免与历史冲突。";
  }

  return SystemMessagePromptTemplate.fromTemplate(
    "你是专业的Three.js代码优化AI助手。以下是你的工作指南：\n\n" +
      "# 工具说明\n" +
      "- **generate_fix_code**：生成或修复代码\n" +
      "- **apply_patch**：应用补丁到已有代码\n" +
      "- **generate_3d_model**：生成3D模型\n\n" +
      modelGenSection +
      "\n\n" +
      lintErrorsMessage +
      historyContextSection +
      modelHistorySection +
      sceneStateSection +
      sceneHistorySection +
      "\n\n" +
      "1. 分析需求，优化代码，添加新功能\n" +
      "2. 根据需要生成或加载3D模型\n" +
      "3. 保持setup函数格式，返回主要对象\n" +
      "4. 优化代码可读性，确保函数命名合理\n\n" +
      "## 注意事项\n" +
      "- 只使用OrbitControls.create(camera, renderer.domElement)创建控制器\n" +
      "- 返回scene对象或主要mesh\n" +
      "- 代码必须使用标准THREE.js，任何额外import都要添加相应代码\n" +
      "- 场景中保留已有对象，确保它们仍然可见\n" +
      "- 避免冗余代码生成，保持代码精简高效，不要包含任何解释或描述性文本。不要使用markdown代码块标记。"
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
 * Save scene state to the scene history memory
 * @param userPrompt User's prompt
 * @param sceneState Current state of the scene
 */
async function saveSceneStateToMemory(
  userPrompt: string,
  sceneState?: SceneStateObject[]
) {
  if (!sceneState || sceneState.length === 0) {
    return;
  }

  try {
    // Get existing history
    const memoryVars = await sceneHistoryMemory.loadMemoryVariables({});
    const existingHistory = memoryVars.sceneHistoryContext || {};

    // Get current history array or initialize it
    const sceneHistory = existingHistory.history || [];

    // Add new scene state with timestamp
    sceneHistory.push({
      timestamp: new Date().toISOString(),
      prompt: userPrompt,
      objectCount: sceneState.length,
      objects: sceneState.map((obj) => ({
        id: obj.id,
        type: obj.type,
        name: obj.name || "unnamed",
        position: obj.position,
      })),
    });

    // Keep only the last 5 scene states to avoid memory overflow
    const trimmedHistory = sceneHistory.slice(-5);

    // Save updated history
    await sceneHistoryMemory.saveContext(
      { userPrompt },
      {
        sceneHistoryContext: {
          ...existingHistory,
          history: trimmedHistory,
          lastUpdateTimestamp: new Date().toISOString(),
        },
      }
    );
  } catch (error) {
    console.error("Failed to save scene state to memory:", error);
  }
}

/**
 * Load scene history from memory
 * @returns Formatted scene history for prompts
 */
async function loadSceneHistoryFromMemory(): Promise<string> {
  try {
    const memoryVars = await sceneHistoryMemory.loadMemoryVariables({});
    const historyContext = memoryVars.sceneHistoryContext || {};

    if (historyContext.history && historyContext.history.length > 0) {
      const historyEntries = historyContext.history;

      return historyEntries
        .map(
          (
            entry: {
              timestamp: string;
              prompt: string;
              objectCount: number;
              objects: Array<{
                id: string;
                type: string;
                name: string;
                position?: number[];
              }>;
            },
            index: number
          ) =>
            `场景历史 [${index + 1}] - ${new Date(
              entry.timestamp
            ).toLocaleString()}:\n` +
            `- 用户需求: "${entry.prompt}"\n` +
            `- 对象数量: ${entry.objectCount}\n` +
            entry.objects
              .map(
                (obj) =>
                  `  * ${obj.type}: ${obj.name} at position [${
                    obj.position?.join(", ") || "0,0,0"
                  }]`
              )
              .join("\n")
        )
        .join("\n\n");
    }
  } catch (error) {
    console.error("Failed to load scene history from memory:", error);
  }

  return "";
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
 * @param sceneState Current scene state for context
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
  sceneState?: SceneStateObject[],
  res?: NextApiResponse
): Promise<string | void> {
  // Load latest code state from memory if available
  const currentCodeState = await loadLatestCodeState(currentCode);

  // 新增：加载场景历史
  const sceneHistory = await loadSceneHistoryFromMemory();

  // 保存当前场景状态到历史记录
  if (sceneState && sceneState.length > 0) {
    await saveSceneStateToMemory(userPrompt, sceneState);
  }

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
    modelHistory,
    sceneState,
    sceneHistory
  );
  const humanPromptTemplate = HumanMessagePromptTemplate.fromTemplate(
    [
      "请基于以下Three.js代码生成新的功能：",
      "```js",
      "{currentCode}",
      "```",
      modelHistory && modelHistory.length > 0
        ? "\n最近生成的3D模型URL（复用）:\n" +
          modelHistory.map((m, i) => `- [${i + 1}] ${m.modelUrl}`).join("\n")
        : "",
      "\n分析建议：\n{suggestion}",
      "\n用户需求：\n{userPrompt}",
      sceneState && sceneState.length > 0
        ? "\n当前场景状态：\n" +
          JSON.stringify(sceneState, null, 2) +
          "\n考虑场景已有对象，添加新对象时避免重叠或覆盖。"
        : "",
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
  // Cast sceneState to the correct type
  const sceneState = req.body.sceneState as SceneStateObject[] | undefined;
  // Get scene history if provided
  const sceneHistory = req.body.sceneHistory;

  console.log(
    `Agent API called with action: ${action}, prompt: ${
      typeof prompt === "string" ? prompt.substring(0, 50) + "..." : "N/A"
    }, sceneState: ${sceneState ? `${sceneState.length} objects` : "none"}, ` +
      `sceneHistory: ${sceneHistory ? "provided" : "none"}`
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
          sceneState,
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
