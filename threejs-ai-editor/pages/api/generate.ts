import { NextApiRequest, NextApiResponse } from "next";
import { analyzeScreenshotDirectly, runAgentLoop } from "./agent";

/**
 * API endpoint for generating code improvements based on prompt, current code, and screenshot
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { prompt, code, image } = req.body;

    if (!prompt || !code) {
      return res
        .status(400)
        .json({ error: "Missing required parameters (prompt and code)" });
    }

    // First, analyze the screenshot to get improvement suggestions
    const suggestion = await analyzeScreenshotDirectly(
      image || "",
      code,
      prompt
    );

    // Then run the agent loop to generate the improved code
    const improvedCode = await runAgentLoop(
      suggestion,
      code,
      5, // max iterations
      prompt
    );

    // Create a simple diff patch if there are differences
    const patch =
      improvedCode !== code ? "// Changes were made based on your prompt" : "";

    return res.status(200).json({
      directCode: improvedCode,
      suggestion,
      patch,
    });
  } catch (error) {
    console.error("Error in generate API:", error);
    return res.status(500).json({
      error: "Failed to generate code improvements",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
