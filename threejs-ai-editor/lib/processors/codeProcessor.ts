/**
 * 提取文本内容 - 从LLM响应中获取
 */
export function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter((item) => typeof item === "object" && item?.type === "text")
      .map((item) => item.text || "")
      .join("\n");
  }

  return JSON.stringify(content);
}

/**
 * 清理和提取代码
 */
export function cleanCodeOutput(output: unknown): string {
  if (typeof output !== "string") {
    return "";
  }

  let codeOutput = output;

  // 提取HTML中的代码
  if (codeOutput.includes("<!DOCTYPE html>") || codeOutput.includes("<html>")) {
    const scriptMatch = codeOutput.match(/<script>([\s\S]*?)<\/script>/);
    if (scriptMatch && scriptMatch[1]) {
      codeOutput = scriptMatch[1].trim();
    }
  }

  // 移除Markdown代码块
  if (codeOutput.includes("```")) {
    const codeBlockMatch = codeOutput.match(
      /```(?:js|javascript|typescript)?([\s\S]*?)```/
    );
    if (codeBlockMatch && codeBlockMatch[1]) {
      codeOutput = codeBlockMatch[1].trim();
    } else {
      // Try to find any code block
      const allCodeBlocks = codeOutput.match(/```([\s\S]*?)```/g);
      if (allCodeBlocks && allCodeBlocks.length > 0) {
        // Use the largest code block (likely the actual code)
        const largestBlock = allCodeBlocks.reduce(
          (prev, current) => (current.length > prev.length ? current : prev),
          ""
        );
        if (largestBlock) {
          codeOutput = largestBlock.replace(/```/g, "").trim();
        }
      }
    }
  }

  // 使用更严格的代码检测逻辑，避免保留解释性文本
  const codeIndicators = [
    "function",
    "var ",
    "let ",
    "const ",
    "THREE.",
    "scene.add",
    "position.",
    "rotation.",
    "scale.",
    "new THREE.",
    "camera.",
    "renderer.",
    "mesh.",
    "material.",
    "geometry.",
    "light.",
    "addEventListener",
    ".position",
    ".rotation",
    ".scale",
    "Math.",
    "return ",
    "if(",
    "if (",
    "for(",
    "for (",
    "while(",
    "while (",
    "import ",
    "export ",
  ];

  // 检查是否包含解释性文本，如果是，尝试提取代码部分
  if (!codeIndicators.some((indicator) => codeOutput.includes(indicator))) {
    // 尝试检测是否是思考过程或解释文本
    const lines = codeOutput.split("\n");
    const codeLines = lines.filter((line) =>
      codeIndicators.some((indicator) => line.includes(indicator))
    );

    if (codeLines.length > 0) {
      codeOutput = codeLines.join("\n");
    } else {
      // 如果没有识别到代码行，返回一个基本函数结构
      codeOutput = `function setup(scene, camera, renderer, THREE, OrbitControls) {
        // 无法从响应中提取有效代码
        console.warn("无法从LLM响应中提取有效的代码");
        return scene;
      }`;
    }
  }

  // 确保代码是setup函数
  if (!codeOutput.includes("function setup")) {
    codeOutput = `function setup(scene, camera, renderer, THREE, OrbitControls) {
      /* Add the output here */
      ${codeOutput}
      return scene.children.find(child => child instanceof THREE.Mesh) || scene;
    }`;
  }

  return codeOutput;
}
