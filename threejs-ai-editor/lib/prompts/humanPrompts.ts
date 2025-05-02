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
  const modelHistorySection =
    modelHistory && modelHistory.length > 0
      ? "\n最近生成的3D模型URL,只使用hyper3d返回的url（可复用）:\n" +
        modelHistory
          .map(
            (m: ModelHistoryEntry, i: number) => `- [${i + 1}] ${m.modelUrl}`
          )
          .join("\n")
      : "";

  const sceneStateSection =
    sceneState && sceneState.length > 0
      ? "\n当前场景状态：\n" +
        JSON.stringify(sceneState, null, 2) +
        "\n考虑场景中已有对象，添加新对象时避免重叠或覆盖。"
      : "";

  return HumanMessagePromptTemplate.fromTemplate(
    [
      "请基于以下Three.js代码生成新功能：",
      "```js",
      "{currentCode}",
      "```",
      modelHistorySection,
      "\n分析建议：\n{suggestion}",
      "\n用户需求：\n{userPrompt}",
      sceneStateSection,
      "\n重要：复用所有历史模型URL（只使用hyper3d返回的url），为每个模型指定不同位置坐标。",
      "\n如果输入包含screenshot，请首先使用analyze_screenshot工具分析当前场景是否符合需求，再决定后续操作。",
      "\n⚠️ 根据analyze_screenshot的分析结果调用generate_fix_code工具，提交仅包含threejs代码的完整方案，无需包含思考过程、分析或解释。返回必须是可直接执行的setup函数。",
      "{chat_history}",
    ].join("\n")
  );
}
