import { NextApiRequest, NextApiResponse } from "next";
import { getCachedCode } from "@/lib/tools/applyPatchTool";
import { BufferMemory } from "langchain/memory";

// Create a memory instance for accessing scene history
const sceneHistoryMemory = new BufferMemory({
  memoryKey: "scene_history",
  inputKey: "userPrompt",
  returnMessages: false,
  outputKey: "sceneHistoryContext",
});

/**
 * API endpoint to fetch the current memory state
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
    // Get current cached code
    const cachedCode = getCachedCode();

    // Get scene history from memory
    let sceneHistory = null;
    try {
      const memoryVars = await sceneHistoryMemory.loadMemoryVariables({});
      if (memoryVars.sceneHistoryContext) {
        sceneHistory = memoryVars.sceneHistoryContext;
      }
    } catch (memoryError) {
      console.warn("Failed to load scene history memory:", memoryError);
    }

    return res.status(200).json({
      success: true,
      memoryState: {
        latestCode: cachedCode ? `${cachedCode.substring(0, 150)}...` : null,
        codeLength: cachedCode ? cachedCode.length : 0,
        sceneHistory: sceneHistory,
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
