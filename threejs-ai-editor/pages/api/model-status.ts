import { NextApiRequest, NextApiResponse } from "next";
import {
  getModelGenerationStatus,
  getActiveModelRequests,
} from "../../lib/tools/modelGenTool";

/**
 * API endpoint to check the status of model generation processes
 * Useful for monitoring long-running model generation tasks
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Check if a specific request ID is provided
    const { requestId } = req.query;

    if (requestId && typeof requestId === "string") {
      // Get status for specific request
      const status = getModelGenerationStatus(requestId);

      if (!status) {
        return res.status(404).json({
          success: false,
          error: `No model generation request found with ID: ${requestId}`,
        });
      }

      return res.status(200).json({
        success: true,
        status,
        timestamp: Date.now(),
      });
    } else {
      // Get all active requests
      const activeRequests = getActiveModelRequests();

      // Get details for each active request
      const requestDetails = activeRequests.map((reqId) => ({
        requestId: reqId,
        status: getModelGenerationStatus(reqId),
      }));

      return res.status(200).json({
        success: true,
        activeCount: activeRequests.length,
        requests: requestDetails,
        timestamp: Date.now(),
      });
    }
  } catch (error) {
    console.error("Error in model status API:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
      timestamp: Date.now(),
    });
  }
}
