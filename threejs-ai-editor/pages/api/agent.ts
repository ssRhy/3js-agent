// Main Agent Implementation
import { AzureChatOpenAI } from "@langchain/openai";
import { createOpenAIFunctionsAgent, AgentExecutor } from "langchain/agents";
import {
  MessagesPlaceholder,
  HumanMessagePromptTemplate,
  ChatPromptTemplate,
  SystemMessagePromptTemplate,
} from "@langchain/core/prompts";
import { CallbackManager } from "@langchain/core/callbacks/manager";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { NextApiRequest, NextApiResponse } from "next";
import { RunnableWithMessageHistory } from "@langchain/core/runnables";
import { BufferWindowMemory } from "langchain/memory";
import {
  BaseChatMessageHistory,
  InMemoryChatMessageHistory,
} from "@langchain/core/chat_history";

// Import memory management functions
import {
  loadLatestCodeState,
  saveAnalysisToMemory,
  saveSceneStateToMemory,
  loadSceneHistoryFromMemory,
  loadModelHistoryFromMemory,
  prepareHistoryContext,
  createMemoryCallbackHandler,
  getCodeDigest,
} from "@/lib/memory/memoryManager";

// Import tools
import { applyPatchTool } from "@/lib/tools/applyPatchTool";
import { codeGenTool } from "@/lib/tools/codeGenTool";
import { modelGenTool } from "@/lib/tools/modelGenTool";

// Store constants for better maintainability
// Maximum characters to store in memory
const MAX_ITERATIONS = 10; // Default max iterations for agent loop

// 保存会话窗口内存的存储
const sessionStore: Record<string, BufferWindowMemory> = {};

// 保存消息历史记录的存储
const chatHistoryStore: Record<string, InMemoryChatMessageHistory> = {};

// 获取或创建会话窗口内存
function getMessageHistory(sessionId: string): BaseChatMessageHistory {
  if (!chatHistoryStore[sessionId]) {
    // 创建新的聊天历史记录
    const chatHistory = new InMemoryChatMessageHistory();
    chatHistoryStore[sessionId] = chatHistory;

    // 创建BufferWindowMemory并关联到这个聊天历史
    sessionStore[sessionId] = new BufferWindowMemory({
      k: 1, // 只保留上一轮交互
      memoryKey: "chat_history", // 历史消息的键
      returnMessages: true, // 返回消息对象而非字符串
      chatHistory: chatHistory,
    });
  }

  return chatHistoryStore[sessionId];
}

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

// Define interface for model history entry
interface ModelHistoryEntry {
  modelUrl: string;
  timestamp: string;
  prompt: string;
}

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
 * Helper function to generate a code digest for logging
 * @param code Code to generate digest for
 * @returns Formatted code digest
 */
function getCodeDigestForLogging(code: string): string {
  // Get first 40 chars and last 40 chars with length in the middle
  return getCodeDigest(code);
}

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
  modelHistory?: ModelHistoryEntry[],
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
    "4. 对于截图分析建议，直接调用generate_fix_code工具实现建议的功能\n" +
    "5. 最后使用apply_patch工具应用代码\n" +
    "6. 重要: 为每个模型指定不同的位置，不要让模型堆叠在(0,0,0)\n" +
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
      "1. generate_3d_model和generate_fix_code工具结合使用，生成既有3d模型又有threejs代码搭建的完整场景\n" +
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
 * Format code for detailed logging by adding line numbers and truncating if needed
 * @param code Code to format for logging
 * @param maxLines Maximum number of lines to show before truncating
 * @returns Formatted code with line numbers
 */
function formatCodeForLogging(code: string, maxLines: number = 50): string {
  const lines = code.split("\n");

  if (lines.length <= maxLines) {
    // Add line numbers to all lines
    return lines
      .map((line, idx) => `${(idx + 1).toString().padStart(3, " ")}: ${line}`)
      .join("\n");
  }

  // If code is too long, show beginning and end with ellipsis
  const halfMax = Math.floor(maxLines / 2);
  const firstHalf = lines
    .slice(0, halfMax)
    .map((line, idx) => `${(idx + 1).toString().padStart(3, " ")}: ${line}`);

  const secondHalf = lines
    .slice(-halfMax)
    .map(
      (line, idx) =>
        `${(lines.length - halfMax + idx + 1)
          .toString()
          .padStart(3, " ")}: ${line}`
    );

  return [
    ...firstHalf,
    `... [${lines.length - maxLines} more lines] ...`,
    ...secondHalf,
  ].join("\n");
}

/**
 * Analyze differences between original code and LLM-suggested code
 * @param originalCode Original code
 * @param newCode New suggested code
 * @returns Analysis of key changes
 */
function analyzeCodeChanges(originalCode: string, newCode: string): string {
  // Simple analysis based on line count and functions
  const originalLines = originalCode.split("\n");
  const newLines = newCode.split("\n");

  // Function to extract function names using regex
  const extractFunctions = (code: string): string[] => {
    const functionMatches = code.match(/function\s+(\w+)\s*\(/g) || [];
    return functionMatches.map((match) =>
      match.replace(/function\s+/, "").replace(/\s*\($/, "")
    );
  };

  const originalFunctions = extractFunctions(originalCode);
  const newFunctions = extractFunctions(newCode);

  // Find added and removed functions
  const addedFunctions = newFunctions.filter(
    (fn) => !originalFunctions.includes(fn)
  );
  const removedFunctions = originalFunctions.filter(
    (fn) => !newFunctions.includes(fn)
  );

  const analysis = [
    `Lines: ${originalLines.length} → ${newLines.length} (${
      newLines.length - originalLines.length > 0 ? "+" : ""
    }${newLines.length - originalLines.length})`,
  ];

  if (addedFunctions.length > 0) {
    analysis.push(`Added functions: ${addedFunctions.join(", ")}`);
  }

  if (removedFunctions.length > 0) {
    analysis.push(`Removed functions: ${removedFunctions.join(", ")}`);
  }

  return analysis.join("\n");
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
  const analysisStartTime = new Date();
  const requestId = `analysis_${Date.now()}`;

  console.log(
    `[${requestId}] [Screenshot Analysis] Started at ${analysisStartTime.toISOString()}`
  );
  console.log(
    `[${requestId}] [Screenshot Analysis] User prompt: "${userPrompt}"`
  );

  if (lintErrors && lintErrors.length > 0) {
    console.log(
      `[${requestId}] [Screenshot Analysis] Processing ${lintErrors.length} lint errors`
    );
  }

  try {
    // Log image details
    const imageDataSize = screenshotBase64.length;
    console.log(
      `[${requestId}] [Screenshot Analysis] Image data size: ${imageDataSize} bytes`
    );
    console.log(
      `[${requestId}] [Screenshot Analysis] Original code size: ${currentCode.length} chars`
    );

    // Prepare context sections
    const lintErrorsSection = prepareLintErrorsText(lintErrors);
    const historyContext = await prepareHistoryContext();

    console.log(
      `[${requestId}] [Screenshot Analysis] Building prompt with history context: ${
        historyContext ? "Available" : "Not available"
      }`
    );

    const prompt = `Analyze this Three.js scene screenshot and suggest scene improvements:
    

User requirements:
${
  userPrompt || "No specific requirements provided"
}${lintErrorsSection}${historyContext}

Provide brief scene suggestions based on the screenshot analysis. These suggestions will be sent directly to the generate_fix_code tool.
`;

    // Create image message
    const imageUrl = screenshotBase64.startsWith("data:")
      ? screenshotBase64
      : `data:image/png;base64,${screenshotBase64}`;

    console.log(
      `[${requestId}] [Screenshot Analysis] Sending request to model at ${new Date().toISOString()}`
    );

    const message = new HumanMessage({
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
    });

    const result = await model.invoke([message]);
    const contentText = extractTextContent(result.content);

    const analysisEndTime = new Date();
    const analysisTimeMs =
      analysisEndTime.getTime() - analysisStartTime.getTime();

    // Enhanced debugging for LLM analysis
    console.log(
      `[${requestId}] [Screenshot Analysis] Completed in ${analysisTimeMs}ms at ${analysisEndTime.toISOString()}`
    );
    console.log(
      `[${requestId}] [Screenshot Analysis] Suggestion length: ${contentText.length} chars`
    );

    // Enhanced debugging: Log code differences and analysis
    console.log(
      `[${requestId}] [Screenshot Analysis] Code diff analysis:\n${analyzeCodeChanges(
        currentCode,
        contentText
      )}`
    );

    // Log detailed code with line numbers for better debugging
    console.log(
      `[${requestId}] [Screenshot Analysis] Detailed analysis result:\n${formatCodeForLogging(
        contentText
      )}`
    );

    // Log a summary/digest of the suggestion content
    console.log(
      `[${requestId}] [Screenshot Analysis] Suggestion digest: ${getCodeDigestForLogging(
        contentText
      )}`
    );

    // Save a summary of the analysis to memory
    await saveAnalysisToMemory(userPrompt, contentText);
    console.log(
      `[${requestId}] [Screenshot Analysis] Analysis saved to memory`
    );

    return contentText;
  } catch (error) {
    console.error(`[${requestId}] [Screenshot Analysis] Error:`, error);
    console.log(
      `[${requestId}] [Screenshot Analysis] Stack trace:`,
      error instanceof Error ? error.stack : "No stack trace available"
    );
    return "Could not analyze the screenshot. Please try again.";
  }
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
  // 生成会话ID（使用时间戳 + 用户提示的哈希值确保每次编辑是独特的）
  const sessionId = `session_${Date.now()}_${userPrompt
    .slice(0, 20)
    .replace(/\s+/g, "_")}`;

  // Load latest code state from memory if available
  const currentCodeState = await loadLatestCodeState(currentCode);

  // 新增：加载场景历史
  const sceneHistory = await loadSceneHistoryFromMemory();

  // 保存当前场景状态到历史记录
  if (sceneState && sceneState.length > 0) {
    await saveSceneStateToMemory(userPrompt, sceneState);
  }

  // 新增：读取模型历史
  const modelHistory = await loadModelHistoryFromMemory();

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
          modelHistory
            .map(
              (m: ModelHistoryEntry, i: number) => `- [${i + 1}] ${m.modelUrl}`
            )
            .join("\n")
        : "",
      "\n截图分析建议：\n{suggestion}\n请使用generate_fix_code工具实现这些建议",
      "\n用户需求：\n{userPrompt}",
      sceneState && sceneState.length > 0
        ? "\n当前场景状态：\n" +
          JSON.stringify(sceneState, null, 2) +
          "\n考虑场景已有对象，添加新对象时避免重叠或覆盖。"
        : "",
      "\n重要：必须重用所有历史模型URL，为每个模型指定不同位置坐标。",
      "{chat_history}", // 添加对话历史占位符
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
    const callbackHandler = createMemoryCallbackHandler(
      currentCodeState,
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

    // 使用 RunnableWithMessageHistory 包装 executor
    const executorWithMemory = new RunnableWithMessageHistory({
      runnable: executor,
      getMessageHistory: () => getMessageHistory(sessionId),
      inputMessagesKey: "input", // 输入消息的键
      historyMessagesKey: "chat_history", // 历史消息的键
    });

    // 为调用准备配置
    const memoryConfig = {
      configurable: {
        sessionId: sessionId,
      },
    };

    // 准备输入对象 - 包含当前用户请求和所有上下文
    const inputForAgent = {
      input: userPrompt,
      suggestion,
      currentCode: currentCodeState,
      userPrompt: userPrompt || "无特定需求",
      historyContext: historyContext || "",
      lintErrors: lintErrors || [],
    };

    try {
      // 添加模型历史内容到会话历史
      if (modelHistory && modelHistory.length > 0) {
        // 注意：调整为InMemoryChatMessageHistory的方式添加消息
        const modelHistoryContent = `我们有以下模型URL，请在生成的代码中包含所有这些URL:\n${modelHistory
          .map(
            (m: ModelHistoryEntry, i: number) => `- 模型${i + 1}: ${m.modelUrl}`
          )
          .join("\n")}`;

        // 使用InMemoryChatMessageHistory的addMessage方法添加到内存中
        const chatHistory = chatHistoryStore[sessionId];
        if (chatHistory) {
          await chatHistory.addMessage(new HumanMessage(modelHistoryContent));
          await chatHistory.addMessage(
            new AIMessage(
              "我将确保在生成的代码中包含所有这些模型URL，并为每个模型指定不同的位置坐标。"
            )
          );
        }
      }

      // 执行带记忆功能的Agent
      const result = await executorWithMemory.invoke(
        inputForAgent,
        memoryConfig
      );

      // Clean and process the output
      const cleanedOutput = cleanCodeOutput(result.output);

      // 检查输出是否包含所有模型URL
      if (modelHistory && modelHistory.length > 0) {
        let hasAllModels = true;
        const missingModels: ModelHistoryEntry[] = [];

        // 检查哪些模型URL未被包含
        for (const model of modelHistory) {
          if (!cleanedOutput.includes(model.modelUrl)) {
            hasAllModels = false;
            missingModels.push(model);
          }
        }

        // 如果缺少某些模型URL，记录并尝试添加它们
        if (!hasAllModels) {
          console.log(
            `输出中缺少 ${missingModels.length} 个模型URL，尝试修复...`
          );

          // 使用InMemoryChatMessageHistory的addMessage方法添加消息
          const missingModelsContent = `输出中缺少以下模型URL，请确保包含它们:\n${missingModels
            .map((m: ModelHistoryEntry) => `- ${m.modelUrl}`)
            .join("\n")}`;

          // 更新内存
          const chatHistory = chatHistoryStore[sessionId];
          if (chatHistory) {
            await chatHistory.addMessage(
              new HumanMessage(missingModelsContent)
            );
          }
        }
      }

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
        agentError as Error,
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
    console.log("Directly passing screenshot analysis to codeGenTool...");

    // Prepare instruction combining suggestion and user prompt
    const instruction = `基于截图分析建议实现以下功能：
${suggestion}

用户需求：${userPrompt || "无特定需求"}

当前代码：
${currentCode}`;

    improvedCode = await generateCodeWithFallback(currentCode, instruction);
  }

  // If still no code, return original
  if (!improvedCode) {
    improvedCode = currentCode;
  }

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

    // Check if the userPrompt already contains suggestions or code
    const instruction = userPrompt.includes("基于截图分析建议")
      ? userPrompt // Use directly if it's already a formatted instruction
      : `改进以下Three.js代码，实现用户需求: ${
          userPrompt || "无特定需求"
        }\n\n${currentCode}`;

    console.log(
      `Sending instruction to codeGenTool (${instruction.length} chars)`
    );

    const codeGenResult = await codeGenTool.invoke({ instruction });
    const parsedResult = JSON.parse(codeGenResult);

    if (parsedResult.code) {
      console.log(
        `Successfully generated code (${parsedResult.code.length} chars)`
      );
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

        // Check if the response contains code guidance that should be sent directly to generate_fix_code
        if (
          suggestion &&
          (suggestion.includes("```") || suggestion.includes("function setup"))
        ) {
          console.log(
            "Screenshot analysis produced direct code suggestion, using direct code flow"
          );

          // Extract code from suggestion or use the suggestion directly
          let directCode = extractCodeFromSuggestion(suggestion);

          if (!directCode) {
            // If no code block, use the codeGenTool directly
            console.log(
              "No code block found, sending suggestion to codeGenTool"
            );
            const instruction = `根据以下截图分析建议生成代码：
${suggestion}

用户需求：${prompt || "无特定需求"}

当前代码：
${code}`;

            // Generate code using the tool directly
            try {
              const codeGenResult = await codeGenTool.invoke({ instruction });
              const parsedResult = JSON.parse(codeGenResult);

              if (parsedResult.code) {
                directCode = parsedResult.code;
                console.log(
                  `Successfully generated code directly (${directCode.length} chars)`
                );
              }
            } catch (codeGenError) {
              console.error("Direct codeGenTool failed:", codeGenError);
            }
          }

          if (directCode) {
            const modelInfo = extractModelUrls(directCode);
            return res.status(200).json({
              directCode,
              suggestion,
              ...modelInfo,
            });
          }
        }

        // Default: Run the agent loop with user requirements
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
