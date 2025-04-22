// diff 应用器，合并 patch 到原始代码
import { applyPatch as applyDiffPatch, parsePatch } from "diff";

/**
 * 应用 diff 补丁到原始代码
 * @param originalCode 原始代码
 * @param patch 补丁内容
 * @returns 应用补丁后的新代码
 */
export function applyDiff(originalCode: string, patch: string): string {
  console.log("applyDiff 函数被调用");
  console.log("原始代码:", originalCode);
  console.log("补丁内容:", patch);

  try {
    const patches = parsePatch(patch);
    console.log("解析后的补丁数量:", patches.length);

    if (patches.length === 0) {
      console.warn("没有有效的补丁可应用");
      return originalCode;
    }

    // 检查补丁是否有任何实际变化
    const hasChanges = patches.some((p) =>
      p.hunks.some((h) =>
        h.lines.some((l) => l.startsWith("+") || l.startsWith("-"))
      )
    );

    if (!hasChanges) {
      console.warn("补丁中没有实际的变化");
      return originalCode;
    }

    console.log("应用补丁...");
    const result = applyDiffPatch(originalCode, patches[0]);

    // diff 库的结果可能是字符串或数组
    const newCode =
      typeof result === "string" ? result : (result as unknown as string[])[0];

    // 验证新代码与原始代码是否相同
    if (newCode === originalCode) {
      console.warn("补丁应用后代码没有变化");
    } else {
      console.log("补丁应用成功，代码已更新");
    }

    return newCode;
  } catch (error) {
    console.error("应用补丁时发生错误:", error);
    return originalCode;
  }
}
