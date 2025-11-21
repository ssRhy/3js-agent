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

// 工具执行函数
export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    let result: unknown;

    switch (name) {
      case "apply_patch":
        result = await applyPatchTool.invoke({
          input: typeof args === "string" ? args : JSON.stringify(args),
        });
        break;

      case "generate_code":
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result = await codeGenTool.invoke(args as any);
        break;

      case "generate_3d_model":
        result = await modelGenTool.invoke(
          typeof args === "string" ? args : JSON.stringify(args)
        );
        break;

      default:
        throw new Error(`未知工具: ${name}`);
    }

    // Convert result to string
    let resultString: string;
    if (typeof result === "string") {
      resultString = result;
    } else if (result && typeof result === "object" && "content" in result) {
      resultString = String((result as { content: unknown }).content);
    } else {
      resultString = JSON.stringify(result);
    }

    // Parse result if it's a JSON string, otherwise return as-is
    try {
      return JSON.parse(resultString) as ToolResult;
    } catch {
      return { result: resultString } as ToolResult;
    }
  } catch (error) {
    console.error(`Error executing tool ${name}:`, error);
    throw error;
  }
}
