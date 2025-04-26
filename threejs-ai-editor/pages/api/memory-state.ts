import { NextApiRequest, NextApiResponse } from "next";
import { getPatchHistory, loadFromMemory } from "@/lib/tools/applyPatchTool";

/**
 * API endpoint to fetch the current memory state and patch history
 * Used for debugging and monitoring the agent's memory
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Get current patch history
    const patchHistory = getPatchHistory();

    // Load state from memory
    const memoryState = await loadFromMemory();

    return res.status(200).json({
      success: true,
      patchHistory,
      memoryState: {
        latestCode: memoryState.latestCode
          ? `${memoryState.latestCode.substring(0, 150)}...`
          : null,
        patchHistoryCount: memoryState.patchHistory.length,
      },
    });
  } catch (error) {
    console.error("Error fetching memory state:", error);
    return res.status(500).json({
      error: "Failed to fetch memory state",
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
