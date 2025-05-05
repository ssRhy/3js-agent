import { extractModelUrls } from "./modelExtractor";

/**
 * 匹配代码中可能包含的其他类型模型URL（扩展extractModelUrls的功能）
 */
function findAdditionalModelUrls(
  code: string
): Array<{ url: string; name: string }> {
  const additionalUrls: Array<{ url: string; name: string }> = [];

  // 匹配更多可能的模型URL格式
  // 1. 匹配其他域名上的.glb, .gltf文件
  const generalModelMatches = code.match(
    /['"]https?:\/\/[^'"]+\.(glb|gltf)(\?[^'"]*)?['"]/g
  );
  if (generalModelMatches && generalModelMatches.length > 0) {
    generalModelMatches.forEach((match: string, index: number) => {
      const url = match.replace(/^['"]|['"]$/g, "");
      additionalUrls.push({ url, name: `external_model_${index}.glb` });
    });
  }

  // 2. 匹配直接赋值给变量的URL（不带引号）
  const variableAssignmentMatches = code.match(
    /(\w+)\s*=\s*["']?(https?:\/\/[^'"]+\.(glb|gltf)(\?[^'"]*)?)['";\s)]/g
  );
  if (variableAssignmentMatches && variableAssignmentMatches.length > 0) {
    variableAssignmentMatches.forEach((match: string) => {
      // 从匹配中提取实际的URL
      const urlMatch = match.match(/https?:\/\/[^'"]+\.(glb|gltf)(\?[^'"]*)?/);
      if (urlMatch && urlMatch[0]) {
        additionalUrls.push({ url: urlMatch[0], name: `var_model.glb` });
      }
    });
  }

  return additionalUrls;
}

/**
 * 将原始URL替换为代理URL
 */
function createProxyUrl(originalUrl: string): string {
  return `/api/proxy-model?url=${encodeURIComponent(originalUrl)}`;
}

/**
 * 静态分析代码并替换所有模型URL为代理URL
 */
export function processCodeAndReplaceUrls(code: string): string {
  if (!code || typeof code !== "string") {
    return code;
  }

  // 1. 使用modelExtractor获取基本URL
  const { modelUrls } = extractModelUrls(code);

  // 2. 查找其他可能的URL
  const additionalUrls = findAdditionalModelUrls(code);

  // 3. 合并所有URL
  const allUrls = [...(modelUrls || []), ...additionalUrls];

  // 如果没有发现任何URL，直接返回原始代码
  if (allUrls.length === 0) {
    return code;
  }

  // 4. 替换所有URL
  let processedCode = code;

  allUrls.forEach(({ url }) => {
    // 处理带引号的URL（字符串字面量）
    const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const proxyUrl = createProxyUrl(url);

    // 替换单引号、双引号和反引号包围的URL
    const quotedUrlRegex = new RegExp(`(['"\`])${escapedUrl}(['"\`])`, "g");
    processedCode = processedCode.replace(quotedUrlRegex, `$1${proxyUrl}$2`);

    // 替换可能直接赋值的URL（没有引号的情况）
    const unquotedUrlRegex = new RegExp(`(=\\s*)${escapedUrl}([\\s;,)])`, "g");
    processedCode = processedCode.replace(unquotedUrlRegex, `$1${proxyUrl}$2`);

    // 替换作为函数参数的URL
    const paramUrlRegex = new RegExp(`(\\(\\s*)${escapedUrl}([\\s,)])`, "g");
    processedCode = processedCode.replace(paramUrlRegex, `$1${proxyUrl}$2`);
  });

  // 5. 添加辅助函数，用于处理代码中动态构建的URL
  const helperCode = `
// 自动代理外部模型URL的辅助函数
function ensureProxiedModelUrl(url) {
  if (!url || typeof url !== 'string') return url;
  if (!url.startsWith('http') || url.includes('/api/proxy-model')) return url;
  
  // 检查是否是模型URL（.glb, .gltf等）
  if (url.match(/\\.(glb|gltf)(\\?|$)/)) {
    console.log('自动代理模型URL:', url);
    return \`/api/proxy-model?url=\${encodeURIComponent(url)}\`;
  }
  
  return url;
}

// 重写fetch以自动代理模型请求
const originalFetch = window.fetch;
window.fetch = function(input, init) {
  if (typeof input === 'string') {
    input = ensureProxiedModelUrl(input);
  } else if (input instanceof Request) {
    input = new Request(ensureProxiedModelUrl(input.url), input);
  }
  return originalFetch(input, init);
};
`;

  // 6. 在代码开头插入辅助函数
  processedCode = helperCode + "\n\n" + processedCode;

  return processedCode;
}

/**
 * 生成模型URL诊断报告
 */
export function generateUrlDiagnostics(code: string): {
  foundUrls: Array<{ url: string; name: string; proxied: string }>;
  diagnosticMessage: string;
} {
  // 基本URL
  const { modelUrls } = extractModelUrls(code);

  // 其他URL
  const additionalUrls = findAdditionalModelUrls(code);

  // 合并所有URL
  const allUrls = [...(modelUrls || []), ...additionalUrls];

  // 生成诊断信息
  const foundUrls = allUrls.map(({ url, name }) => ({
    url,
    name,
    proxied: createProxyUrl(url),
  }));

  let diagnosticMessage = "";

  if (foundUrls.length === 0) {
    diagnosticMessage = "未在代码中发现任何模型URL。";
  } else {
    diagnosticMessage = `在代码中发现了 ${foundUrls.length} 个模型URL，已全部替换为代理URL。`;
  }

  return {
    foundUrls,
    diagnosticMessage,
  };
}
