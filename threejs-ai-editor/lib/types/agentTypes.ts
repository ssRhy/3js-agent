
import { LintError } from "./codeTypes";
import { ModelHistoryEntry, SceneStateObject } from "./sceneTypes";
import { NextApiResponse } from "next";

// Agent类型枚举
export enum AgentType {
  STANDARD = "standard",
  MODEL_GENERATION = "model_generation",
  CODE_ONLY = "code_only",
}

// Agent配置接口
export interface AgentOptions {
  type?: AgentType;
  lintErrors?: LintError[];
  historyContext?: string;
  modelHistory?: ModelHistoryEntry[];
  sceneState?: SceneStateObject[];
  sceneHistory?: string;
  maxIterations?: number;
}

// Agent执行结果接口
export interface AgentExecutionResult {
  success: boolean;
  output: string;
  error?: Error | string;
  iterations: number;
}

// Agent执行配置接口
export interface AgentExecutionOptions extends AgentOptions {
  maxIterations?: number;
  sessionId?: string;
  res?: NextApiResponse;
}

// API请求处理结果接口
export interface ApiHandlerResult {
  success: boolean;
  output?: string;
  error?: string;
} 