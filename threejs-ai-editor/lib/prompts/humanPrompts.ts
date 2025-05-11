// lib/prompts/humanPrompts.ts
import { HumanMessagePromptTemplate } from "@langchain/core/prompts";
import { ModelHistoryEntry, SceneStateObject } from "../types/sceneTypes";

/**
 * Create user prompt template
 * @param modelHistory model history records
 * @param sceneState current scene state
 * @returns user prompt template
 */
export function createHumanPrompt(
  modelHistory?: ModelHistoryEntry[],
  sceneState?: SceneStateObject[]
) {
  // Build model history section - concise formatting
  let modelHistoryPart = "";
  if (modelHistory && modelHistory.length > 0) {
    modelHistoryPart = "Available model resources:\n";
    modelHistory.forEach((entry, index) => {
      const modelName = entry.prompt
        ? entry.prompt.substring(0, 30) +
          (entry.prompt.length > 30 ? "..." : "")
        : `Model${index + 1}`;
      modelHistoryPart += `${index + 1}. ${modelName}: ${entry.modelUrl}\n`;
    });
  }

  // Build scene state section - add key properties
  let sceneStatePart = "";
  if (sceneState && sceneState.length > 0) {
    sceneStatePart = "\nCurrent scene objects:\n";
    sceneState.forEach((obj, index) => {
      const position = obj.position ? `[${obj.position.join(",")}]` : "[0,0,0]";
      sceneStatePart += `${index + 1}. ${obj.name || `Object${index}`} (${
        obj.type
      }) @ ${position}\n`;
    });
  }

  // Construct prompt template - add workflow trigger instructions
  const template =
    `{userPrompt}` +
    (modelHistoryPart ? `\n\n${modelHistoryPart}` : "") +
    (sceneStatePart ? `\n${sceneStatePart}` : "") +
    "\n\nExecution steps:" +
    "\n1. First use retrieve_objects to fetch historical objects" +
    "\n2. If screenshots are available, analyze with analyze_screenshot" +
    "\n3. Generate or modify code based on requirements" +
    "\n4. Apply patches and persist objects" +
    "{{suggestion ? `\\n\\n${suggestion}` : ''}}" +
    "\n\nCurrent code:\n```javascript\n{currentCode}\n```";

  return HumanMessagePromptTemplate.fromTemplate(template);
}
