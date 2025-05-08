import { Tool } from "@langchain/core/tools";
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

/**
 * RetrievalTool for fetching objects from ChromaDB
 * Used to retrieve Three.js objects from persistent storage based on semantic search
 */
class RetrievalTool extends Tool {
  name = "retrieve_objects";
  description =
    "Retrieves Three.js objects from persistent storage based on semantic search or object ID. Use this when you need to find existing objects in the scene history to reuse them. For ID lookup, prefix the query with 'id:'. Example: 'id:cube_1' or 'red sphere'";

  async _call(input: string): Promise<string> {
    try {
      console.log(`[RetrievalTool Debug] Tool called with input: ${input}`);

      // Parse the input
      const parsedInput = JSON.parse(input);
      const { query, limit = 10 } = parsedInput;

      console.log(
        `[RetrievalTool Debug] Retrieving objects with query: "${query}", limit: ${limit}`
      );

      // Validate the query
      if (!query || typeof query !== "string") {
        console.log(`[RetrievalTool Debug] Invalid query: ${query}`);
        return JSON.stringify({
          success: false,
          message: "Query must be a non-empty string",
          objects: [],
        });
      }

      // Get current objects count in ChromaDB before retrieval
      const objectIdsBeforeRetrieval = await chromaService.getAllObjectIds();
      console.log(
        `[RetrievalTool Debug] Current object count in ChromaDB: ${objectIdsBeforeRetrieval.length}`
      );

      // Retrieve objects from ChromaDB
      const objects = await chromaService.retrieveSceneObjects(query, limit);

      console.log(
        `[RetrievalTool Debug] Retrieved ${objects.length} objects from ChromaDB matching query: "${query}"`
      );

      // Log detailed object info if objects were found
      if (objects.length > 0) {
        console.log("[RetrievalTool Debug] First few objects retrieved:");
        objects.slice(0, 3).forEach((obj, index) => {
          console.log(`  Object ${index + 1}:`);
          console.log(`    ID: ${obj.id}`);
          console.log(`    Type: ${obj.type}`);
          console.log(`    Name: ${obj.name || "unnamed"}`);

          // Check for full object data
          const enhancedObj = obj as EnhancedSceneObject;
          if (enhancedObj.objectData) {
            console.log(
              `    Has full object data: Yes (${Math.round(
                enhancedObj.objectData.length / 1024
              )} KB)`
            );

            // Log additional helpful information for usage
            try {
              const objectData = JSON.parse(enhancedObj.objectData);
              if (objectData.geometries) {
                console.log(
                  `    Geometry types: ${objectData.geometries
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    .map((g: any) => g.type)
                    .join(", ")}`
                );
              }
              if (objectData.materials) {
                console.log(
                  `    Material types: ${objectData.materials
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    .map((m: any) => m.type)
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

      // Format and return the results
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
      console.error("[RetrievalTool Debug] Error retrieving objects:", error);
      return JSON.stringify({
        success: false,
        message: `Error retrieving objects: ${
          error instanceof Error ? error.message : String(error)
        }`,
        objects: [],
      });
    }
  }
}

// Export both the class and the instance
export { RetrievalTool };
export const retrievalTool = new RetrievalTool();
