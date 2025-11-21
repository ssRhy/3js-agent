// 代码相关类型定义

// Lint错误接口
export interface LintError {
  ruleId: string | null;
  message: string;
  line: number;
  column: number;
  severity: number;
}

// 代码生成结果接口
export interface CodeGenResult {
  success: boolean;
  code?: string;
  message?: string;
}

// 代码补丁结果接口
export interface PatchResult {
  success: boolean;
  updatedCode?: string;
  message?: string;
}

// 代码分析结果接口
export interface CodeAnalysisResult {
  suggestion: string;
  modifiedCode?: string;
  errorMessage?: string;
}

// 代码处理选项接口
export interface CodeProcessingOptions {
  cleanOutput?: boolean;
  extractContent?: boolean;
  validateSyntax?: boolean;
}
