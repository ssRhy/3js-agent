import { diffTool } from "./diffTool";
import { lintTool } from "./lintTool";
import { applyPatchTool } from "./applyPatchTool";
import { codeGenTool } from "./codeGenTool";
// 工具结果类型
export interface ToolResult {
  [key: string]:
    | string
    | number
    | boolean
    | ToolResult
    | ToolResult[]
    | null
    | undefined;
}

// 工具映射表
const tools = {
  lint: lintTool,
  diff: diffTool,
  apply_patch: applyPatchTool,
  generate_code: codeGenTool,
};

// 工具执行函数
export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const tool = tools[name as keyof typeof tools];
  if (!tool) {
    throw new Error(`未知工具: ${name}`);
  }

  // 对于 DynamicTool，将 args 转换为 JSON 字符串
  const input = typeof args === "string" ? args : JSON.stringify(args);
  return await tool.invoke(input);
}
