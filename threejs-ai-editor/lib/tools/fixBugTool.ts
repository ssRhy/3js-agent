import { DynamicStructuredTool } from "@langchain/core/tools";
import { AzureChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { getCachedCode } from "@/lib/tools/applyPatchTool";
import { loadModelHistoryFromMemory } from "@/lib/memory/memoryManager";
import { ensureValidUrlsInCode } from "@/lib/processors/codeUrlValidator";

// Type definition for lint error objects
interface LintError {
  line?: number | string;
  column?: number | string;
  message?: string;
  ruleId?: string;
}

// Initialize Azure OpenAI client for bug fixing
const fixBugModel = new AzureChatOpenAI({
  modelName: "gpt-4o-mini",
  temperature: 0.1, // Lower temperature for more precise bug fixes
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

/**
 * Format model history for inclusion in prompts
 */
async function formatModelHistoryForPrompt(): Promise<string> {
  try {
    const modelHistory = await loadModelHistoryFromMemory();
    if (modelHistory && modelHistory.length > 0) {
      return (
        "\n# Available 3D Models\n" +
        "The following are previously generated 3D model URLs that should be preserved:\n" +
        modelHistory
          .map(
            (m: { modelUrl: string }, i: number) =>
              `- Model${i + 1}: ${m.modelUrl}`
          )
          .join("\n") +
        "\nEnsure these models are not lost during bug fixes."
      );
    }
  } catch (error) {
    console.error("Failed to load model history:", error);
  }
  return "";
}

/**
 * Format scene state information for inclusion in prompts
 */
function formatSceneStateForPrompt(
  sceneState: Record<string, unknown>[]
): string {
  if (!sceneState || !Array.isArray(sceneState) || sceneState.length === 0) {
    return "";
  }

  return (
    "\n# Current Scene State (EXACT POSITIONS)\n" +
    "重要提示：以下是场景中对象的准确位置信息。修复代码时必须保持这些确切的位置、旋转和缩放值。\n" +
    "CRITICAL: Below are the EXACT positions, rotations, and scales of objects in the scene. You MUST preserve these values when fixing bugs:\n" +
    sceneState
      .map((obj) => {
        const name = obj.name || `object_${obj.id}`;
        const position = Array.isArray(obj.position)
          ? obj.position.join(", ")
          : "0, 0, 0";
        const rotation = Array.isArray(obj.rotation)
          ? obj.rotation.join(", ")
          : "0, 0, 0";
        const scale = Array.isArray(obj.scale)
          ? obj.scale.join(", ")
          : "1, 1, 1";

        return `- ${name} (${obj.type}): position=[${position}], rotation=[${rotation}], scale=[${scale}]`;
      })
      .join("\n") +
    "\n\nThese values represent the current state of objects and must be preserved when fixing bugs."
  );
}

/**
 * Bug Fix Tool - Specifically designed for fixing Three.js code errors
 */
export const fixBugTool = new DynamicStructuredTool({
  name: "fix_bug",
  description:
    "Fix bugs and errors in Three.js code. This tool analyzes the current code, identifies issues, and returns the corrected JavaScript code directly. Use this when encountering syntax errors, runtime errors, or code quality issues. The returned result is ready-to-execute JavaScript code that should be applied using apply_patch.",
  schema: z.object({
    errorDescription: z
      .string()
      .describe("Description of the bug or error that needs to be fixed"),
    errorDetails: z
      .string()
      .optional()
      .describe("Detailed error messages, stack traces, or console errors"),
    currentCode: z
      .string()
      .optional()
      .describe("The current code that contains the error to be fixed"),
    sceneState: z
      .array(z.record(z.unknown()))
      .optional()
      .describe(
        "Current state of objects in the scene with exact positions, rotations and scales that must be preserved"
      ),
    lintErrors: z
      .array(z.record(z.unknown()))
      .optional()
      .describe("Lint errors that need to be addressed"),
    preserveModels: z
      .boolean()
      .optional()
      .default(true)
      .describe("Whether to preserve existing 3D model URLs (default: true)"),
  }),
  func: async ({
    errorDescription,
    errorDetails,
    currentCode,
    sceneState,
    lintErrors,
    preserveModels = true,
  }) => {
    const requestId = `fixbug_${Date.now()}`;
    const startTime = Date.now();
    console.log(
      `[${requestId}] [FixBug Tool] Agent requested bug fix - ${new Date().toISOString()}`
    );
    console.log(
      `[${requestId}] [FixBug Tool] Error description: "${errorDescription.substring(
        0,
        100
      )}${errorDescription.length > 100 ? "..." : ""}"`
    );

    if (errorDetails) {
      console.log(
        `[${requestId}] [FixBug Tool] Error details provided: ${errorDetails.substring(
          0,
          100
        )}...`
      );
    }

    // Log scene state information
    if (sceneState && Array.isArray(sceneState)) {
      console.log(
        `[${requestId}] [FixBug Tool] 🔄 Received scene state with ${sceneState.length} objects to preserve`
      );
    }

    // Log lint errors
    if (lintErrors && Array.isArray(lintErrors)) {
      console.log(
        `[${requestId}] [FixBug Tool] 🔍 Received ${lintErrors.length} lint errors to fix`
      );
    }

    try {
      // Step 1: Get current code - prioritize passed code, fallback to cached
      console.log(
        `[${requestId}] [FixBug Tool] 📁 Retrieving current code for analysis...`
      );

      let codeToFix = currentCode;
      if (!codeToFix) {
        // Fallback to cached code if no code provided
        const cachedCode = getCachedCode();
        codeToFix = cachedCode || undefined;
      }

      if (!codeToFix) {
        console.error(
          `[${requestId}] [FixBug Tool] ❌ No current code available for bug fixing`
        );
        return "Error: No current code available for bug fixing. Please ensure code is provided in the request.";
      }

      console.log(
        `[${requestId}] [FixBug Tool] ✅ Current code retrieved (${codeToFix.length} characters)`
      );

      // Step 2: Get model history if preservation is enabled
      let modelHistorySection = "";
      if (preserveModels) {
        console.log(
          `[${requestId}] [FixBug Tool] 📚 Retrieving model history for preservation...`
        );
        modelHistorySection = await formatModelHistoryForPrompt();
        console.log(
          `[${requestId}] [FixBug Tool] ✅ Model history retrieved for preservation`
        );
      }

      // Step 3: Format scene state information
      const sceneStateSection = sceneState
        ? formatSceneStateForPrompt(sceneState)
        : "";

      // Step 4: Format lint errors
      let lintErrorsSection = "";
      if (lintErrors && Array.isArray(lintErrors) && lintErrors.length > 0) {
        lintErrorsSection =
          "\n# Lint Errors to Fix\n" +
          lintErrors
            .map((error: LintError, index: number) => {
              const line = error.line || "unknown";
              const column = error.column || "unknown";
              const message = error.message || "No message";
              const ruleId = error.ruleId || "Unknown rule";
              return `${
                index + 1
              }. Line ${line}:${column} - ${message} (${ruleId})`;
            })
            .join("\n");
      }

      // Step 5: Construct comprehensive bug fix prompt
      const bugFixPrompt = `# Three.js Bug Fix Request

## Current Issue
${errorDescription}

${errorDetails ? `## Error Details\n${errorDetails}\n` : ""}

${lintErrorsSection}

## Current Code to Fix
\`\`\`javascript
${codeToFix}
\`\`\`

${modelHistorySection}

${sceneStateSection}

## Bug Fix Requirements
1. **Preserve Scene State**: Maintain all existing object positions, rotations, and scales exactly as specified in the scene state
2. **Preserve Model URLs**: Keep all existing 3D model URLs intact - do not modify or remove them
3. **Fix Specific Issues**: Address the reported error while maintaining all existing functionality
4. **Code Quality**: Ensure the fixed code follows Three.js best practices
5. **Memory Management**: Properly handle object disposal and avoid memory leaks
6. **Error Handling**: Add appropriate error handling to prevent similar issues
7. **Transform Controls**: Properly detach TransformControls before removing objects

**IMPORTANT**: Return ONLY the corrected JavaScript code without any explanations, markdown formatting, or code blocks. The code should be ready to execute immediately.`;

      console.log(
        `[${requestId}] [FixBug Tool] 🤖 Sending bug fix request to LLM...`
      );

      // Step 6: Generate fixed code using LLM
      const response = await fixBugModel.invoke(bugFixPrompt);
      const fixedCode = handleLLMResponseContent(response.content);

      console.log(
        `[${requestId}] [FixBug Tool] ✅ Bug fix completed (${fixedCode.length} characters)`
      );

      // Step 7: Validate URLs in the fixed code
      console.log(
        `[${requestId}] [FixBug Tool] 🔗 Validating model URLs in fixed code...`
      );
      const validatedCode = await ensureValidUrlsInCode(fixedCode);

      const endTime = Date.now();
      const duration = endTime - startTime;
      console.log(
        `[${requestId}] [FixBug Tool] ⚡ Bug fix process completed in ${duration}ms`
      );

      return validatedCode;
    } catch (error) {
      const endTime = Date.now();
      const duration = endTime - startTime;

      console.error(
        `[${requestId}] [FixBug Tool] ❌ Bug fix failed after ${duration}ms:`,
        error
      );

      return `Error fixing bug: ${
        error instanceof Error ? error.message : "Unknown error occurred"
      }`;
    }
  },
});
