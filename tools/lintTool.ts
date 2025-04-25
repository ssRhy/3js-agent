import { DynamicTool } from "@langchain/core/tools";

/**
 * Tool for linting Three.js code
 * It checks for common issues and returns a list of problems found
 */
export const lintTool = new DynamicTool({
  name: "lint",
  description: "Checks Three.js code for common issues and best practices",
  func: async (code: string): Promise<string> => {
    try {
      console.log("Linting code...");

      const issues: string[] = [];

      // Basic validation checks
      if (!code.includes("function setup")) {
        issues.push("Missing setup function definition");
      }

      // Check for proper scene usage
      if (!code.includes("scene.add(")) {
        issues.push("No objects being added to the scene");
      }

      // Check for THREE namespace usage
      if (
        !code.includes("THREE.") &&
        !code.includes("scene, camera, renderer, THREE")
      ) {
        issues.push("Not using THREE namespace properly");
      }

      // Check for memory leaks
      if (
        code.includes("new THREE") &&
        !code.includes("dispose()") &&
        code.length > 500
      ) {
        issues.push(
          "Potential memory leak: creating new geometries/materials without proper disposal"
        );
      }

      // Check for performance issues
      if (
        code.includes("THREE.BoxGeometry(") &&
        !code.match(/THREE\.BoxGeometry\([^)]*\)/)
      ) {
        issues.push("BoxGeometry parameters missing, use specific dimensions");
      }

      // Check for proper lighting usage
      if (
        code.includes("THREE.Mesh") &&
        !code.includes("THREE.MeshStandardMaterial") &&
        !code.includes("THREE.MeshPhongMaterial") &&
        code.includes("THREE.Light")
      ) {
        issues.push(
          "Using lights with basic materials that don't respond to lighting"
        );
      }

      // Check for animation function
      if (
        code.includes("requestAnimationFrame") &&
        !code.includes("renderer.render")
      ) {
        issues.push("Animation loop missing renderer.render call");
      }

      // Return results
      if (issues.length === 0) {
        return "No issues found. The code follows Three.js best practices.";
      } else {
        return `Found ${issues.length} issues:\n- ${issues.join("\n- ")}`;
      }
    } catch (error) {
      console.error("Error in lintTool:", error);
      return `Error linting code: ${error.message}`;
    }
  },
});
