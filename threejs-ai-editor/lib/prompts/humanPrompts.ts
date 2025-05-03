// lib/prompts/humanPrompts.ts
import { HumanMessagePromptTemplate } from "@langchain/core/prompts";
import { ModelHistoryEntry, SceneStateObject } from "../types/sceneTypes";

/**
 * 创建用户提示模板
 * @param modelHistory 模型历史记录
 * @param sceneState 当前场景状态
 * @returns 用户提示模板
 */
export function createHumanPrompt(
  modelHistory?: ModelHistoryEntry[],
  sceneState?: SceneStateObject[]
) {
  // 构建模型历史部分
  let modelHistoryPart = "";
  if (modelHistory && modelHistory.length > 0) {
    modelHistoryPart = "有以下已生成模型可使用:\n";
    modelHistory.forEach((entry, index) => {
      // 使用 prompt 显示模型名称，如果没有则显示序号
      const modelName = entry.prompt ? `${entry.prompt}` : `模型 ${index + 1}`;
      modelHistoryPart += `${index + 1}. ${modelName}: ${entry.modelUrl}\n`;
    });
  }

  // 构建场景状态部分
  let sceneStatePart = "";
  if (sceneState && sceneState.length > 0) {
    sceneStatePart = "\n当前场景包含以下对象:\n";
    sceneState.forEach((obj, index) => {
      sceneStatePart += `${index + 1}. ${obj.name || "对象" + index} (${
        obj.type
      })\n`;
    });
  }

  // 构造提示模板 - 修复条件语法中的大括号问题
  // LangChain.js 模板引擎需要对条件语句使用双大括号进行转义
  const template =
    `{userPrompt}` +
    (modelHistoryPart ? `\n\n${modelHistoryPart}` : "") +
    (sceneStatePart ? `\n${sceneStatePart}` : "") +
    "\n\n如果有截图提供，请先使用 analyze_screenshot 工具分析场景，然后再进行其他操作。" +
    "{{suggestion ? `\\n\\n建议: ${suggestion}` : ''}}" +
    "\n\n当前代码:\n```javascript\n{currentCode}\n```";

  return HumanMessagePromptTemplate.fromTemplate(template);
}
