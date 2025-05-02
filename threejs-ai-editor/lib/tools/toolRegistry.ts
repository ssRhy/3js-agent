// lib/tools/toolRegistry.ts
import { Tool } from "langchain/tools";
import { StructuredTool } from "@langchain/core/tools";
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
}

/**
 * 工具注册中心
 */
export class ToolRegistry {
  private static instance: ToolRegistry;
  private tools: Map<string, Tool | StructuredTool> = new Map();
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
    this.registerTool(codeGenTool.name, codeGenTool, ToolCategory.CODE);

    // 注册模型生成工具
    this.registerTool(modelGenTool.name, modelGenTool, ToolCategory.MODEL);

    // 注册补丁应用工具
    this.registerTool(applyPatchTool.name, applyPatchTool, ToolCategory.CODE);

    // 注册截图分析工具
    this.registerTool(
      screenshotTool.name,
      screenshotTool,
      ToolCategory.UTILITY
    );

    console.log("[ToolRegistry] Initialized tools");
    this.initialized = true;
  }

  /**
   * 注册工具
   */
  public registerTool(
    name: string,
    tool: Tool | StructuredTool,
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
   */
  public getTool(name: string): Tool | StructuredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取所有工具
   */
  public getAllTools(category?: ToolCategory): Tool[] {
    const tools: Tool[] = [];

    this.tools.forEach((tool, name) => {
      if (!category || this.toolCategories.get(name) === category) {
        tools.push(tool as Tool);
      }
    });

    return tools;
  }

  /**
   * 获取特定类别的工具
   */
  public getToolsByCategory(category: ToolCategory): Tool[] {
    return this.getAllTools(category);
  }
}
