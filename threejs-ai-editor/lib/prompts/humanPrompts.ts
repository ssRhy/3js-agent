// lib/prompts/humanPrompts.ts
import { HumanMessagePromptTemplate } from "@langchain/core/prompts";
import { SceneStateObject, ModelHistoryEntry } from "../types/sceneTypes";

/**
 * 创建人类消息提示模板 - 集中提示词逻辑
 */
export function createHumanPrompt(
  modelHistory?: ModelHistoryEntry[],
  sceneState?: SceneStateObject[]
) {
  return HumanMessagePromptTemplate.fromTemplate(
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
      "\n分析建议：\n{suggestion}",
      "\n用户需求：\n{userPrompt}",
      sceneState && sceneState.length > 0
        ? "\n当前场景状态：\n" +
          JSON.stringify(sceneState, null, 2) +
          "\n考虑场景已有对象，添加新对象时避免重叠或覆盖。"
        : "",
      "\n重要：必须重用所有历史模型URL，为每个模型指定不同位置坐标。",
      "\n⚠️ 立即调用generate_fix_code工具，提交仅包含JavaScript代码的完整解决方案，不要包含任何思考过程、分析或解释性文本。返回值必须是一个可直接执行的setup函数。",
      "{chat_history}", // 添加对话历史占位符
    ].join("\n")
  );
}
