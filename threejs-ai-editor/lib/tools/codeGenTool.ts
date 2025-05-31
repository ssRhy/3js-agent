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
        "\n# Available 3D Models\n" +
        "The following are previously generated 3D model URLs. Please directly reference these hyper3d URLs in your code to maintain scene consistency:\n" +
        modelHistory
          .map(
            (m: { modelUrl: string }, i: number) =>
              `- Model${i + 1}: ${m.modelUrl}`
          )
          .join("\n") +
        "\nEnsure your code includes these models."
      );
    }
  } catch (error) {
    console.error("Failed to load model history:", error);
  }
  return "";
}

// Format scene state information for inclusion in prompts
function formatSceneStateForPrompt(
  sceneState: Record<string, unknown>[]
): string {
  if (!sceneState || !Array.isArray(sceneState) || sceneState.length === 0) {
    return "";
  }

  return (
    "\n# Current Scene State (EXACT POSITIONS)\n" +
    "重要提示：以下是场景中对象的准确位置信息。在生成代码时，必须使用这些确切的位置、旋转和缩放值，而不是编辑器中的旧值。\n" +
    "CRITICAL: Below are the EXACT positions, rotations, and scales of objects in the scene. You MUST use these values when generating code:\n" +
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
    "\n\nThese values represent the current state of objects after user manipulation. You MUST use these exact values in your generated code."
  );
}

/**
 * Code Generation Tool - Generates initial Three.js code or fixes existing code based on errors
 */
export const codeGenTool = new DynamicStructuredTool({
  name: "generate_fix_code",
  description:
    "Generate or fix Three.js code based on user prompts. Provide complete setup function code.",
  schema: z.object({
    instruction: z
      .string()
      .describe("Description of functionality to implement or issues to fix"),
    sceneState: z
      .array(z.record(z.unknown()))
      .optional()
      .describe(
        "Current state of objects in the scene with exact positions, rotations and scales"
      ),
    screenshotAnalysis: z
      .string()
      .optional()
      .describe(
        "Analysis results from screenshot analysis tool with specific improvement suggestions"
      ),
  }),
  func: async ({ instruction, sceneState, screenshotAnalysis }) => {
    const requestId = `codegen_${Date.now()}`;
    const startTime = Date.now();
    console.log(
      `[${requestId}] [CodeGen Tool]  Agent requested code generation/fix - ${new Date().toISOString()}`
    );
    console.log(
      `[${requestId}] [CodeGen Tool]  Instruction content: "${instruction.substring(
        0,
        100
      )}${instruction.length > 100 ? "..." : ""}"`
    );

    // Log scene state information
    if (sceneState && Array.isArray(sceneState)) {
      console.log(
        `[${requestId}] [CodeGen Tool] 🔄 Received scene state with ${sceneState.length} objects`
      );
    }

    // Log screenshot analysis information
    if (screenshotAnalysis) {
      console.log(
        `[${requestId}] [CodeGen Tool] 🖼️ Received screenshot analysis with improvement suggestions`
      );

      try {
        const analysisData = JSON.parse(screenshotAnalysis);
        if (analysisData.key_improvements) {
          console.log(
            `[${requestId}] [CodeGen Tool] Key improvements: ${analysisData.key_improvements.substring(
              0,
              100
            )}...`
          );
        }
      } catch {
        console.log(
          `[${requestId}] [CodeGen Tool] Screenshot analysis provided as text: ${screenshotAnalysis.substring(
            0,
            100
          )}...`
        );
      }
    }

    // Detect if request is from screenshot analysis
    const isFromScreenshotAnalysis =
      instruction.includes("screenshot analysis") ||
      instruction.includes("analysis results") ||
      instruction.includes("needs_improvements") ||
      instruction.includes("scene needs adjustment") ||
      screenshotAnalysis;

    if (isFromScreenshotAnalysis) {
      console.log(
        `[${requestId}] [CodeGen Tool] 🖼️ Detected code fix request based on screenshot analysis`
      );
    }

    try {
      // Get model history to ensure these models are referenced when generating code
      console.log(
        `[${requestId}] [CodeGen Tool] 📚 Retrieving model history data...`
      );
      const modelHistorySection = await formatModelHistoryForPrompt();
      console.log(
        `[${requestId}] [CodeGen Tool] ✅ Model history data retrieval complete, contains ${
          modelHistorySection.split("\n").length - 4 > 0
            ? modelHistorySection.split("\n").length - 4
            : 0
        } models`
      );

      // Format scene state information
      const sceneStateSection = sceneState
        ? formatSceneStateForPrompt(sceneState)
        : "";
      if (sceneStateSection) {
        console.log(
          `[${requestId}] [CodeGen Tool] 📊 Formatted scene state data for ${
            Array.isArray(sceneState) ? sceneState.length : 0
          } objects`
        );
      }

      // Format screenshot analysis information
      let screenshotAnalysisSection = "";
      if (screenshotAnalysis) {
        try {
          const analysisData = JSON.parse(screenshotAnalysis);
          screenshotAnalysisSection = `
# Screenshot Analysis Results
Based on the current scene screenshot analysis:

**Analysis Status**: ${analysisData.status || "Unknown"}
**Matches Requirements**: ${analysisData.matches_requirements ? "Yes" : "No"}
**Needs Improvements**: ${analysisData.needs_improvements ? "Yes" : "No"}

${
  analysisData.analysis ? `**Detailed Analysis**: ${analysisData.analysis}` : ""
}

${
  analysisData.key_improvements
    ? `**Key Improvements Needed**: ${analysisData.key_improvements}`
    : ""
}

${
  analysisData.recommendation
    ? `**Recommendation**: ${analysisData.recommendation}`
    : ""
}

IMPORTANT: Please implement the specific improvements identified in the screenshot analysis above.
`;
        } catch {
          screenshotAnalysisSection = `
# Screenshot Analysis Results
Analysis provided: ${screenshotAnalysis}

Please use this analysis to improve the scene according to the user's requirements.
`;
        }

        console.log(
          `[${requestId}] [CodeGen Tool] 📸 Formatted screenshot analysis section`
        );
      }

      const prompt = `As a Three.js expert, please generate or fix code based on the following instructions:

${instruction}

${modelHistorySection}

${sceneStateSection}

${screenshotAnalysisSection}

Requirements:
Do not assume any models or URLs
1. Code must be directly executable JavaScript code using the Three.js library
2. Use the format: function setup(scene, camera, renderer, THREE, OrbitControls) { ... }
3. Last line: return scene.
4. use new OrbitControls() directly
5. Remember, don't place models in the same location repeatedly
8. The scene can contain multiple models. Ensure models generated by generate_3d_model don't overlap. Automatically calculate appropriate scaling factors based on actual model bounding box size. Reference surrounding objects and position models in a realistic manner.
9. Return the scene object or main mesh
10. Ensure complete functionality and code standards. Only use URLs returned by generate_3d_model, don't arbitrarily replace existing URLs. Keep existing URLs as they are and don't assume URLs during the process
11. Don't declare variable names multiple times. For multiple materials, use different names to distinguish them
12. Don't randomly clear the scene. Maintain context memory and remember all 3D model URLs. Don't assume any models or URLs
13. Ensure all URLs are correct and valid, accessible through browsers. Invalid URLs will cause the scene to fail loading
14. If the user requests deletion of specific objects from the scene, identify those objects and remove the related creation and addition statements in the code
15. When deleting objects, ensure they are correctly removed from the scene or their parent object (using parent.remove(object))
16. Don't omit any code and objects
17. Generate new code based on the code above
18. CRITICAL: If scene state data is provided, you MUST use those exact positions, rotations, and scales in your code. These represent the current state after user manipulation.
${
  screenshotAnalysisSection
    ? "19. CRITICAL: Implement the specific improvements identified in the screenshot analysis above. Pay special attention to the key improvements and recommendations."
    : ""
}

⚠️ Note: Your answer must only contain executable Three.js code. Don't include any explanations, thought processes, or descriptive text. Don't use markdown code block markers. Don't add any prefixes or suffixes. Directly return executable setup function code.`;

      // Call LLM to generate or modify code
      console.log(
        `[${requestId}] [CodeGen Tool] 🤖 Calling LLM to generate code...`
      );
      const llmCallStartTime = Date.now();
      const result = await codeGenModel.invoke(prompt);
      const llmResponseTime = Date.now();

      console.log(
        `[${requestId}] [CodeGen Tool] ✅ LLM response complete, time taken: ${
          llmResponseTime - llmCallStartTime
        }ms`
      );

      const responseContent = handleLLMResponseContent(result.content);

      // Extract generated code
      let improvedCode = responseContent.trim();

      // Remove code block markers (if present)
      if (improvedCode.includes("```")) {
        const codeMatch = improvedCode.match(
          /```(?:js|javascript)?\s*([\s\S]*?)```/
        );
        if (codeMatch && codeMatch[1]) {
          improvedCode = codeMatch[1].trim();
          console.log(
            `[${requestId}] [CodeGen Tool] ℹ️ Extracted code from markdown code block`
          );
        }
      }

      // Ensure code is in setup function format
      if (!improvedCode.startsWith("function setup")) {
        console.log(
          `[${requestId}] [CodeGen Tool] ⚠️ Generated code not in setup function format, adding wrapper`
        );
        improvedCode = `function setup(scene, camera, renderer, THREE, OrbitControls) {
  ${improvedCode}
  // Return the main object or scene
  return scene.children.find(child => child instanceof THREE.Mesh) || scene;
}`;
      }

      // Get original cached code
      const originalCode = getCachedCode() || "";
      console.log(
        `[${requestId}] [CodeGen Tool] ℹ️ Retrieved original code, length: ${originalCode.length} characters`
      );

      // Check if generated code includes model URLs; if not, try to extract and preserve from original code
      const modelHistory = await loadModelHistoryFromMemory();
      if (modelHistory && modelHistory.length > 0) {
        let hasPreservedModels = false;

        // Check if new code contains historical model URLs
        for (const model of modelHistory) {
          if (!improvedCode.includes(model.modelUrl)) {
            // If generated code doesn't include this URL, check if original code does
            if (originalCode.includes(model.modelUrl)) {
              // If original code includes it but new code doesn't, we need to preserve this model
              console.log(
                `[${requestId}] [CodeGen Tool] 🔄 Preserving model URL: ${model.modelUrl.substring(
                  0,
                  30
                )}...`
              );

              // Simple method: Add comment at beginning of code to ensure model URL is included
              const modelComment = `  // MODEL_URL: ${model.modelUrl}\n`;

              // Insert after first line of setup function
              improvedCode = improvedCode.replace(
                /function setup\([^)]*\)\s*{/,
                `$&\n${modelComment}  // Preserving previously generated model - ${new Date().toISOString()}`
              );

              hasPreservedModels = true;
            }
          }
        }

        if (hasPreservedModels) {
          console.log(
            `[${requestId}] [CodeGen Tool] ✅ Historical model URLs preserved`
          );
        }
      }

      // URL validation: Check if URLs in code are accessible; if not, clean them up
      console.log(
        `[${requestId}] [CodeGen Tool] 🔍 Validating URLs in code...`
      );
      const validatedCode = await ensureValidUrlsInCode(improvedCode);

      if (validatedCode !== improvedCode) {
        console.log(
          `[${requestId}] [CodeGen Tool] ⚠️ Detected invalid URLs and fixed them`
        );
        improvedCode = validatedCode;
      } else {
        console.log(
          `[${requestId}] [CodeGen Tool] ✅ All URLs in code validated successfully`
        );
      }

      const endTime = Date.now();
      console.log(
        `[${requestId}] [CodeGen Tool] ✅ Code generation complete, total time taken: ${
          endTime - startTime
        }ms`
      );

      // Return the clean code
      return improvedCode;
    } catch (error) {
      console.error(
        `[${requestId}] [CodeGen Tool] 🔴 Error generating code:`,
        error
      );
      throw new Error(`Code generation failed: ${error}`);
    }
  },
});
