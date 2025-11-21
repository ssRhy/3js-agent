import { NextApiRequest, NextApiResponse } from "next";
import { chromaService } from "../../lib/services/chromaService";

/**
 * API endpoint to check ChromaDB status and retrieve information about stored objects
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    console.log("[API] ChromaDB status check requested");

    // Remove explicit initialization - the ChromaService methods will handle it internally
    // await chromaService.initialize();

    // Get all object IDs
    const allIds = await chromaService.getAllObjectIds();
    console.log(`[API] ChromaDB contains ${allIds.length} objects`);

    // Sample objects by retrieving a few for demonstration
    const sampleObjects = [];
    if (allIds.length > 0) {
      // Get a sample of up to 5 objects by ID
      const sampleIds = allIds.slice(0, 5);
      for (const id of sampleIds) {
        const objects = await chromaService.retrieveSceneObjects(`id:${id}`);
        if (objects.length > 0) {
          sampleObjects.push(objects[0]);
        }
      }
      console.log(
        `[API] Retrieved ${sampleObjects.length} sample objects from ChromaDB`
      );
    }

    // Get object type distribution
    let typeDistribution: Record<string, number> = {};
    if (allIds.length > 0) {
      // Retrieve all objects to analyze type distribution
      // This is a simple approach - for large DBs you would use a more efficient query
      const allObjects = [];
      for (let i = 0; i < Math.min(allIds.length, 100); i++) {
        // Limit to first 100 for performance
        const objects = await chromaService.retrieveSceneObjects(
          `id:${allIds[i]}`
        );
        if (objects.length > 0) {
          allObjects.push(objects[0]);
        }
      }

      // Count object types
      typeDistribution = allObjects.reduce(
        (acc: Record<string, number>, obj) => {
          const type = obj.type || "unknown";
          acc[type] = (acc[type] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      console.log(`[API] Object type distribution:`, typeDistribution);
    }

    // Return the status information
    res.status(200).json({
      status: "success",
      message: "ChromaDB status retrieved successfully",
      objectCount: allIds.length,
      sampleObjectIds: allIds.slice(0, 10), // Show first 10 IDs
      sampleObjects: sampleObjects,
      typeDistribution: typeDistribution,
    });
  } catch (error) {
    console.error("[API] ChromaDB status check failed:", error);
    res.status(500).json({
      status: "error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
