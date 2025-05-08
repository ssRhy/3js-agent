// Memory Management Module
// Using ConversationSummaryBufferMemory to maintain context through summaries
// ConversationSummaryBufferMemory ensures we keep important context while:
// 1. Preventing context window/token overflow in long conversations
// 2. Keeps AI responses more focused on recent inputs
// 3. Reduces overall memory usage with summarization
import { ConversationSummaryBufferMemory } from "langchain/memory";
import { AzureChatOpenAI } from "@langchain/openai";
import { createPatch } from "diff";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { chromaService } from "../services/chromaService";

// Type definitions
interface SceneObject {
  id: string;
  type: string;
  name?: string;
  position?: number[];
}

interface SceneHistoryEntry {
  timestamp: string;
  prompt: string;
  objectCount: number;
  objects: SceneObject[];
}

interface PatchResult {
  success: boolean;
  updatedCode?: string;
  message?: string;
}

interface ModelGenResult {
  success: boolean;
  modelUrl?: string;
  message?: string;
}

/**
 * Class that manages different types of memory systems
 */
class MemoryManager {
  // Memory instances
  private _codeMemory: ConversationSummaryBufferMemory;
  private _sceneMemory: ConversationSummaryBufferMemory;

  // Current states
  private _currentCodeState = "";
  private _currentUserPrompt: string = "";

  constructor() {
    // Initialize LLM for summarization
    const llm = new AzureChatOpenAI({
      modelName: "gpt-4.1",
      azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
      azureOpenAIApiDeploymentName:
        process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
      azureOpenAIApiVersion: "2024-12-01-preview",
      azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
    });

    // Initialize memory systems with ConversationSummaryBufferMemory
    this._codeMemory = new ConversationSummaryBufferMemory({
      memoryKey: "codeState",
      inputKey: "userPrompt",
      returnMessages: false,
      outputKey: "codeStateContext",
      maxTokenLimit: 30000, // Limit token usage
      llm, // Use LLM for summarization
    });

    this._sceneMemory = new ConversationSummaryBufferMemory({
      memoryKey: "scene_history",
      inputKey: "userPrompt",
      returnMessages: false,
      outputKey: "sceneHistoryContext",
      maxTokenLimit: 30000, // Limit token usage
      llm, // Use LLM for summarization
    });
  }

  /**
   * Get the code memory instance
   */
  get codeMemory(): ConversationSummaryBufferMemory {
    return this._codeMemory;
  }

  /**
   * Get the scene memory instance
   */
  get sceneMemory(): ConversationSummaryBufferMemory {
    return this._sceneMemory;
  }

  /**
   * Update current code state
   */
  setCurrentCodeState(code: string) {
    this._currentCodeState = code;
  }

  /**
   * Get current code state
   */
  getCurrentCodeState() {
    return this._currentCodeState;
  }

  /**
   * Load the latest code state from memory
   * @param defaultCode Default code to use if memory load fails
   * @returns Latest code state
   */
  async loadLatestCodeState(defaultCode: string) {
    try {
      // Try to get the cached code directly
      const cachedCode = getCachedCode();
      if (cachedCode && cachedCode !== defaultCode) {
        console.log("Loading latest code state from cached code");
        this._currentCodeState = cachedCode;
        return cachedCode;
      }
    } catch (memoryError) {
      console.warn("Failed to load cached code:", memoryError);
    }
    this._currentCodeState = defaultCode;
    return defaultCode;
  }

  /**
   * Save analysis results to code memory
   * @param userPrompt User's requirements
   * @param contentText Analysis content
   */
  async saveAnalysisToMemory(userPrompt: string, contentText: string) {
    const summary =
      contentText.length > 200
        ? contentText.substring(0, 200) + "..."
        : contentText;

    await this._codeMemory.saveContext(
      { userPrompt },
      {
        codeStateContext: {
          analysisTimestamp: new Date().toISOString(),
          analysisSummary: summary,
        },
      }
    );

    console.log(
      `[Memory] Analysis saved to memory with prompt: "${userPrompt.substring(
        0,
        30
      )}..."`
    );
  }

  /**
   * Create a code digest for use in memory
   * @param code Code to digest
   * @returns Formatted digest
   */
  getCodeDigest(code: string) {
    if (!code) return "[empty code]";
    return `${code.substring(0, 40)}...[${
      code.length
    } chars]...${code.substring(code.length - 40)}`;
  }

  /**
   * Save scene state to the scene history memory
   * @param userPrompt User's prompt
   * @param sceneState Current state of the scene
   */
  async saveSceneStateToMemory(userPrompt: string, sceneState: SceneObject[]) {
    if (!sceneState) {
      console.log("[Memory] No scene state to save, creating empty state");
      sceneState = [];
    }

    try {
      // Get existing history
      const memoryVars = await this._sceneMemory.loadMemoryVariables({});
      const existingHistory = memoryVars.sceneHistoryContext || {};

      // Get current history array or initialize it
      const sceneHistory = existingHistory.history || [];

      // Add new scene state with timestamp
      sceneHistory.push({
        timestamp: new Date().toISOString(),
        prompt: userPrompt,
        objectCount: sceneState.length,
        objects: sceneState.map((obj: SceneObject) => ({
          id: obj.id,
          type: obj.type,
          name: obj.name || "unnamed",
          position: obj.position,
        })),
      });

      // Keep only the last 5 scene states to avoid memory overflow
      const trimmedHistory = sceneHistory.slice(-5);

      // Save updated history
      await this._sceneMemory.saveContext(
        { userPrompt },
        {
          sceneHistoryContext: {
            ...existingHistory,
            history: trimmedHistory,
            lastUpdateTimestamp: new Date().toISOString(),
          },
        }
      );

      console.log(
        `[Memory] Scene state saved: ${sceneState.length} objects, history: ${trimmedHistory.length} entries`
      );
    } catch (error) {
      console.error("Failed to save scene state to memory:", error);
    }
  }

  /**
   * Load scene history from memory
   * @returns Formatted scene history for prompts
   */
  async loadSceneHistoryFromMemory() {
    try {
      const memoryVars = await this._sceneMemory.loadMemoryVariables({});
      const historyContext = memoryVars.sceneHistoryContext || {};

      if (historyContext.history && historyContext.history.length > 0) {
        const historyEntries = historyContext.history;
        console.log(
          `[Memory] Loaded ${historyEntries.length} scene history entries`
        );

        return historyEntries
          .map(
            (entry: SceneHistoryEntry, index: number) =>
              `场景历史 [${index + 1}] - ${new Date(
                entry.timestamp
              ).toLocaleString()}:\n` +
              `- 用户需求: "${entry.prompt}"\n` +
              `- 对象数量: ${entry.objectCount}\n` +
              entry.objects
                .map(
                  (obj: SceneObject) =>
                    `  * ${obj.type}: ${obj.name} at position [${
                      obj.position?.join(", ") || "0,0,0"
                    }]`
                )
                .join("\n")
          )
          .join("\n\n");
      } else {
        console.log("[Memory] No scene history entries found");
      }
    } catch (error) {
      console.error("Failed to load scene history from memory:", error);
    }

    return "";
  }

  /**
   * Load model history from memory
   * @returns Array of model history entries
   */
  async loadModelHistoryFromMemory() {
    let modelHistory = [];
    try {
      const memoryVars = await this._codeMemory.loadMemoryVariables({});
      const ctx = memoryVars.codeStateContext || {};
      if (ctx.modelHistory) {
        modelHistory = ctx.modelHistory;
      }
    } catch (e) {
      console.warn("Failed to load model history:", e);
    }
    return modelHistory;
  }

  /**
   * Load and prepare history context from memory
   * @returns Formatted history context
   */
  async prepareHistoryContext() {
    try {
      const memoryVariables = await this._codeMemory.loadMemoryVariables({});
      if (memoryVariables.codeState) {
        return `\n\n历史上下文:\n${memoryVariables.codeState}\n`;
      }
    } catch (memoryError) {
      console.warn("Failed to load memory:", memoryError);
    }
    return "";
  }

  /**
   * Create a callback handler for memory
   * @param initialCode Initial code state
   * @param userPrompt User prompt
   * @returns Callback handler
   */
  createCallbackHandler(initialCode: string, userPrompt: string) {
    return new MemoryCallbackHandler(
      initialCode,
      this._codeMemory,
      userPrompt,
      this
    );
  }

  /**
   * Clear memory
   */
  clearMemory() {
    this._codeMemory.clear();
    this._sceneMemory.clear();
    console.log("[Memory] Memory cleared");
  }

  // 设置当前用户提示
  setCurrentUserPrompt(prompt: string): void {
    this._currentUserPrompt = prompt;
  }

  // 获取当前用户提示
  getCurrentUserPrompt(): string {
    return this._currentUserPrompt;
  }
}

/**
 * Custom callback handler for agent execution with memory integration
 */
class MemoryCallbackHandler extends BaseCallbackHandler {
  currentCodeState: string;
  agentMemory: ConversationSummaryBufferMemory;
  userPrompt: string;
  memoryManager: MemoryManager;
  name = "MemoryCallbackHandler";

  constructor(
    initialCode: string,
    memory: ConversationSummaryBufferMemory,
    userPrompt: string,
    memoryManager: MemoryManager
  ) {
    super();
    this.currentCodeState = initialCode;
    this.agentMemory = memory;
    this.userPrompt = userPrompt;
    this.memoryManager = memoryManager;
  }

  // These method implementations deliberately override parent class methods
  // with a simplified implementation to avoid compatibility issues with
  // the LangChain BaseCallbackHandler interface
  override handleToolStart(...args: unknown[]): unknown {
    const [tool, input] = args;
    const toolName =
      typeof tool === "string"
        ? tool
        : (tool as Record<string, string>).name || "";
    const inputStr = typeof input === "string" ? input : JSON.stringify(input);

    const normalizedInput = this.prepareToolInput(toolName, inputStr);
    console.log(`Starting tool with input:`, normalizedInput);
    return normalizedInput;
  }

  override handleToolEnd(...args: unknown[]): void {
    const [output] = args;
    const outputStr = typeof output === "string" ? output : "";

    // Extract tool name from context if available
    const toolName = this._getToolNameFromContext();

    if (toolName === "apply_patch") {
      void this.processApplyPatchResult(outputStr);
    } else if (toolName === "generate_3d_model") {
      void this.processModelGenResult(outputStr);
    }
  }

  override handleToolError(...args: unknown[]): unknown {
    const [error] = args;
    const errorObj = error instanceof Error ? error : new Error(String(error));

    // Try to get tool name from context
    const toolName = this._getToolNameFromContext();
    console.error(`Error in tool ${toolName || "unknown"}:`, errorObj);

    if (toolName === "apply_patch") {
      return JSON.stringify({
        success: false,
        message: `Apply patch failed: ${errorObj.message}`,
        suggestion:
          'Please try using {"input":{"originalCode":"...","improvedCode":"..."}} format',
      });
    } else if (toolName === "generate_fix_code") {
      return JSON.stringify({
        status: "error",
        message: `Code generation failed: ${errorObj.message}`,
        suggestion:
          "Please simplify instructions or implement improvements step by step",
      });
    }
    return null;
  }

  // Helper method - in a real implementation this would be properly tracked
  private _getToolNameFromContext(): string | undefined {
    // This is a simplified version that would actually track tool execution
    return undefined;
  }

  async processApplyPatchResult(resultStr: string) {
    try {
      const result = JSON.parse(resultStr) as PatchResult;
      if (result.success && result.updatedCode) {
        this.currentCodeState = result.updatedCode;
        this.memoryManager.setCurrentCodeState(result.updatedCode);

        // Save a summary to memory - no long strings
        await this.agentMemory.saveContext(
          { userPrompt: this.userPrompt },
          {
            codeStateContext: {
              lastUpdateTimestamp: new Date().toISOString(),
              codeSize: this.currentCodeState.length,
              codeDigest: this.memoryManager.getCodeDigest(
                this.currentCodeState
              ),
            },
          }
        );
      }
    } catch (e) {
      console.error("Failed to parse apply_patch result:", e);
    }
  }

  async processModelGenResult(resultStr: string) {
    try {
      const result = JSON.parse(resultStr) as ModelGenResult;
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
        } catch {
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

  getCodeDigest(code: string) {
    return this.memoryManager.getCodeDigest(code);
  }
}

// Create a singleton instance
const memoryManager = new MemoryManager();

// Export memory manager functions
export const loadLatestCodeState = async (defaultCode: string) => {
  return memoryManager.loadLatestCodeState(defaultCode);
};

export const saveAnalysisToMemory = async (
  userPrompt: string,
  contentText: string
) => {
  return memoryManager.saveAnalysisToMemory(userPrompt, contentText);
};

export const saveSceneStateToMemory = async (
  userPromptOrState: string | SceneObject[],
  sceneState?: SceneObject[]
) => {
  const isPrompt = typeof userPromptOrState === "string";
  const actualState = isPrompt ? sceneState || [] : userPromptOrState;
  const actualPrompt = isPrompt ? userPromptOrState : "";

  if (actualPrompt) {
    memoryManager.setCurrentUserPrompt(actualPrompt);
  }

  await memoryManager.saveSceneStateToMemory(
    actualPrompt || memoryManager.getCurrentUserPrompt(),
    actualState
  );

  // 保存到ChromaDB
  // 移除直接调用ChromaDB的代码，让Agent使用write_to_chroma工具写入
};

export const loadSceneHistoryFromMemory = async () => {
  return memoryManager.loadSceneHistoryFromMemory();
};

export const loadModelHistoryFromMemory = async () => {
  return memoryManager.loadModelHistoryFromMemory();
};

export const prepareHistoryContext = async () => {
  return memoryManager.prepareHistoryContext();
};

export const createMemoryCallbackHandler = (
  initialCode: string,
  userPrompt: string
) => {
  return memoryManager.createCallbackHandler(initialCode, userPrompt);
};

export const getCodeDigest = (code: string) => {
  return memoryManager.getCodeDigest(code);
};

// Export memory instances for direct access if needed
export const getCodeMemory = (): ConversationSummaryBufferMemory =>
  memoryManager.codeMemory;
export const getSceneMemory = (): ConversationSummaryBufferMemory =>
  memoryManager.sceneMemory;

// Define ModelHistoryEntry type
export interface ModelHistoryEntry {
  modelUrl: string;
  timestamp: string;
  prompt: string;
}

// 简化版的清除内存状态函数
export const clearSessionState = (): void => {
  memoryManager.clearMemory();
};

// Helper function that would be imported from elsewhere
import { getCachedCode } from "@/lib/tools/applyPatchTool";

/**
 * Load the current scene state from memory
 * @returns Current scene state objects
 */
export const loadSceneStateFromMemory = async (): Promise<SceneObject[]> => {
  try {
    const memoryVars = await memoryManager.sceneMemory.loadMemoryVariables({});
    const historyContext = memoryVars.sceneHistoryContext || {};

    if (historyContext.history && historyContext.history.length > 0) {
      // Get the most recent history entry
      const latestEntry =
        historyContext.history[historyContext.history.length - 1];

      if (latestEntry.objects && latestEntry.objects.length > 0) {
        return latestEntry.objects;
      }
    }
  } catch (error) {
    console.error("Failed to load scene state from memory:", error);
  }

  return [];
};

// 从ChromaDB检索对象
export const retrieveObjectsFromChromaDB = async (
  query: string,
  limit: number = 10
): Promise<SceneObject[]> => {
  try {
    console.log(`[ChromaDB] Retrieving objects with query: "${query}"`);
    return await chromaService.retrieveSceneObjects(query, limit);
  } catch (error) {
    console.error(
      "[ChromaDB] Failed to retrieve objects from ChromaDB:",
      error
    );
    return [];
  }
};

// 添加新方法，用于初始化ChromaDB
export const initializeChromaDB = async (): Promise<void> => {
  try {
    console.log("[ChromaDB] Initializing ChromaDB...");
    await chromaService.initialize();
    console.log("[ChromaDB] ChromaDB initialized successfully");
  } catch (error) {
    console.error("[ChromaDB] Failed to initialize ChromaDB:", error);
  }
};
