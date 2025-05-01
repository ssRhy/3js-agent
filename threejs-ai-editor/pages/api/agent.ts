import { NextApiRequest, NextApiResponse } from "next";
import handler from "./agentHandler";

/**
 * Agent API endpoint
 *
 * This file redirects requests to the agentHandler implementation.
 * It serves as the entry point for the /api/agent API route.
 */
export default async function agentEndpoint(
  req: NextApiRequest,
  res: NextApiResponse
) {
  return handler(req, res);
}
