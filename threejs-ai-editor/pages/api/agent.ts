import { NextApiRequest, NextApiResponse } from "next";
import handler from "./agentHandler";

/**
 * Agent API endpoint
 *
 * This file redirects requests to the agentHandler implementation.
 * It serves as the entry point for the /api/agent API route.
 */

// Increase the body parser size limit to handle larger requests
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb", // Increase from the default 1mb
    },
    responseLimit: "10mb", // Also increase response size limit
  },
};

export default async function agentEndpoint(
  req: NextApiRequest,
  res: NextApiResponse
) {
  return handler(req, res);
}
