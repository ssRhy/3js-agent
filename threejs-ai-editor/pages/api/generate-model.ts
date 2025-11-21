import type { NextApiRequest, NextApiResponse } from "next";

type ApiResponse = {
  success: boolean;
  modelUrl?: string;
  modelUrls?: { name: string; url: string }[];
  message?: string;
  error?: string;
};

/**
 * Legacy endpoint for model generation - forwards to the agent API
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed. Only POST requests are supported.",
    });
  }

  try {
    const {
      prompt,
      quality = "medium",
      material = "pbr",
      useHyper = false,
    } = req.body;

    if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "A valid prompt is required",
      });
    }

    console.log(
      `Forwarding model generation request to agent API for prompt: "${prompt}"`
    );

    // Forward to the agent API
    const response = await fetch(
      `${process.env.NEXTAUTH_URL || ""}/api/agent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "generate-model",
          modelPrompt: prompt.trim(),
          options: {
            quality,
            material,
            useHyper,
            geometryFileFormat: "glb",
          },
        }),
      }
    );

    const data = await response.json();

    // Return the agent API response
    return res.status(response.status).json(data);
  } catch (error) {
    console.error("Error forwarding model generation request:", error);
    return res.status(500).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Unknown error occurred",
    });
  }
}
