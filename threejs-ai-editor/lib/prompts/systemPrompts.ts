// lib/prompts/systemPrompts.ts
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { LintError } from "../types/codeTypes";
import { SceneStateObject, ModelHistoryEntry } from "../types/sceneTypes";

/**
 * Create system prompt template - centralizes all prompt logic
 */
export function createSystemPrompt(
  lintErrors?: LintError[],
  historyContext?: string,
  modelRequired?: boolean,
  modelHistory?: ModelHistoryEntry[],
  sceneState?: SceneStateObject[],
  sceneHistory?: string
) {
  // Format code issues
  let lintErrorsMessage = "";
  if (lintErrors && Array.isArray(lintErrors) && lintErrors.length > 0) {
    lintErrorsMessage =
      "# Current code issues\n" +
      lintErrors
        .map((err: LintError) => {
          const ruleId = err.ruleId || "Unknown rule";
          return `- Line ${err.line}:${err.column} - ${err.message} (${ruleId})`;
        })
        .join("\n");
  }

  const modelGenSection =
    "\n# Workflow Process\n" +
    "To ensure 3D models render correctly, please execute in the following order:\n" +
    "1. First determine if a new 3D model needs to be generated. Complex models require 3D model generation, while environmental scenes and simple items generally don't\n" +
    "This workflow ensures that generated code correctly references previously created models and avoids model stacking.";

  const historyContextSection = historyContext
    ? "# Historical Context\n" +
      historyContext +
      "\n\nRefer to the above edit history record to maintain code style and functional consistency.\n"
    : "";

  // Recent model URLs
  let modelHistorySection = "";
  if (modelHistory && Array.isArray(modelHistory) && modelHistory.length > 0) {
    modelHistorySection =
      "\n# Recently Generated 3D Models\n" +
      modelHistory
        .map((m, i) => {
          const promptPreview = m.prompt?.slice(0, 20) || "";
          return `- [${i + 1}] ${m.timestamp}: ${
            m.modelUrl
          } (Requirement: ${promptPreview}...)`;
        })
        .join("\n") +
      "\nTo reuse 3D models, directly load the URLs above.";
  }

  // Scene state information
  let sceneStateSection = "";
  if (sceneState && Array.isArray(sceneState) && sceneState.length > 0) {
    sceneStateSection =
      "\n# Current Scene State\n" +
      "The following objects are already in the scene. Consider their positions and properties when generating code to avoid overlaps or coverage:\n" +
      sceneState
        .map((obj, i) => {
          const objName = obj.name || "Unnamed";
          const position = obj.position?.join(", ") || "0,0,0";
          const rotation = obj.rotation?.join(", ") || "0,0,0";
          const scale = obj.scale?.join(", ") || "1,1,1";
          return (
            `- Object[${i + 1}]: type=${obj.type}, name=${objName}, ` +
            `position=(${position}), ` +
            `rotation=(${rotation}), ` +
            `scale=(${scale})`
          );
        })
        .join("\n") +
      "\n\nWhen adding new objects, choose appropriate positions and don't remove existing objects.";
  }

  // Scene history information
  let sceneHistorySection = "";
  if (sceneHistory && sceneHistory.length > 0) {
    sceneHistorySection =
      "\n# Scene History Record\n" +
      sceneHistory +
      "\n\nRefer to the scene history to understand the evolution process, maintain continuity, and avoid conflicts with history.";
  }

  // Use double braces to escape braces in LangChain templates
  const templateContent =
    "You are AgenticThreeJSworkflow, a Three.js scene construction and optimization expert with autonomous decision-making and tool-calling capabilities.\n\n" +
    "# Important Reminders\n" +
    "Preserve complete URLs from above and reuse all necessary URLs. Do not assume any models or URLs\n" +
    "After code generation or modification, you must: 1) Check scene objects to maintain context memory 2) Persist objects 3) Ensure 3D model URLs are not duplicated 4) Never use online model URLs\n" +
    "# Tool Set\n" +
    "- generate_3d_model: Use only when complex 3D models are needed and existing URLs cannot be reused\n" +
    "- generate_fix_code: Generate or fix Three.js code\n" +
    "- apply_patch: Apply code patches\n" +
    "- analyze_screenshot: Analyze scene screenshots for visual feedback\n" +
    "- retrieve_objects: Retrieve historical objects and URLs from ChromaDB\n" +
    "- write_to_chroma: Persist storage of scene objects\n\n" +
    "# Core Workflow\n" +
    '1. Memory Retrieval: First use retrieve_objects("all") to retrieve all needed historical objects and URLs\n' +
    "2. Requirement Analysis: Determine if a new 3D model is needed (only for complex models and when existing URLs cannot be reused)\n" +
    "3. Visual Analysis: If screenshots are available, use analyze_screenshot for feedback\n" +
    "4. Code Generation:\n" +
    "   - Generate code with generate_fix_code based on retrieval results and requirements\n" +
    "   - Ensure all necessary historical URLs and context memory are included, don't delete or modify URL paths\n" +
    "   - Adjust object positions and sizes appropriately based on actual conditions to avoid overlap\n" +
    "5. Code Application: Apply code using apply_patch\n" +
    "6. Object Persistence: Save scene objects with write_to_chroma\n\n" +
    "# Feedback Loop Process\n" +
    "1. Render → Screenshot(analyze_screenshot) → Analysis Feedback\n" +
    "2. Optimize based on feedback → Persist (retrieve necessary objects and enhance historical context memory with retrieve_objects) → Fix/Generate code(generate_fix_code) → Apply patch(apply_patch)\n" +
    "3. Store objects(write_to_chroma)\n" +
    "4. Repeat until visual and code validation passes\n\n" +
    "# Object Format\n" +
    "```json\n" +
    "{\n" +
    '  "id": "cube_123",\n' +
    '  "type": "mesh",\n' +
    '  "name": "RedCube",\n' +
    '  "position": [0, 1, 0],\n' +
    '  "rotation": [0, 0, 0],\n' +
    '  "scale": [1, 1, 1]\n' +
    "}\n" +
    "```\n\n" +
    "# Output Requirements\n" +
    "- Return complete Three.js setup() function source code\n" +
    "- Do not include thought processes or Markdown markup\n" +
    modelGenSection +
    "\n\n" +
    lintErrorsMessage +
    historyContextSection +
    modelHistorySection +
    sceneStateSection +
    sceneHistorySection;

  // Use regular expressions to replace single braces with double braces, without affecting existing variable placeholders
  const safeTemplateContent = templateContent
    .replace(/\{(?!\{)/g, "{{")
    .replace(/\}(?!\})/g, "}}");

  return SystemMessagePromptTemplate.fromTemplate(safeTemplateContent);
}
