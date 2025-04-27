import { DynamicTool } from "langchain/tools";
import fetch from "node-fetch";

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
          quality?: "high" | "medium" | "low" | "extra-low";
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
          params.quality = inputObj.quality || "medium";
          params.material = inputObj.material || "pbr";
          params.useHyper = inputObj.useHyper || false;
          /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
        } catch (_) {
          // If parsing fails, treat input as a direct prompt
          console.log("Treating input as a direct prompt:", input);
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
          console.error("No prompt or imageUrls provided in params:", params);
          throw new Error("Either a prompt or image URLs are required.");
        }

        console.log("Generating 3D model with params:", params);

        // Use the /api/hyper3d endpoint which handles the entire generation flow
        console.log("Calling /api/hyper3d endpoint...");
        const startTime = Date.now();

        const response = await fetch("/api/hyper3d", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ options: params }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `API responded with status: ${response.status} - ${errorText}`
          );
        }

        const result = await response.json();
        console.log(`API call took ${Date.now() - startTime}ms`);
        console.log("API response:", result);

        if (result.error) {
          throw new Error(result.error);
        }

        if (!result.downloadUrls || result.downloadUrls.length === 0) {
          throw new Error("No model URLs returned from API");
        }

        // Get the primary model URL
        const modelUrl = result.downloadUrls[0].url;
        console.log("Successfully retrieved model URL:", modelUrl);

        // Final successful response
        const successResponse = {
          success: true,
          modelUrl,
          modelUrls: result.downloadUrls,
          message: "3D model generated successfully",
          modelComment: `// MODEL_URL: ${modelUrl}`, // Add model URL as a comment for agent.ts to extract
        };

        console.log("Returning success response:", successResponse);
        console.log("==========================================");

        return JSON.stringify(successResponse);
      } catch (error: unknown) {
        console.error("Error generating 3D model:", error);
      }
    },
  });
};

// Create and export the tool instance directly
export const modelGenTool = createModelGenTool();

// Also export the factory function for cases where a new instance is needed
export default createModelGenTool;
