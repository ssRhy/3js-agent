// lib/tools/retrievalTool.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { chromaService } from "../services/chromaService";

// Define enhanced interface for objects with full data
interface EnhancedSceneObject {
  id: string;
  type: string;
  name?: string;
  position?: number[];
  rotation?: number[];
  scale?: number[];
  objectData?: string; // Full JSON serialized data
  [key: string]: unknown;
}

// 定义检索工具的输入模式
const RetrievalToolInputSchema = z.object({
  query: z
    .string()
    .describe("Search query, can be a semantic search word or object ID (use 'id:' prefix)"),
  limit: z.number().optional().default(10).describe("The maximum number of results to return"),
});

/**
 * RetrievalTool for fetching objects from ChromaDB
 * Used to retrieve Three.js objects from persistent storage based on semantic search
 */
export const retrievalTool = tool(
  async ({ query, limit = 10 }) => {
    try {
      const requestId = `retrieve_${Date.now()}`;
      console.log(
        `[${requestId}] [RetrievalTool] Tool called with query: "${query}", limit: ${limit}`
      );

      // 验证查询
      if (!query || query.trim() === "") {
        console.log(`[${requestId}] [RetrievalTool] Empty query provided`);
        return JSON.stringify({
          success: false,
          message: "Query must be a non-empty string",
          objects: [],
        });
      }

      // 获取当前对象数量
      const objectIdsBeforeRetrieval = await chromaService.getAllObjectIds();
      console.log(
        `[${requestId}] [RetrievalTool] Current object count in ChromaDB: ${objectIdsBeforeRetrieval.length}`
      );

      // 从 ChromaDB 检索对象
      const objects = await chromaService.retrieveSceneObjects(query, limit);

      console.log(
        `[${requestId}] [RetrievalTool] Retrieved ${objects.length} objects from ChromaDB matching query: "${query}"`
      );

      // 记录找到的对象的详细信息
      if (objects.length > 0) {
        console.log(
          `[${requestId}] [RetrievalTool] First few objects retrieved:`
        );
        objects.slice(0, 3).forEach((obj, index) => {
          console.log(`  Object ${index + 1}:`);
          console.log(`    ID: ${obj.id}`);
          console.log(`    Type: ${obj.type}`);
          console.log(`    Name: ${obj.name || "unnamed"}`);

          // 检查是否有完整的对象数据
          const enhancedObj = obj as EnhancedSceneObject;
          if (enhancedObj.objectData) {
            console.log(
              `    Has full object data: Yes (${Math.round(
                enhancedObj.objectData.length / 1024
              )} KB)`
            );

            // 记录额外的有用信息
            try {
              const objectData = JSON.parse(enhancedObj.objectData);
              if (objectData.geometries) {
                console.log(
                  `    Geometry types: ${objectData.geometries
                    .map((g: { type: string }) => g.type)
                    .join(", ")}`
                );
              }
              if (objectData.materials) {
                console.log(
                  `    Material types: ${objectData.materials
                    .map((m: { type: string }) => m.type)
                    .join(", ")}`
                );
              }
            } catch (e) {
              console.log(`    Error parsing objectData: ${e}`);
            }
          } else {
            console.log(`    Has full object data: No`);
          }
        });

        if (objects.length > 3) {
          console.log(`  ... and ${objects.length - 3} more objects`);
        }
      }

      // 格式化并返回结果
      return JSON.stringify({
        success: true,
        count: objects.length,
        objects,
        message:
          objects.length > 0
            ? `Successfully retrieved ${objects.length} objects, including ${
                objects.filter((obj) => (obj as EnhancedSceneObject).objectData)
                  .length
              } with full object data`
            : "No objects found matching the query",
      });
    } catch (error) {
      console.error("[RetrievalTool] Error retrieving objects:", error);
      return JSON.stringify({
        success: false,
        message: `Error retrieving objects: ${
          error instanceof Error ? error.message : String(error)
        }`,
        objects: [],
      });
    }
  },
  {
    name: "retrieve_objects",
    description:
      "Retrieves Three.js objects from persistent storage based on semantic search or object ID. Use this when you need to find existing objects in the scene history to reuse them. For ID lookup, prefix the query with 'id:'. Example: 'id:cube_1' or 'red sphere'",
    schema: RetrievalToolInputSchema,
  }
);
