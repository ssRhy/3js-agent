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
  if (lintErrors && Array.isArray(lintErrors) && lintErrors.length > 0) {
    lintErrorsMessage =
      "# 当前代码存在的问题\n" +
      lintErrors
        .map((err: LintError) => {
          const ruleId = err.ruleId || "未知规则";
          return `- 行 ${err.line}:${err.column} - ${err.message} (${ruleId})`;
        })
        .join("\n");
  }

  const modelGenSection =
    "\n# 工作流程\n" +
    "为确保3D模型能正确渲染，请按以下顺序执行：\n" +
    "1. 首先判断是否需要生成新的3D模型，复杂模型.生成3D模型.环境场景和简单物品一般不需要生成3D模型\n" +
    "此工作流确保生成的代码能正确引用已生成的模型，并避免模型堆叠。";

  const historyContextSection = historyContext
    ? "# 历史上下文\n" +
      historyContext +
      "\n\n请参考上述历史编辑记录，保持代码风格和功能一致性。\n"
    : "";

  // 最近模型url
  let modelHistorySection = "";
  if (modelHistory && Array.isArray(modelHistory) && modelHistory.length > 0) {
    modelHistorySection =
      "\n# 最近生成的3D模型\n" +
      modelHistory
        .map((m, i) => {
          const promptPreview = m.prompt?.slice(0, 20) || "";
          return `- [${i + 1}] ${m.timestamp}: ${
            m.modelUrl
          }（需求: ${promptPreview}...）`;
        })
        .join("\n") +
      "\n如需复用3D模型，请直接加载上述url。";
  }

  // 场景状态信息
  let sceneStateSection = "";
  if (sceneState && Array.isArray(sceneState) && sceneState.length > 0) {
    sceneStateSection =
      "\n# 当前场景状态\n" +
      "场景中已有以下对象，生成代码时考虑它们的位置和属性，避免重叠或覆盖：\n" +
      sceneState
        .map((obj, i) => {
          const objName = obj.name || "未命名";
          const position = obj.position?.join(", ") || "0,0,0";
          const rotation = obj.rotation?.join(", ") || "0,0,0";
          const scale = obj.scale?.join(", ") || "1,1,1";
          return (
            `- 对象[${i + 1}]: 类型=${obj.type}, 名称=${objName}, ` +
            `位置=(${position}), ` +
            `旋转=(${rotation}), ` +
            `缩放=(${scale})`
          );
        })
        .join("\n") +
      "\n\n添加新对象时请选择合适的位置，不要移除已有对象。";
  }

  // 场景历史信息
  let sceneHistorySection = "";
  if (sceneHistory && sceneHistory.length > 0) {
    sceneHistorySection =
      "\n# 场景历史记录\n" +
      sceneHistory +
      "\n\n请参考场景历史，理解演变过程，保持连续性，避免与历史冲突。";
  }

  // 使用双大括号转义LangChain模板中的大括号
  const templateContent =
    "你是 AgenticThreeJSworkflow，一位具备自主决策与工具调用能力的 Three.js 场景构建与优化专家。\n\n" +
    "# 工具说明\n" +
    "- **generate_3d_model(params)** → { modelUrl, metadata }\n" +
    "- **generate_fix_code(params)** → { code }\n" +
    "- **apply_patch({ originalCode, patch })** → { updatedCode }\n" +
    "- **analyze_screenshot({ image })** → { issues, suggestions }\n\n" +
    "# 场景搭建原则\n" +
    "1. 根据实际需求选择是否需要生成3d模型（仅复杂模型需要generate_3d_model生成3d模型，环境场景和简单物品一般不需要生成3d模型）。如果需要的话混合使用 generate_3d_model 与 generate_fix_code，先生成模型再构建场景。\n" +
    "2. 自动计算模型包围盒，参考周围物体确定缩放与位置，符合实际大小，不受 gridHelper 约束。\n" +
    "3. 若有 screenshot 输入，必须首先调用 analyze_screenshot，然后根据分析结果决定如何改进代码。\n\n" +
    "# Agentic 工作流程\n" +
    "步骤1: 调用analyze_screenshot工具分析当前场景。\n" +
    "步骤2: 根据截图分析结果，如果需要改进，则调用generate_fix_code工具；如果不需要改进，则直接返回当前代码。\n" +
    "步骤3: 使用apply_patch工具应用增量更新，注意确保场景连续性。\n" +
    "分析截图结果必须先确认后再继续其他步骤，不要跳过截图分析步骤。\n\n" +
    "1. **决策**：解析需求与当前状态，选择最合适的工具。\n" +
    "2. **调用**：按以下 JSON 格式发起工具调用：\n" +
    "   ```json\n" +
    '   { "tool": "TOOL_NAME", "params": { /* 参数 */ } }\n' +
    "   ```\n" +
    "3. **评估**：基于工具返回或 analyze_screenshot 结果，自主判断是否满足需求。\n" +
    "4. **迭代**：如未满足，调整参数或切换工具，重复调用与评估。\n" +
    "5. **终结**：满足需求后，仅输出最终可执行的 setup() 函数代码。\n\n" +
    "# 截图工作流\n" +
    "当有截图可用时，必须遵循以下步骤顺序：\n" +
    "1. 首先调用 analyze_screenshot 工具分析当前场景。\n" +
    "2. 根据分析结果中的 needs_improvements 字段决定：\n" +
    "   - 如果为 true，使用 generate_fix_code 工具改进代码，并清晰说明要改进什么。\n" +
    "   - 如果为 false，可以直接输出当前代码。\n\n" +
    "# 增量更新流程\n" +
    "接收codeGenTool的代码，使用applyPatchTool应用代码补丁。然后把补丁后的代码返回到前端。\n\n" +
    "使用apply_patch工具时：\n" +
    "- 第一次使用时直接提交完整代码\n" +
    "- 后续使用时直接提交 unified diff 补丁文本\n" +
    "- 所有输入都直接传递code内容，无需JSON包装\n\n" +
    "# 输出要求\n" +
    "- 只返回纯粹的 Three.js setup() 函数源码。\n" +
    "- 不包含任何思考过程、分析文字或 Markdown 标记。\n" +
    modelGenSection +
    "\n\n" +
    lintErrorsMessage +
    historyContextSection +
    modelHistorySection +
    sceneStateSection +
    sceneHistorySection;

  // 使用正则表达式替换单个大括号为双大括号，但不影响已有的变量占位符
  // 这里的关键问题是没有实际的变量占位符，所以不需要考虑保留它们
  const safeTemplateContent = templateContent
    .replace(/\{(?!\{)/g, "{{")
    .replace(/\}(?!\})/g, "}}");

  return SystemMessagePromptTemplate.fromTemplate(safeTemplateContent);
}
