/**
 * URL Validator for Three.js code - 完全禁用验证
 *
 * 所有URL都不经过验证直接通过，因为模型生成工具生成的URL必须是完整的，不能被过滤。
 */
import { extractModelUrls } from "./modelExtractor";

/**
 * 仅用于记录的URL提取功能
 */
export function extractUrlsFromCode(code: string): string[] {
  if (!code || typeof code !== "string") {
    return [];
  }

  // 使用专门的模型提取器
  const { modelUrls } = extractModelUrls(code);
  return modelUrls ? modelUrls.map((item) => item.url) : [];
}

/**
 * 不执行验证 - 返回所有URL都有效
 */
export async function validateCodeUrls(code: string): Promise<{
  isValid: boolean;
  validUrls: string[];
  invalidUrls: Array<{ url: string; error: string }>;
  validatedCode: string;
}> {
  // 仅提取URL用于日志记录
  const urls = extractUrlsFromCode(code);

  if (urls.length > 0) {
    console.log(
      `在代码中发现 ${urls.length} 个URL - URL验证已禁用，所有URL都视为有效`
    );
  }

  // 返回所有URL都有效的结果
  return {
    isValid: true,
    validUrls: urls,
    invalidUrls: [],
    validatedCode: code,
  };
}

/**
 * 始终返回原始代码，不做任何验证或修改
 */
export async function ensureValidUrlsInCode(code: string): Promise<string> {
  // 记录URL但不验证
  const urls = extractUrlsFromCode(code);
  if (urls.length > 0) {
    console.log(`代码包含 ${urls.length} 个URL - URL验证已禁用，保持代码不变`);
  }

  // 始终返回原始代码
  return code;
}
