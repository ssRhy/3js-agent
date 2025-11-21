import type { NextApiRequest, NextApiResponse } from "next";
import { ToolRegistry } from "@/lib/tools/toolRegistry";

/**
 * API端点，用于查看和管理工具缓存统计信息
 * GET: 获取缓存统计信息
 * DELETE: 清除特定工具或所有工具的缓存
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const registry = ToolRegistry.getInstance();

  // 设置跨域头，允许从编辑器访问
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // 处理预检请求
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    // 获取缓存统计信息
    if (req.method === "GET") {
      const stats = registry.getCacheStats();
      const hitRate = registry.getHitRate();

      return res.status(200).json({
        stats,
        hitRate,
        message: `Cache hit rate: ${hitRate}% (${stats.hits} hits, ${stats.misses} misses, ${stats.totalCalls} total calls)`,
      });
    }

    // 清除缓存
    else if (req.method === "DELETE") {
      // 可以指定要清除的特定工具缓存
      const { tool } = req.query;

      if (tool && typeof tool === "string") {
        registry.clearCache(tool);
        return res.status(200).json({
          success: true,
          message: `Cleared cache for tool: ${tool}`,
        });
      } else {
        // 清除所有缓存
        registry.clearCache();
        return res.status(200).json({
          success: true,
          message: "Cleared all tool caches",
        });
      }
    }

    // 不支持的方法
    else {
      return res.status(405).json({
        error: "Method Not Allowed",
        message: "This endpoint only supports GET and DELETE methods",
      });
    }
  } catch (error) {
    console.error("Error in cache stats API endpoint:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
