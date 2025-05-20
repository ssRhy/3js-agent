import { Tool } from "@langchain/core/tools";
import { ToolRegistry } from "./toolRegistry";

/**
 * 工具缓存辅助功能
 * 提供包装工具的函数，添加缓存功能
 */

// 为了类型安全，定义带缓存标记的工具接口
interface CachedTool extends Tool {
  _isCached?: boolean;
}

/**
 * 创建带缓存功能的工具
 * @param tool 原始工具
 * @returns 包装后的工具（带缓存）
 */
export function createCachedTool(tool: Tool): Tool {
  // 检查工具是否已被缓存包装
  const cachedTool = tool as CachedTool;
  if (cachedTool._isCached) {
    return tool;
  }

  // 判断工具类型，决定缓存策略
  const isCostlyTool =
    tool.name === "generate_fix_code" ||
    tool.name === "generate_3d_model" ||
    tool.name === "analyze_screenshot";

  const originalCall = tool.call.bind(tool);

  // 创建带缓存功能的新工具
  const newTool: Tool = {
    ...tool,
    // 标记该工具已被缓存
    _isCached: true,
    // 重写工具的call方法，添加缓存逻辑
    call: async (input: Record<string, unknown>) => {
      const ttl = isCostlyTool ? 5 * 60 * 1000 : 30000; // 昂贵工具缓存5分钟，其他30秒

      try {
        // 获取ToolRegistry实例
        const registry = ToolRegistry.getInstance();
        return await registry.executeWithCache(tool.name, input, ttl);
      } catch (error) {
        console.error(`Error executing cached tool ${tool.name}:`, error);
        // 如果缓存执行失败，回退到原始调用
        return originalCall(input);
      }
    },
  } as unknown as Tool;

  return newTool;
}

/**
 * 为工具数组添加缓存功能
 * @param tools 工具数组
 * @returns 包装后的工具数组（带缓存）
 */
export function wrapToolsWithCache(tools: Tool[]): Tool[] {
  return tools.map((tool) => createCachedTool(tool));
}
