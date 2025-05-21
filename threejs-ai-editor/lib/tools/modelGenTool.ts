import { DynamicTool } from "langchain/tools";
import fetch from "node-fetch";
import { validateUrl } from "../services/urlValidationService";

/**
 * Tool for generating 3D models using hyper3d API via our proxy endpoint
 */
const createModelGenTool = () => {
  return new DynamicTool({
    name: "generate_3d_model",
    description:
      "Generate a 3D model from a text prompt or image URLs. Use this when needing to create complex 3D models.",
    func: async (input: string) => {
      console.log("==========================================");
      console.log("ModelGenTool: Starting execution");

      try {
        const params: {
          prompt?: string;
          imageUrls?: string[];
          meshMode?: "Raw" | "Quad" | "Ultra";
          quality?: "low" | "extra-low";
          material?: "pbr" | "shaded";
          useHyper?: boolean;
        } = {};

        // Check if input is empty or undefined
        if (!input) {
          console.error("ModelGenTool: Received empty input");
          throw new Error(
            "Input is required. Please provide a prompt or parameters."
          );
        }

        // Handle different input formats
        try {
          // Attempt to parse as JSON object
          const inputObj = JSON.parse(input);
          console.log("ModelGenTool: Input parsed as JSON");

          params.prompt = inputObj.prompt;
          params.imageUrls = inputObj.imageUrls;
          params.meshMode = inputObj.meshMode || "Quad";
          params.quality = inputObj.quality || "low";
          params.material = inputObj.material || "pbr";
          params.useHyper = inputObj.useHyper || false;
          /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
        } catch (_) {
          // If parsing fails, treat input as a direct prompt
          console.log("ModelGenTool: Treating input as a direct prompt");
          params.prompt = input;
          params.meshMode = "Quad";
          params.quality = "low";
          params.material = "pbr";
          params.useHyper = false;
        }

        // Ensure we have a prompt
        if (
          !params.prompt &&
          (!params.imageUrls || params.imageUrls.length === 0)
        ) {
          console.error("ModelGenTool: No prompt or imageUrls provided");
          throw new Error("Either a prompt or image URLs are required.");
        }

        console.log("ModelGenTool: Generating 3D model");

        // 获取完整的API URL
        // 在服务器端，我们需要使用环境变量中的URL或构造一个绝对URL
        const apiUrl =
          process.env.NEXTAUTH_URL ||
          process.env.VERCEL_URL ||
          "http://localhost:3000";
        const fullApiUrl = `${apiUrl}/api/hyper3d`;

        console.log("ModelGenTool: Calling API endpoint");
        const startTime = Date.now();

        const response = await fetch(fullApiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ options: params }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`ModelGenTool: API error: ${response.status}`);
          throw new Error(
            `API responded with status: ${response.status} - ${errorText}`
          );
        }

        const result = await response.json();
        console.log(`ModelGenTool: API call took ${Date.now() - startTime}ms`);
        console.log(
          `ModelGenTool: Received ${
            result.downloadUrls?.length || 0
          } model URLs`
        );

        if (result.error) {
          console.error(`ModelGenTool: API returned error`);
          throw new Error(result.error);
        }

        if (!result.downloadUrls || result.downloadUrls.length === 0) {
          console.error("ModelGenTool: No download URLs returned");
          throw new Error("No model URLs returned from API");
        }

        // Get the primary model URL
        const modelUrl = result.downloadUrls[0].url;
        console.log("ModelGenTool: Retrieved model URL (not logging full URL)");

        // Enhanced validation process to ensure model is really ready
        console.log("ModelGenTool: Starting validation process");
        let modelReady = false;
        // Increase maxRetries to accommodate 3-minute typical generation time
        const maxRetries = 20; // Allow for up to ~5 minutes of waiting (with 15s intervals)
        let retryCount = 0;
        let validatedModelUrl = modelUrl;
        const startValidationTime = Date.now();

        console.log(
          "ModelGenTool: Beginning extended wait for model generation (~3 minutes typical)"
        );

        while (!modelReady && retryCount < maxRetries) {
          console.log(
            `ModelGenTool: Validation attempt ${
              retryCount + 1
            }/${maxRetries} (elapsed: ${Math.round(
              (Date.now() - startValidationTime) / 1000
            )}s)`
          );

          try {
            // Validate the URL with increased timeouts
            const urlValidation = await validateUrl(modelUrl, {
              timeoutMs: 20000, // Increase timeout to 20 seconds
              retries: 3, // Increase retries
            });

            if (urlValidation.isValid) {
              console.log("ModelGenTool: Model URL validated successfully");
              modelReady = true;
              validatedModelUrl = modelUrl;
            } else {
              console.log(
                `ModelGenTool: Validation failed: ${urlValidation.error}`
              );

              // Check for alternative URLs
              if (result.downloadUrls.length > 1) {
                console.log("ModelGenTool: Trying alternative model URLs");

                for (let i = 1; i < result.downloadUrls.length; i++) {
                  const alternativeUrl = result.downloadUrls[i].url;
                  console.log(`ModelGenTool: Trying alternative URL #${i}`);

                  const alternativeValidation = await validateUrl(
                    alternativeUrl,
                    {
                      timeoutMs: 20000, // Increase timeout to 20 seconds
                      retries: 3, // Increase retries
                    }
                  );

                  if (alternativeValidation.isValid) {
                    console.log(
                      `ModelGenTool: Found valid alternative URL at index ${i}`
                    );
                    validatedModelUrl = alternativeUrl;
                    result.downloadUrls[0].url = alternativeUrl; // Replace primary URL
                    modelReady = true;
                    break;
                  }
                }
              }

              // If no valid URL yet, wait and retry with longer interval
              if (!modelReady) {
                const waitTime = 15000; // 15 seconds between checks
                const elapsedSeconds = Math.round(
                  (Date.now() - startValidationTime) / 1000
                );
                console.log(
                  `ModelGenTool: Model not ready after ${elapsedSeconds}s, waiting ${
                    waitTime / 1000
                  }s before retry #${retryCount + 1}`
                );
                await new Promise((resolve) => setTimeout(resolve, waitTime));
                retryCount++;
              }
            }
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
          } catch (_) {
            console.error("ModelGenTool: Error during validation");
            retryCount++;
            // Longer wait after errors
            await new Promise((resolve) => setTimeout(resolve, 15000));
          }
        }

        const totalWaitTime = Math.round(
          (Date.now() - startValidationTime) / 1000
        );
        if (!modelReady) {
          throw new Error(
            `Failed to validate model URL after ${totalWaitTime} seconds (${maxRetries} attempts). The model generation may have failed.`
          );
        }

        console.log(
          `ModelGenTool: Model is fully validated and ready after ${totalWaitTime} seconds`
        );
        console.log(
          `ModelGenTool: Total model preparation time: ${
            Date.now() - startTime
          }ms`
        );

        // Final successful response
        const successResponse = {
          success: true,
          modelUrl: validatedModelUrl,
          modelUrls: result.downloadUrls.map(
            (item: { name: string; url: string }) => ({
              name: item.name,
              url: item.url,
            })
          ),
          message:
            "3D model generated successfully. Now generate code that uses this model URL.",
          modelComment: `// MODEL_URL: ${validatedModelUrl}`,
          nextStep: "generate_code_with_model_url",
        };

        console.log(
          "ModelGenTool: Returning success response with model URL (not logging URL)"
        );
        console.log("==========================================");

        return JSON.stringify(successResponse);
      } catch (error: unknown) {
        console.error("ModelGenTool: Error generating 3D model");

        // Check if HYPER3D_API_URL and HYPER3D_API_KEY are set
        const apiUrl = process.env.HYPER3D_API_URL;
        const apiKey = process.env.HYPER3D_API_KEY;
        let errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";

        if (!apiUrl || !apiKey) {
          errorMessage =
            "Hyper3D API configuration is missing. Please set HYPER3D_API_URL and HYPER3D_API_KEY environment variables.";
          console.error("ModelGenTool: " + errorMessage);
        }

        // Return error response
        return JSON.stringify({
          success: false,
          error: errorMessage,
          message:
            "Failed to generate 3D model. Please try a different prompt or check the logs for details.",
        });
      }
    },
  });
};

// Create and export the tool instance directly
export const modelGenTool = createModelGenTool();

// Also export the factory function for cases where a new instance is needed
export default createModelGenTool;
