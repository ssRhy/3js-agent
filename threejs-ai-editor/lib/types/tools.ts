import { applyPatchTool } from "@/lib/tools/applyPatchTool";
import { codeGenTool } from "@/lib/tools/codeGenTool";
import { modelGenTool } from "@/lib/tools/modelGenTool";
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
  apply_patch: applyPatchTool,
  generate_code: codeGenTool,
  generate_3d_model: modelGenTool,
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
  // 检查 tool.invoke 是否需要 JSON.parse
  return await tool.invoke(JSON.parse(input));
}
