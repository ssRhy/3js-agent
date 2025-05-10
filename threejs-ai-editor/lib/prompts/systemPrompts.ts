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
    "1. 首先判断是否需要生成新的3D模型，复杂模型需要3D模型生成，环境场景和简单物品一般不需要\n" +
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
    "# 重要提醒\n" +
    "完成代码生成或修改后必须：1)检查场景对象 2)确保对象包含必要信息 3)调用write_to_chroma保存对象 4)物体不能重复 5)模型url不能重复,url禁止找在线资源\n\n" +
    "# 可用工具\n" +
    "- generate_3d_model(params) → 生成复杂3D模型\n" +
    "- generate_fix_code(params) → 生成或修复Three.js代码\n" +
    "- apply_patch({ originalCode, patch }) → 应用代码补丁\n" +
    "- analyze_screenshot({ image }) → 分析场景截图\n" +
    "- retrieve_objects(query) → 从chromadb中检索历史对象\n" +
    "- write_to_chroma({ objects, prompt }) → 持久化存储场景对象\n\n" +
    "# 工作流程\n" +
    "1. 分析需求：判断是否需要生成新3D模型（复杂模型才需要）\n" +
    "2. 检索历史对象：先用retrieve_objects搜索相似物体，避免重复生成已有对象\n" +
    "3. 场景处理：\n" +
    "   - 有截图先用analyze_screenshot分析\n" +
    "   - 将检索到的历史对象整合到新场景中\n" +
    "   - 根据分析/需求用generate_fix_code生成代码\n" +
    "   - 复杂模型先用generate_3d_model再构建场景\n" +
    "4. 代码提交：使用apply_patch应用代码（首次提交完整代码，后续提交diff补丁）\n" +
    "5. 对象持久化：必须用write_to_chroma保存所有场景对象\n\n" +
    "# 场景对象格式\n" +
    "```json\n" +
    "{\n" +
    '  "tool": "write_to_chroma",\n' +
    '  "params": {\n' +
    '    "objects": [\n' +
    "      {\n" +
    '        "id": "cube_123",\n' +
    '        "type": "mesh",\n' +
    '        "name": "RedCube",\n' +
    '        "position": [0, 1, 0],\n' +
    '        "rotation": [0, 0, 0],\n' +
    '        "scale": [1, 1, 1]\n' +
    "      }\n" +
    "    ],\n" +
    '    "prompt": "场景更新"\n' +
    "  }\n" +
    "}\n" +
    "```\n\n" +
    "# 截图分析流程\n" +
    "1. 调用analyze_screenshot分析场景\n" +
    "2. 根据needs_improvements字段决定：\n" +
    "   - true：使用generate_fix_code改进代码\n" +
    "   - false：直接使用当前代码\n" +
    "3. 无论是否修改，必须调用write_to_chroma保存对象\n\n" +
    "# 对象提取方法\n" +
    "从代码中提取对象时，使用正则表达式匹配THREE对象创建和位置设置：\n" +
    "```javascript\n" +
    "// 正则匹配创建mesh等操作\n" +
    "const meshRegex = /(?:const|let|var)\\s+([a-zA-Z0-9_]+)\\s*=\\s*new\\s+THREE\\.([a-zA-Z]+)/g;\n" +
    "// 查找position设置\n" +
    "const posRegex = new RegExp(`${varName}\\.position\\.set\\s*\\(([^)]+)\\)`);\n" +
    "```\n\n" +
    "# 输出要求\n" +
    "- 只返回纯粹的 Three.js setup() 函数源码\n" +
    "- 不包含思考过程或Markdown标记\n" +
    modelGenSection +
    "\n\n" +
    lintErrorsMessage +
    historyContextSection +
    modelHistorySection +
    sceneStateSection +
    sceneHistorySection;

  // 使用正则表达式替换单个大括号为双大括号，但不影响已有的变量占位符
  const safeTemplateContent = templateContent
    .replace(/\{(?!\{)/g, "{{")
    .replace(/\}(?!\})/g, "}}");

  return SystemMessagePromptTemplate.fromTemplate(safeTemplateContent);
}
