// lib/processors/modelExtractor.ts

/**
 * 从代码中提取模型URL
 */
export function extractModelUrls(code: string) {
  const modelUrls: Array<{ url: string; name: string }> = [];
  let primaryModelUrl: string | null = null;

  // 检查MODEL_URL注释格式
  const modelUrlMatch = code.match(/\/\/\s*MODEL_URL:\s*(\S+)/);
  if (modelUrlMatch && modelUrlMatch[1]) {
    primaryModelUrl = modelUrlMatch[1];
    modelUrls.push({ url: primaryModelUrl, name: "model.glb" });
  }

  // 检查代码中嵌入的Hyper3D URL
  const hyper3dMatches = code.match(
    /['"]https:\/\/hyperhuman-file\.deemos\.com\/[^'"]+\.glb[^'"]*['"]/g
  );
  if (hyper3dMatches && hyper3dMatches.length > 0) {
    hyper3dMatches.forEach((match: string, index: number) => {
      const url = match.replace(/^['"]|['"]$/g, "");
      if (!primaryModelUrl) {
        primaryModelUrl = url;
      }
      modelUrls.push({ url, name: `model_${index}.glb` });
    });
  }

  return {
    modelUrl: primaryModelUrl,
    modelUrls: modelUrls.length > 0 ? modelUrls : null,
  };
}
