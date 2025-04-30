// Memory Management Module
// Using BufferWindowMemory to only keep the most recent conversation turns
// BufferWindowMemory with k=1 ensures we only keep the last turn, which:
// 1. Prevents context window/token overflow in long conversations
// 2. Keeps AI responses more focused on recent inputs
// 3. Reduces overall memory usage
import { BufferWindowMemory } from "langchain/memory";
import { createPatch } from "diff";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";

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
  private _codeMemory: BufferWindowMemory;
  private _sceneMemory: BufferWindowMemory;

  // Current states
  private _currentCodeState = "";

  constructor() {
    // Initialize memory systems with BufferWindowMemory instead of BufferMemory
    this._codeMemory = new BufferWindowMemory({
      memoryKey: "codeState",
      inputKey: "userPrompt",
      returnMessages: false,
      outputKey: "codeStateContext",
      k: 1, // 只保留最近一次交互
    });

    this._sceneMemory = new BufferWindowMemory({
      memoryKey: "scene_history",
      inputKey: "userPrompt",
      returnMessages: false,
      outputKey: "sceneHistoryContext",
      k: 1, // 只保留最近一次交互
    });
  }

  /**
   * Get the code memory instance
   */
  get codeMemory(): BufferWindowMemory {
    return this._codeMemory;
  }

  /**
   * Get the scene memory instance
   */
  get sceneMemory(): BufferWindowMemory {
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
    if (!sceneState || sceneState.length === 0) {
      return;
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
}

/**
 * Custom callback handler for agent execution with memory integration
 */
class MemoryCallbackHandler extends BaseCallbackHandler {
  currentCodeState: string;
  agentMemory: BufferWindowMemory;
  userPrompt: string;
  memoryManager: MemoryManager;
  name = "MemoryCallbackHandler";

  constructor(
    initialCode: string,
    memory: BufferWindowMemory,
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
  userPrompt: string,
  sceneState: SceneObject[]
) => {
  return memoryManager.saveSceneStateToMemory(userPrompt, sceneState);
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
export const getCodeMemory = (): BufferWindowMemory => memoryManager.codeMemory;
export const getSceneMemory = (): BufferWindowMemory =>
  memoryManager.sceneMemory;

// Helper function that would be imported from elsewhere
import { getCachedCode } from "@/lib/tools/applyPatchTool";
