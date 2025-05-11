// URL validation configuration
interface ValidationOptions {
  timeoutMs: number;
  retries: number;
  retryDelayMs: number;
}

// Response from URL validation
interface ValidationResult {
  isValid: boolean;
  url: string;
  statusCode?: number;
  contentType?: string;
  contentLength?: number;
  error?: string;
  responseTimeMs?: number;
}

/**
 * Validates a URL - 不再执行实际验证，总是返回URL有效
 * 仅检查基本格式以避免明显无效的URL
 */
export async function validateUrl(
  url: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options: Partial<ValidationOptions> = {}
): Promise<ValidationResult> {
  // 仅做最基本的字符串格式检查
  if (!url || typeof url !== "string") {
    return {
      isValid: false,
      url: url || "",
      error: "Invalid URL: URL must be a non-empty string",
    };
  }

  // 仅检查URL是否具有有效的协议
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return {
      isValid: false,
      url,
      error: "Invalid URL: URL must start with http:// or https://",
    };
  }

  try {
    // 仅验证URL格式
    new URL(url);
    // 直接返回URL有效的结果
    return {
      isValid: true,
      url,
      responseTimeMs: 0,
    };
  } catch (error) {
    return {
      isValid: false,
      url,
      error: `Invalid URL format: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * Validates a collection of URLs - 不执行实际验证
 */
export async function validateUrls(
  urls: string[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options: Partial<ValidationOptions> = {}
): Promise<ValidationResult[]> {
  if (!urls || !Array.isArray(urls)) return [];
  return Promise.all(urls.map((url) => validateUrl(url, _options)));
}

/**
 * 不过滤URL，返回所有输入项
 */
export async function filterValidUrlItems<T extends Record<string, unknown>>(
  items: T[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _urlProperty: keyof T = "url" as keyof T,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options: Partial<ValidationOptions> = {}
): Promise<T[]> {
  // 不执行过滤，返回所有项目
  return items || [];
}

/**
 * Process model URLs - 不执行验证，返回所有URL
 */
export async function processModelUrls(
  downloadUrls: Array<{ name: string; url: string }>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options: Partial<ValidationOptions> = {}
): Promise<Array<{ name: string; url: string }>> {
  if (
    !downloadUrls ||
    !Array.isArray(downloadUrls) ||
    downloadUrls.length === 0
  ) {
    console.warn("No download URLs provided");
    return [];
  }

  console.log(
    `收到 ${downloadUrls.length} 个模型URL - 已跳过验证，保留所有URL`
  );

  // 返回所有URL，不执行验证
  return downloadUrls;
}
