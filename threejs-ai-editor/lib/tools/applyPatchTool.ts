import { applyPatch, parsePatch } from "diff";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { BufferMemory } from "langchain/memory";

// 保存在内存中的代码
let cachedCode: string | null = null;

// 创建内存实例，用于存储补丁历史
const patchMemory = new BufferMemory({
  memoryKey: "patchHistory",
  inputKey: "patch",
  returnMessages: false,
});

// 补丁记录存储
export interface PatchRecord {
  timestamp: string;
  patchContent: string;
  description?: string;
}

// 存储最近的补丁记录
let patchHistory: PatchRecord[] = [];
const MAX_HISTORY_SIZE = 5; // 保留最近的5个补丁

/**
 * Apply Patch Tool - 应用补丁到内存中保存的代码
 */
export const applyPatchTool = new DynamicStructuredTool({
  name: "apply_patch",
  description:
    "应用unified diff格式的补丁到内存中保存的代码。可以提交两种格式：1) 包含完整代码，用于初始化：{ code: string } 2) 包含标准unified diff补丁：{ patch: string, description?: string }。初次必须先提交完整代码，之后只需提交补丁文本即可增量更新。",
  schema: z.object({
    input: z
      .string()
      .describe(
        "JSON格式的输入，初次使用时应包含 { code: string }，后续使用时包含 { patch: string, description?: string }"
      ),
  }),
  func: async ({ input }) => {
    try {
      console.log("接收到的输入类型:", typeof input, "长度:", input.length);

      // 解析输入
      let params;
      try {
        params = JSON.parse(input);
        console.log("解析成功，键:", Object.keys(params));
      } catch (jsonError) {
        return JSON.stringify({
          success: false,
          message: "输入格式错误，需要有效的JSON格式",
          error:
            jsonError instanceof Error ? jsonError.message : String(jsonError),
        });
      }

      // 提取参数
      const { code, patch, description } = params;

      // 情况1: 初始化代码
      if (code) {
        console.log("初始化代码");
        cachedCode = code;

        // 清空补丁历史
        patchHistory = [];

        // 更新内存
        await patchMemory.saveContext(
          { patch: "initial" },
          { latestCode: code }
        );

        // 由于前面刚刚赋值，所以这里 cachedCode 一定不为 null
        return JSON.stringify({
          success: true,
          message: "代码已成功缓存，准备接收补丁进行增量更新",
          codeLength: code.length,
        });
      }

      // 情况2: 应用补丁
      if (patch) {
        console.log("应用补丁模式");

        // 检查是否已有缓存的代码
        if (!cachedCode) {
          return JSON.stringify({
            success: false,
            message: "没有缓存的代码，请先使用 { code: string } 初始化代码",
          });
        }

        // 验证补丁格式
        try {
          const patches = parsePatch(patch);
          if (patches.length === 0) {
            console.log("补丁没有实际更改");
            return JSON.stringify({
              success: false,
              message: "补丁格式有效，但没有实际的更改",
            });
          }

          // 应用补丁到缓存的代码
          const result = applyPatch(cachedCode, patch);

          // 处理应用结果 - diff库的typings有些问题，这里做更精确的类型处理
          if (typeof result === "boolean") {
            return JSON.stringify({
              success: false,
              message: "补丁应用失败，可能与当前代码不匹配",
            });
          } else if (typeof result === "string") {
            // 记录此次补丁
            const patchRecord: PatchRecord = {
              timestamp: new Date().toISOString(),
              patchContent: patch,
              description:
                description || `Patch applied at ${new Date().toISOString()}`,
            };

            // 添加到历史记录并限制大小
            patchHistory.unshift(patchRecord);
            if (patchHistory.length > MAX_HISTORY_SIZE) {
              patchHistory.pop(); // 移除最旧的记录
            }

            // 保存到内存中
            await patchMemory.saveContext(
              { patch },
              {
                latestCode: result,
                patchDescription: description || "",
                patchTimestamp: patchRecord.timestamp,
              }
            );

            // 更新缓存的代码
            cachedCode = result;

            // 返回结构化JSON结果
            return JSON.stringify({
              success: true,
              message: "补丁应用成功",
              codeLength: result.length,
              // 仅返回更新后代码的前50个字符预览
              codePreview: result.substring(0, 50) + "...",
              updatedCode: result, // 返回完整更新后的代码
            });
          } else {
            // 处理意外的返回类型
            return JSON.stringify({
              success: false,
              message: "补丁应用返回了意外的类型结果",
            });
          }
        } catch (patchError) {
          console.error("补丁解析或应用错误:", patchError);
          return JSON.stringify({
            success: false,
            message: `补丁格式无效或应用失败: ${
              patchError instanceof Error
                ? patchError.message
                : String(patchError)
            }`,
            receivedPatchPreview: patch.substring(0, 200) + "...", // 仅显示前200个字符避免过大输出
          });
        }
      }

      // 既没有code也没有patch
      console.error("缺少必要参数", params);
      return JSON.stringify({
        success: false,
        message: "缺少必要参数，需要 { code: string } 或 { patch: string }",
        receivedParams: JSON.stringify(Object.keys(params)),
      });
    } catch (error) {
      console.error("应用补丁工具错误:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return JSON.stringify({
        success: false,
        message: `应用补丁失败: ${errorMessage}`,
      });
    }
  },
});

// 获取当前缓存的代码
export const getCachedCode = (): string | null => cachedCode;

// 清除缓存的代码
export const clearCachedCode = (): { success: boolean; message: string } => {
  cachedCode = null;
  patchHistory = [];
  return { success: true, message: "代码缓存已清除" };
};

// 直接更新缓存的代码
export const updateCachedCode = (
  newCode: string
): { success: boolean; message: string; codeLength: number } => {
  cachedCode = newCode;

  // 添加初始化记录
  patchHistory = [
    {
      timestamp: new Date().toISOString(),
      patchContent: "",
      description: "Direct code update",
    },
  ];

  return {
    success: true,
    message: "代码缓存已更新",
    codeLength: newCode.length,
  };
};

// 获取补丁历史记录
export const getPatchHistory = (): PatchRecord[] => {
  return [...patchHistory];
};

// 从内存加载最新的代码和补丁历史
export const loadFromMemory = async (): Promise<{
  latestCode: string | null;
  patchHistory: PatchRecord[];
}> => {
  try {
    const memoryVariables = await patchMemory.loadMemoryVariables({});
    return {
      latestCode: memoryVariables.latestCode || null,
      patchHistory: patchHistory,
    };
  } catch (error) {
    console.error("从内存加载失败:", error);
    return {
      latestCode: cachedCode,
      patchHistory: patchHistory,
    };
  }
};
