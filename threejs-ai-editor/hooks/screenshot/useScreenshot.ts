import { useCallback } from "react";
import { ThreeSceneRef } from "../three/useThreeScene";

export const useScreenshot = (
  threeRef: React.RefObject<ThreeSceneRef | null>
) => {
  const captureScreenshot = useCallback(async (): Promise<string | null> => {
    console.log("[Screenshot] Starting screenshot capture process...");
    if (!threeRef.current) {
      console.warn("[Screenshot] Failed: Three.js scene not initialized");
      return null;
    }

    try {
      const { renderer, scene, camera } = threeRef.current;
      if (!renderer || !scene || !camera) {
        console.warn("[Screenshot] Three.js components incomplete");
        return null;
      }

      // Force multiple renders to ensure complete rendering
      renderer.render(scene, camera);

      // Wait for any pending animations/processes to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Render again to ensure the scene is fully updated
      renderer.render(scene, camera);

      // Get the canvas element
      const threeCanvas = renderer.domElement;
      if (!threeCanvas) {
        console.warn("[Screenshot] Canvas element not found");
        return null;
      }

      // One final render before capturing
      renderer.render(scene, camera);

      try {
        // Set a lower quality value (0.5-0.7 instead of 1.0)
        const imageBase64 = threeCanvas.toDataURL("image/jpeg", 0.5);

        console.log(
          "[Screenshot] Base64 data captured, length:",
          imageBase64.length,
          "bytes"
        );

        // Validate data quality and format
        if (
          !imageBase64 ||
          imageBase64 === "data:," ||
          !imageBase64.startsWith("data:image/jpeg;base64,") ||
          imageBase64.length < 1000
        ) {
          console.error(
            "[Screenshot] Invalid or too small base64 data from direct capture"
          );
          return null;
        }

        console.log(
          "[Screenshot] Successfully captured scene from Three.js canvas"
        );
        return imageBase64;
      } catch (canvasError) {
        console.error("[Screenshot] Canvas capture error:", canvasError);
        return null;
      }
    } catch (err) {
      console.error("[Screenshot] Capture failed with error:", err);
      return null;
    }
  }, [threeRef]);

  return { captureScreenshot };
};
