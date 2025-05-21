// lib/tools/toolRegistry.ts
import { Tool } from "@langchain/core/tools";

import { codeGenTool } from "./codeGenTool";
import { modelGenTool } from "./modelGenTool";
import { applyPatchTool } from "@/lib/tools/applyPatchTool";
import { screenshotTool } from "./screenshotTool";
import { retrievalTool } from "./retrievalTool";
import { writeChromaTool } from "./writeChromaTool";

/**
 * 工具类别枚举
 */
export enum ToolCategory {
  CODE = "code",
  MODEL = "model",
  UTILITY = "utility",
  CODE_GEN = "codeGenTool",
  MODEL_GEN = "modelGenTool",
  SEARCH = "search",
  STORAGE = "storage",
}

/**
 * 缓存条目接口
 */
interface CacheEntry {
  result: unknown;
  timestamp: number;
  ttl: number; // Time-to-live in milliseconds
}

/**
 * 工具参数类型
 */
type ToolParams = Record<string, unknown>;

/**
 * 工具注册中心
 * 单例模式管理所有可用的Agent工具
 */
export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools: Map<string, Tool> = new Map();
  private toolCategories: Map<string, ToolCategory> = new Map();
  private initialized: boolean = false;
  // 添加结果缓存
  private toolResultCache: Map<string, CacheEntry> = new Map();
  // 缓存统计
  private cacheStats = {
    hits: 0,
    misses: 0,
    totalCalls: 0,
  };

  private constructor() {}

  /**
   * 获取单例实例
   */
  public static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
      ToolRegistry.instance.initializeTools();
    }
    return ToolRegistry.instance;
  }

  /**
   * 初始化默认工具
   */
  private initializeTools(): void {
    if (this.initialized) return;

    // 注册代码生成工具
    this.registerTool(
      codeGenTool.name,
      codeGenTool as unknown as Tool,
      ToolCategory.CODE
    );

    // 注册模型生成工具
    this.registerTool(
      modelGenTool.name,
      modelGenTool as unknown as Tool,
      ToolCategory.MODEL
    );

    // 注册补丁应用工具
    this.registerTool(
      applyPatchTool.name,
      applyPatchTool as unknown as Tool,
      ToolCategory.CODE
    );

    // 注册截图分析工具
    this.registerTool(
      screenshotTool.name,
      screenshotTool as unknown as Tool,
      ToolCategory.UTILITY
    );

    // 注册ChromaDB检索工具
    this.registerTool(
      retrievalTool.name,
      retrievalTool as unknown as Tool,
      ToolCategory.SEARCH
    );

    // 注册ChromaDB写入工具
    this.registerTool(
      writeChromaTool.name,
      writeChromaTool as unknown as Tool,
      ToolCategory.STORAGE
    );

    console.log("[ToolRegistry] Initialized tools");
    this.initialized = true;
  }

  /**
   * 注册工具
   * @param name 工具名称
   * @param tool 工具实例
   * @param category 工具类别
   */
  public registerTool(
    name: string,
    tool: Tool,
    category: ToolCategory = ToolCategory.UTILITY
  ): void {
    this.tools.set(name, tool);
    this.toolCategories.set(name, category);
    console.log(
      `[ToolRegistry] Registered tool "${name}" in category "${category}"`
    );
  }

  /**
   * 获取工具
   * @param name 工具名称
   * @returns 工具实例或undefined
   */
  public getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取所有工具
   * @param category 可选的工具类别过滤
   * @returns 工具数组
   */
  public getAllTools(category?: ToolCategory): Tool[] {
    const tools: Tool[] = [];

    this.tools.forEach((tool, name) => {
      if (!category || this.toolCategories.get(name) === category) {
        tools.push(tool);
      }
    });

    return tools;
  }

  /**
   * 获取特定类别的工具
   * @param category 工具类别
   * @returns 工具数组
   */
  public getToolsByCategory(category: ToolCategory): Tool[] {
    return this.getAllTools(category);
  }

  /**
   * 使用缓存执行工具
   * @param toolName 工具名称
   * @param params 工具参数
   * @param ttl 缓存生存时间（毫秒）
   * @returns 工具执行结果
   */
  public async executeWithCache(
    toolName: string,
    params: ToolParams,
    ttl: number = 30000
  ): Promise<unknown> {
    this.cacheStats.totalCalls++;

    // 特殊处理：3D模型生成工具永远不使用缓存
    if (toolName === "generate_3d_model") {
      console.log(
        `[ToolRegistry] Bypassing cache for ${toolName} - using direct execution`
      );

      // 获取工具并直接执行，不涉及缓存
      const tool = this.getTool(toolName);
      if (!tool) {
        throw new Error(`Tool "${toolName}" not found in registry`);
      }

      try {
        return await tool.call(params);
      } catch (error) {
        console.error(
          `[ToolRegistry] Error executing tool ${toolName}:`,
          error
        );
        throw error;
      }
    }

    // 生成缓存键，包含工具名称和参数的哈希
    const cacheKey = this.generateCacheKey(toolName, params);

    // 检查缓存中是否有有效的结果
    const cachedEntry = this.toolResultCache.get(cacheKey);
    if (cachedEntry && Date.now() - cachedEntry.timestamp < cachedEntry.ttl) {
      this.cacheStats.hits++;
      console.log(
        `[ToolRegistry] Cache hit for ${toolName} (hit rate: ${this.getHitRate()}%)`
      );
      return cachedEntry.result;
    }

    this.cacheStats.misses++;
    console.log(
      `[ToolRegistry] Cache miss for ${toolName} (hit rate: ${this.getHitRate()}%)`
    );

    // 获取工具
    const tool = this.getTool(toolName);
    if (!tool) {
      throw new Error(`Tool "${toolName}" not found in registry`);
    }

    // 执行工具并缓存结果
    try {
      const result = await tool.call(params);

      // 存储结果到缓存
      this.toolResultCache.set(cacheKey, {
        result,
        timestamp: Date.now(),
        ttl,
      });

      return result;
    } catch (error) {
      console.error(`[ToolRegistry] Error executing tool ${toolName}:`, error);
      throw error;
    }
  }

  /**
   * 清除特定工具的缓存
   * @param toolName 工具名称（如果未提供则清除所有缓存）
   */
  public clearCache(toolName?: string): void {
    if (toolName) {
      // 清除特定工具的缓存
      const keysToDelete: string[] = [];

      this.toolResultCache.forEach((_, key) => {
        if (key.startsWith(`${toolName}:`)) {
          keysToDelete.push(key);
        }
      });

      keysToDelete.forEach((key) => {
        this.toolResultCache.delete(key);
      });

      console.log(`[ToolRegistry] Cleared cache for tool: ${toolName}`);
    } else {
      // 清除所有缓存
      this.toolResultCache.clear();
      console.log(`[ToolRegistry] Cleared all tool caches`);
    }
  }

  /**
   * 获取缓存命中率
   */
  public getHitRate(): number {
    if (this.cacheStats.totalCalls === 0) return 0;
    return Math.round(
      (this.cacheStats.hits / this.cacheStats.totalCalls) * 100
    );
  }

  /**
   * 获取缓存统计信息
   */
  public getCacheStats(): typeof this.cacheStats {
    return { ...this.cacheStats };
  }

  /**
   * 生成缓存键
   * @param toolName 工具名称
   * @param params 工具参数
   * @returns 缓存键
   */
  private generateCacheKey(toolName: string, params: ToolParams): string {
    // 过滤掉某些不应该影响缓存键的参数（例如时间戳）
    const filteredParams: ToolParams = { ...params };

    // 移除timestamp类型的参数，因为它们每次调用都会不同
    if (filteredParams.timestamp) delete filteredParams.timestamp;
    if (filteredParams.requestId) delete filteredParams.requestId;

    // 为了确保一致的JSON字符串（对象属性顺序），我们对键进行排序
    const sortedParams = this.sortObjectKeys(filteredParams);

    return `${toolName}:${JSON.stringify(sortedParams)}`;
  }

  /**
   * 对象键排序（递归）
   * @param obj 要排序的对象
   * @returns 键已排序的对象
   */
  private sortObjectKeys(obj: unknown): unknown {
    // 如果不是对象或是数组，直接返回
    if (obj === null || typeof obj !== "object") return obj;

    // 如果是数组，递归排序数组中的每个对象
    if (Array.isArray(obj)) {
      return obj.map((item) => this.sortObjectKeys(item));
    }

    // 对对象的键进行排序
    return Object.keys(obj as object)
      .sort()
      .reduce<Record<string, unknown>>((sorted, key) => {
        sorted[key] = this.sortObjectKeys(
          (obj as Record<string, unknown>)[key]
        );
        return sorted;
      }, {});
  }
}
