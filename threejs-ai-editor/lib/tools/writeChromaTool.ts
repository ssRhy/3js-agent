// lib/tools/writeChromaTool.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { chromaService } from "../services/chromaService";
import { SceneStateObject } from "../types/sceneTypes";

// 定义场景对象的 Zod 模式
const SceneObjectSchema = z
  .object({
    id: z.string().describe("对象的唯一标识符"),
    type: z.string().describe("对象的类型（如mesh、light等）"),
    name: z.string().optional().describe("对象的名称"),
    position: z
      .array(z.number())
      .optional()
      .describe("对象的位置坐标 [x, y, z]"),
    rotation: z
      .array(z.number())
      .optional()
      .describe("对象的旋转角度 [x, y, z]"),
    scale: z.array(z.number()).optional().describe("对象的缩放系数 [x, y, z]"),
    // 使用 record 允许存储额外的属性，如材质、几何体等
    geometry: z.any().optional().describe("对象的几何体定义"),
    material: z.any().optional().describe("对象的材质定义"),
    color: z.number().optional().describe("对象的颜色（十六进制数值）"),
    intensity: z.number().optional().describe("光源的强度"),
  })
  // 允许其他属性
  .passthrough();

// 定义工具输入模式
const WriteChromaInputSchema = z.object({
  objects: z.array(SceneObjectSchema).describe("要存储的场景对象数组"),
  prompt: z.string().describe("描述这些对象的提示或说明"),
});

// 使用 LangChain tool 函数创建工具
export const writeChromaTool = tool(
  async ({ objects, prompt }) => {
    try {
      const requestId = `write_chroma_${Date.now()}`;
      console.log(
        `[${requestId}] [WriteChromaTool] Starting storage operation`
      );
      console.log(
        `[${requestId}] [WriteChromaTool] Prompt: "${prompt.substring(0, 50)}${
          prompt.length > 50 ? "..." : ""
        }"`
      );
      console.log(
        `[${requestId}] [WriteChromaTool] Objects count: ${objects.length}`
      );

      // 验证每个对象是否有必需的字段
      const validObjects = objects.filter(
        (obj) =>
          obj && typeof obj.id === "string" && typeof obj.type === "string"
      ) as SceneStateObject[];

      if (validObjects.length === 0) {
        console.log(`[${requestId}] [WriteChromaTool] No valid objects found`);
        return JSON.stringify({
          success: false,
          message:
            "No valid objects found. Each object must have an id and type.",
        });
      }

      // 获取当前对象数量
      const objectIdsBeforeWrite = await chromaService.getAllObjectIds();
      console.log(
        `[${requestId}] [WriteChromaTool] Current objects in ChromaDB: ${objectIdsBeforeWrite.length}`
      );

      // 记录要存储的对象详情（仅限前5个）
      console.log(`[${requestId}] [WriteChromaTool] Objects to be stored:`);
      validObjects.slice(0, 5).forEach((obj, index) => {
        console.log(`  Object ${index + 1}/${validObjects.length}:`);
        console.log(`    ID: ${obj.id}`);
        console.log(`    Type: ${obj.type}`);
        console.log(`    Name: ${obj.name || "unnamed"}`);
        if (obj.position) {
          console.log(`    Position: ${JSON.stringify(obj.position)}`);
        }
      });

      if (validObjects.length > 5) {
        console.log(`  ... and ${validObjects.length - 5} more objects`);
      }

      // 存储对象到 ChromaDB
      const success = await chromaService.storeSceneObjects(
        validObjects,
        prompt
      );

      // 获取更新后的对象数量
      if (success) {
        const objectIdsAfterWrite = await chromaService.getAllObjectIds();
        console.log(
          `[${requestId}] [WriteChromaTool] Objects in ChromaDB after write: ${objectIdsAfterWrite.length}`
        );
        console.log(
          `[${requestId}] [WriteChromaTool] Added ${
            objectIdsAfterWrite.length - objectIdsBeforeWrite.length
          } new objects`
        );
      }

      // 返回结果
      return JSON.stringify({
        success,
        count: validObjects.length,
        message: success
          ? `Successfully stored ${validObjects.length} objects in ChromaDB`
          : "Failed to store objects in ChromaDB",
      });
    } catch (error) {
      console.error("[WriteChromaTool] Error storing objects:", error);
      return JSON.stringify({
        success: false,
        message: `Error storing objects: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  },
  {
    name: "write_to_chroma",
    description:
      "Stores Three.js objects in persistent storage (ChromaDB) for future retrieval and reuse. Use this tool after generating or modifying a scene to save important objects. Each object must have an id and type at minimum. Also include a prompt describing what these objects represent.",
    schema: WriteChromaInputSchema,
  }
);
