// 模型相关类型定义

// 模型生成选项接口
export interface ModelGenerationOptions {
  prompt: string;
  style?: string;
  quality?: "draft" | "standard" | "high";
  format?: "glb" | "gltf" | "usdz";
}

// 模型提取结果接口
export interface ModelExtractionResult {
  modelUrls: string[];
  extractedCount: number;
}
