import type { NextApiRequest, NextApiResponse } from "next";
import fetch from "node-fetch";

// Set a higher bodyParser limit for large models
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb", // Increase to handle larger models
    },
    responseLimit: "20mb", // Increase response size limit
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Support GET and POST requests
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Get the model URL (support both POST and GET methods)
    let modelUrl;

    if (req.method === "POST") {
      // Get URL from POST request body
      modelUrl = req.body.url;
    } else {
      // Get URL from GET query parameters
      modelUrl = req.query.url as string;
    }

    if (!modelUrl || typeof modelUrl !== "string") {
      return res.status(400).json({ error: "Valid URL is required" });
    }

    // Ensure URL is absolute
    try {
      // Check if modelUrl starts with /api/proxy-model, meaning it's a relative path that needs conversion
      if (modelUrl.startsWith("/api/proxy-model")) {
        // This is a client error where they passed a recursive proxy URL, try to convert to absolute
        console.warn(
          "Received relative URL, attempting to convert to absolute"
        );

        // Try to extract the actual URL to proxy from the URL
        const urlParam = new URLSearchParams(modelUrl.split("?")[1]).get("url");
        if (urlParam) {
          console.log(
            "Extracted actual target URL from query parameter:",
            urlParam
          );
          // Use the decoded URL as the target
          modelUrl = decodeURIComponent(urlParam);
        } else {
          throw new Error("Cannot extract target URL from relative path");
        }
      }

      // Ensure URL has protocol prefix
      if (!modelUrl.startsWith("http://") && !modelUrl.startsWith("https://")) {
        throw new Error(
          `Invalid URL format - must be absolute URL with http/https protocol: ${modelUrl}`
        );
      }

      // Validate URL format
      new URL(modelUrl);
    } catch (urlError) {
      console.error("URL validation error:", urlError);
      return res.status(400).json({
        error: `Invalid URL format: ${
          urlError instanceof Error ? urlError.message : String(urlError)
        }`,
      });
    }

    console.log("Proxying model request for URL:", modelUrl);

    // Fetch the model file with timeout and retry logic
    let modelResponse;
    let retries = 3;

    while (retries > 0) {
      try {
        modelResponse = await fetch(modelUrl, {
          headers: {
            // Add necessary headers to ensure content is retrieved correctly
            Accept: "model/gltf-binary,*/*",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          },
          // Add timeout to prevent hanging requests
          timeout: 30000, // 30 seconds timeout
        });

        if (modelResponse.ok) {
          break; // Success, exit the retry loop
        } else {
          console.warn(
            `Attempt ${4 - retries} failed with status: ${modelResponse.status}`
          );
          retries--;
          if (retries === 0) {
            throw new Error(
              `Failed after 3 attempts: ${modelResponse.status} ${modelResponse.statusText}`
            );
          }
          // Wait before retrying
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (fetchError) {
        console.error("Fetch error:", fetchError);
        retries--;
        if (retries === 0) {
          throw fetchError;
        }
        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    if (!modelResponse || !modelResponse.ok) {
      const status = modelResponse ? modelResponse.status : 500;
      const statusText = modelResponse
        ? modelResponse.statusText
        : "Network error";
      console.error(`Failed to fetch model: ${status} ${statusText}`);
      return res.status(status).json({
        error: `Failed to fetch model: ${statusText}`,
      });
    }

    // Get binary data
    const modelBuffer = await modelResponse.arrayBuffer();
    console.log(
      `Successfully fetched model, size: ${modelBuffer.byteLength} bytes`
    );

    // Get Content-Type or default to gltf-binary
    const contentType =
      modelResponse.headers.get("Content-Type") || "model/gltf-binary";

    // Set CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    // Return data
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", 'attachment; filename="model.glb"');
    res.setHeader("Cache-Control", "public, max-age=31536000"); // Cache for a year
    res.status(200);

    // Return binary data directly
    res.send(Buffer.from(modelBuffer));
  } catch (error) {
    console.error("Error proxying model:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error occurred",
    });
  }
}
