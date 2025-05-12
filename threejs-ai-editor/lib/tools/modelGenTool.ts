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
      console.log("ModelGenTool starting with input:", input);
      console.log("Input type:", typeof input);

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
          console.error("ModelGenTool received empty input");
          throw new Error(
            "Input is required. Please provide a prompt or parameters."
          );
        }

        // Handle different input formats
        try {
          // Attempt to parse as JSON object
          const inputObj = JSON.parse(input);
          console.log("Successfully parsed input as JSON:", inputObj);

          params.prompt = inputObj.prompt;
          params.imageUrls = inputObj.imageUrls;
          params.meshMode = inputObj.meshMode || "Quad";
          params.quality = inputObj.quality || "low";
          params.material = inputObj.material || "pbr";
          params.useHyper = inputObj.useHyper || false;
          /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
        } catch (_) {
          // If parsing fails, treat input as a direct prompt
          console.log("Treating input as a direct prompt:", input);
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
          console.error("No prompt or imageUrls provided in params:", params);
          throw new Error("Either a prompt or image URLs are required.");
        }

        console.log("Generating 3D model with params:", params);

        // 获取完整的API URL
        // 在服务器端，我们需要使用环境变量中的URL或构造一个绝对URL
        const apiUrl =
          process.env.NEXTAUTH_URL ||
          process.env.VERCEL_URL ||
          "http://localhost:3000";
        const fullApiUrl = `${apiUrl}/api/hyper3d`;

        console.log("Calling full API URL:", fullApiUrl);
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
          console.error(`API error: ${response.status} - ${errorText}`);
          throw new Error(
            `API responded with status: ${response.status} - ${errorText}`
          );
        }

        const result = await response.json();
        console.log(`API call took ${Date.now() - startTime}ms`);
        console.log("API response:", result);

        if (result.error) {
          console.error(`API returned error: ${result.error}`);
          throw new Error(result.error);
        }

        if (!result.downloadUrls || result.downloadUrls.length === 0) {
          console.error("No download URLs returned from API");
          throw new Error("No model URLs returned from API");
        }

        // Get the primary model URL
        const modelUrl = result.downloadUrls[0].url;
        console.log("Successfully retrieved model URL:", modelUrl);

        // Validate the URL before returning it
        console.log("Validating model URL:", modelUrl);
        const urlValidation = await validateUrl(modelUrl, {
          timeoutMs: 15000, // Longer timeout for model files
          retries: 2,
        });

        if (!urlValidation.isValid) {
          console.error(`Invalid model URL: ${urlValidation.error}`);

          // Check if we have alternative URLs in the response
          if (result.downloadUrls.length > 1) {
            // Try to find a valid alternative URL
            console.log("Trying alternative model URLs...");

            for (let i = 1; i < result.downloadUrls.length; i++) {
              const alternativeUrl = result.downloadUrls[i].url;
              const alternativeValidation = await validateUrl(alternativeUrl, {
                timeoutMs: 15000,
                retries: 2,
              });

              if (alternativeValidation.isValid) {
                // Found a valid alternative
                console.log(`Found valid alternative URL at index ${i}`);
                result.downloadUrls[0] = result.downloadUrls[i]; // Replace primary URL with valid one
                break;
              }
            }

            // Re-check if we have a valid URL after alternatives check
            if (!(await validateUrl(result.downloadUrls[0].url)).isValid) {
              throw new Error(
                `All model URLs are invalid or inaccessible. Primary error: ${urlValidation.error}`
              );
            }
          } else {
            throw new Error(
              `Model URL is invalid or inaccessible: ${urlValidation.error}`
            );
          }
        }

        // Update the model URL to the validated one (might be different if we found a valid alternative)
        const validatedModelUrl = result.downloadUrls[0].url;
        console.log("Using validated model URL:", validatedModelUrl);

        // Final successful response
        const successResponse = {
          success: true,
          modelUrl: validatedModelUrl,
          modelUrls: result.downloadUrls,
          message:
            "3D model generated successfully. Now generate code that uses this model URL.",
          modelComment: `// MODEL_URL: ${validatedModelUrl}`,
          nextStep: "generate_code_with_model_url",
        };

        console.log("Returning success response:", successResponse);
        console.log("==========================================");

        return JSON.stringify(successResponse);
      } catch (error: unknown) {
        console.error("Error generating 3D model:", error);

        // Check if HYPER3D_API_URL and HYPER3D_API_KEY are set
        const apiUrl = process.env.HYPER3D_API_URL;
        const apiKey = process.env.HYPER3D_API_KEY;
        let errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";

        if (!apiUrl || !apiKey) {
          errorMessage =
            "Hyper3D API configuration is missing. Please set HYPER3D_API_URL and HYPER3D_API_KEY environment variables.";
          console.error(errorMessage);
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
