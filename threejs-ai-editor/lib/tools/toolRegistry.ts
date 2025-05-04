// lib/tools/toolRegistry.ts
import { Tool } from "langchain/tools";
import { codeGenTool } from "./codeGenTool";
import { modelGenTool } from "./modelGenTool";
import { applyPatchTool } from "./applyPatchTool";
import { screenshotTool } from "./screenshotTool";

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
}

/**
 * 工具注册中心
 * 单例模式管理所有可用的Agent工具
 */
export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools: Map<string, Tool> = new Map();
  private toolCategories: Map<string, ToolCategory> = new Map();
  private initialized: boolean = false;

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
}
