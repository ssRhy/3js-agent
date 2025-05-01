// lib/prompts/systemPrompts.ts
import { SystemMessagePromptTemplate } from "@langchain/core/prompts";
import { LintError } from "../types/codeTypes";
import { SceneStateObject, ModelHistoryEntry } from "../types/sceneTypes";

/**
 * 创建系统提示模板 - 集中所有提示词逻辑
 */
export function createSystemPrompt(
  lintErrors?: LintError[],
  historyContext?: string,
  modelRequired?: boolean,
  modelHistory?: ModelHistoryEntry[],
  sceneState?: SceneStateObject[],
  sceneHistory?: string
) {
  // 格式化代码问题
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
    "1. 首先判断是否需要生成新的3D模型，复杂模型比如（人，动物，建筑），请直接生成3D模型\n" +
    "此工作流确保生成的代码始终能正确引用已生成的模型，并且模型不会堆叠在一起。";

  const historyContextSection = historyContext
    ? "# 历史上下文\n" +
      historyContext +
      "\n\n请参考上述历史编辑记录，保持代码风格和功能一致性。\n"
    : "";

  // 最近模型url
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

  // 场景状态信息
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

  // 场景历史信息
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
      "# 工作流程\n" +
      "当收到截图分析建议时：\n" +
      "1. 判断是需要调用generate_3d_model工具生成3D模型，还是直接调用generate_fix_code工具生成threejs场景代码\n" +
      "2. 调用generate_fix_code工具时，要结合建议生成代码\n" +
      "3. 不需要再次分析或思考，立即执行工具调用\n" +
      "4. generate_fix_code工具调用后，然后使用apply_patch应用变更\n\n" +
      "# 输出格式\n" +
      "1. 必须仅返回可执行的three.js代码\n" +
      "2. 不要包含任何思考过程、分析或解释性文本\n" +
      "3. 不要包含markdown代码块标记\n" +
      "4. 返回值必须是一个可直接执行的setup函数\n\n" +
      modelGenSection +
      "\n\n" +
      lintErrorsMessage +
      historyContextSection +
      modelHistorySection +
      sceneStateSection +
      sceneHistorySection
  );
}
