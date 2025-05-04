import { DynamicTool } from "langchain/tools";
import fetch from "node-fetch";

// Track active model generation requests
interface ModelGenerationStatus {
  requestId: string;
  status: "pending" | "completed" | "failed";
  startTime: number;
  prompt: string;
  modelUrl?: string;
  error?: string;
}

// Store for active model generation requests
const activeModelRequests = new Map<string, ModelGenerationStatus>();

// Tracking for model generation promises - ensures only one generation per requestId
const activeModelPromises = new Map<string, Promise<Record<string, unknown>>>();

/**
 * Tool for generating 3D models using hyper3d API via our proxy endpoint
 */
const createModelGenTool = () => {
  return new DynamicTool({
    name: "generate_3d_model",
    description:
      "Generate a 3D model from a text prompt or image URLs. Use this when needing to create complex 3D models.",
    func: async (input: string) => {
      // Generate unique request ID for this model generation
      const requestId = `model_gen_${Date.now()}`;
      console.log(`[${requestId}] ==========================================`);
      console.log(`[${requestId}] ModelGenTool starting with input:`, input);
      console.log(`[${requestId}] Input type:`, typeof input);

      try {
        const params: {
          prompt?: string;
          imageUrls?: string[];
          meshMode?: "Raw" | "Quad" | "Ultra";
          quality?: "high" | "medium" | "low" | "extra-low";
          material?: "pbr" | "shaded";
          useHyper?: boolean;
          category?: string;
          format?: string;
        } = {};

        // Check if input is empty or undefined
        if (!input) {
          console.error(`[${requestId}] ModelGenTool received empty input`);
          throw new Error(
            "Input is required. Please provide a prompt or parameters."
          );
        }

        // Handle different input formats
        try {
          // Attempt to parse as JSON object
          const inputObj = JSON.parse(input);
          console.log(
            `[${requestId}] Successfully parsed input as JSON:`,
            inputObj
          );

          // Extract parameters from parsed JSON
          if (inputObj.params && typeof inputObj.params === "object") {
            // Handle the new format: { "tool": "generate_3d_model", "params": { ... } }
            console.log(
              `[${requestId}] Detected tool+params format, extracting params`,
              inputObj.params
            );

            params.prompt =
              inputObj.params.description || inputObj.params.prompt;
            params.category = inputObj.params.category;
            params.meshMode = inputObj.params.meshMode || "Quad";
            params.quality = inputObj.params.quality || "medium";
            params.material = inputObj.params.material || "pbr";
            params.useHyper = inputObj.params.useHyper || false;
            params.format = inputObj.params.format;
          } else {
            // Legacy format
            params.prompt = inputObj.prompt || inputObj.description;
            params.imageUrls = inputObj.imageUrls;
            params.meshMode = inputObj.meshMode || "Quad";
            params.quality = inputObj.quality || "medium";
            params.material = inputObj.material || "pbr";
            params.useHyper = inputObj.useHyper || false;
          }
          /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
        } catch (_) {
          // If parsing fails, treat input as a direct prompt
          console.log(
            `[${requestId}] Treating input as a direct prompt:`,
            input
          );
          params.prompt = input;
          params.meshMode = "Quad";
          params.quality = "medium";
          params.material = "pbr";
          params.useHyper = false;
        }

        // Ensure we have a prompt
        if (
          !params.prompt &&
          (!params.imageUrls || params.imageUrls.length === 0)
        ) {
          console.error(
            `[${requestId}] No prompt or imageUrls provided in params:`,
            params
          );
          throw new Error("Either a prompt or image URLs are required.");
        }

        // Record request start status
        activeModelRequests.set(requestId, {
          requestId,
          status: "pending",
          startTime: Date.now(),
          prompt: params.prompt || "image-based model",
        });

        console.log(`[${requestId}] Generating 3D model with params:`, params);
        console.log(
          `[${requestId}] This operation will take 2-3 minutes, blocking until complete`
        );

        // Send a "generating started" response immediately to inform the agent
        // that a long process has begun
        const initialResponse = {
          status: "generating",
          message:
            "3D model generation started and will take 2-3 minutes to complete. Please wait for the result.",
          requestId,
          eta_seconds: 120, // 2 minutes ETA
          started_at: new Date().toISOString(),
        };

        // Log the long model generation process has started
        console.log(
          `[${requestId}] 🔄 Model generation process started - IMMEDIATE RESPONSE:`
        );
        console.log(JSON.stringify(initialResponse, null, 2));

        // Create a dedicated model generation process that will run to completion
        // regardless of agent or WebSocket interruptions
        const modelGenerationPromise = (async () => {
          try {
            // 获取完整的API URL
            // 在服务器端，我们需要使用环境变量中的URL或构造一个绝对URL
            const apiUrl =
              process.env.NEXTAUTH_URL ||
              process.env.VERCEL_URL ||
              "http://localhost:3000";
            const fullApiUrl = `${apiUrl}/api/hyper3d`;

            console.log(`[${requestId}] Calling full API URL:`, fullApiUrl);
            const startTime = Date.now();

            // Use async approach to call API, ensuring long operations aren't interrupted by WebSocket timeouts
            const response = await fetch(fullApiUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                options: params,
                requestId, // Pass request ID to API
              }),
              // Increase timeout to accommodate long-running model generation
              timeout: 240000, // 4 minute timeout
            });

            if (!response.ok) {
              const errorText = await response.text();
              console.error(
                `[${requestId}] API error: ${response.status} - ${errorText}`
              );

              // Update request status to failed
              activeModelRequests.set(requestId, {
                ...activeModelRequests.get(requestId)!,
                status: "failed",
                error: `API responded with status: ${response.status} - ${errorText}`,
              });

              throw new Error(
                `API responded with status: ${response.status} - ${errorText}`
              );
            }

            const result = await response.json();
            console.log(
              `[${requestId}] API call took ${Date.now() - startTime}ms`
            );
            console.log(`[${requestId}] API response:`, result);

            if (result.error) {
              console.error(
                `[${requestId}] API returned error: ${result.error}`
              );

              // Update request status to failed
              activeModelRequests.set(requestId, {
                ...activeModelRequests.get(requestId)!,
                status: "failed",
                error: result.error,
              });

              throw new Error(result.error);
            }

            if (!result.downloadUrls || result.downloadUrls.length === 0) {
              console.error(
                `[${requestId}] No download URLs returned from API`
              );

              // Update request status to failed
              activeModelRequests.set(requestId, {
                ...activeModelRequests.get(requestId)!,
                status: "failed",
                error: "No model URLs returned from API",
              });

              throw new Error("No model URLs returned from API");
            }

            // Get the primary model URL
            const modelUrl = result.downloadUrls[0].url;
            console.log(
              `[${requestId}] Successfully retrieved model URL:`,
              modelUrl
            );

            // Update request status to completed
            activeModelRequests.set(requestId, {
              ...activeModelRequests.get(requestId)!,
              status: "completed",
              modelUrl,
            });

            // Final successful response
            const successResponse = {
              success: true,
              modelUrl,
              modelUrls: result.downloadUrls,
              message:
                "3D model generated successfully. Now generate code that uses this model URL.",
              modelComment: `// MODEL_URL: ${modelUrl}`,
              nextStep: "generate_code_with_model_url",
              requestId, // Return request ID for tracking
            };

            console.log(
              `[${requestId}] Returning success response:`,
              successResponse
            );
            console.log(
              `[${requestId}] ==========================================`
            );

            return successResponse;
          } catch (error: unknown) {
            console.error(
              `[${requestId}] Error in model generation process:`,
              error
            );

            // Update request status (if it exists)
            if (activeModelRequests.has(requestId)) {
              activeModelRequests.set(requestId, {
                ...activeModelRequests.get(requestId)!,
                status: "failed",
                error:
                  error instanceof Error
                    ? error.message
                    : "Unknown error occurred",
              });
            }

            return {
              success: false,
              error:
                error instanceof Error
                  ? error.message
                  : "Unknown error occurred",
              message: "Model generation failed but the error was handled",
              requestId,
              recoverable: true,
            };
          } finally {
            // Clean up the promise from the tracking map when done
            activeModelPromises.delete(requestId);
          }
        })();

        // Store the promise for status checking
        activeModelPromises.set(requestId, modelGenerationPromise);

        // IMPORTANT: Wait for the model generation to complete
        // This ensures the agent doesn't continue until the model is ready
        console.log(
          `[${requestId}] 🔄 Waiting for model generation to complete...`
        );
        const result = await modelGenerationPromise;
        console.log(
          `[${requestId}] ✅ Model generation completed with result:`,
          result
        );

        return JSON.stringify(result);
      } catch (error: unknown) {
        console.error(`[${requestId}] Error in modelGenTool execution:`, error);

        // Check if HYPER3D_API_URL and HYPER3D_API_KEY are set
        const apiUrl = process.env.HYPER3D_API_URL;
        const apiKey = process.env.HYPER3D_API_KEY;
        let errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";

        if (!apiUrl || !apiKey) {
          errorMessage =
            "Hyper3D API configuration is missing. Please set HYPER3D_API_URL and HYPER3D_API_KEY environment variables.";
          console.error(`[${requestId}] ${errorMessage}`);
        }

        // Return structured error response so agent can continue
        return JSON.stringify({
          success: false,
          error: errorMessage,
          message:
            "Model generation failed but agent can continue with alternative approaches",
          requestId,
          recoverable: true, // Indicates error shouldn't interrupt agent flow
        });
      }
    },
  });
};

/**
 * Get the status of a model generation
 * Can be called by external systems to check on long-running model generation tasks
 */
export function getModelGenerationStatus(
  requestId: string
): ModelGenerationStatus | null {
  return activeModelRequests.get(requestId) || null;
}

/**
 * Check if a model generation is in progress
 */
export function isModelGenerationActive(requestId: string): boolean {
  return activeModelPromises.has(requestId);
}

/**
 * Get all active model generation requests
 */
export function getActiveModelRequests(): string[] {
  return Array.from(activeModelRequests.keys()).filter(
    (reqId) => activeModelRequests.get(reqId)?.status === "pending"
  );
}

/**
 * Clean up old model generation requests
 * Call periodically to avoid memory leaks
 */
export function cleanupOldModelRequests(maxAgeMs: number = 3600000): void {
  const now = Date.now();
  for (const [requestId, status] of activeModelRequests.entries()) {
    if (now - status.startTime > maxAgeMs) {
      activeModelRequests.delete(requestId);
    }
  }
}

// Create cleanup task that runs once every hour
setInterval(() => {
  cleanupOldModelRequests();
}, 3600000);

// Create and export the tool instance directly
export const modelGenTool = createModelGenTool();

// Also export the factory function for cases where a new instance is needed
export default createModelGenTool;
