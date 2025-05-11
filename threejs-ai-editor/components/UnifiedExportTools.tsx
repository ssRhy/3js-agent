"use client";

import React, { useState, useEffect } from "react";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter";
import * as THREE from "three";
import { useSceneStore } from "../stores/useSceneStore";

interface UnifiedExportToolsProps {
  renderer?: THREE.WebGLRenderer;
}

export default function UnifiedExportTools({
  renderer,
}: UnifiedExportToolsProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const [activeTab, setActiveTab] = useState<"image" | "model">("image");

  const { scene, dynamicGroup } = useSceneStore();

  // Auto-dismiss success/error messages
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (success || error) {
      timer = setTimeout(() => {
        setSuccess(null);
        setError(null);
      }, 3000);
    }
    return () => clearTimeout(timer);
  }, [success, error]);

  // Toggle panel visibility
  const toggleVisibility = () => {
    setIsVisible(!isVisible);
  };

  // Save high-quality image (full resolution)
  const saveHighQualityImage = async () => {
    if (!scene || !renderer) {
      setError("Scene or renderer not initialized");
      return;
    }

    setError(null);
    setSuccess(null);
    setIsExporting(true);

    try {
      // Force render scene at full quality
      const camera = scene.userData.camera as THREE.Camera;
      if (!camera) {
        throw new Error("Cannot find scene camera");
      }

      // Render at high quality
      renderer.render(scene, camera);

      // Get canvas element
      const canvas = renderer.domElement;

      // Convert to high-quality PNG data URL
      const imageUrl = canvas.toDataURL("image/png", 1.0);

      // Create download link
      const link = document.createElement("a");
      link.href = imageUrl;
      link.download = `scene_${new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/:/g, "-")}.png`;

      // Add to body, click and remove
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setSuccess("✅ High quality scene image saved");
    } catch (err) {
      setError(
        `❌ Save image error: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setIsExporting(false);
    }
  };

  // Export scene to GLB format
  const exportToGLB = async () => {
    if (!scene || !dynamicGroup) {
      setError("Scene or scene group not initialized");
      return;
    }

    setError(null);
    setSuccess(null);
    setIsExporting(true);

    try {
      const exporter = new GLTFExporter();

      // Configure export options
      const options = {
        binary: true, // true = GLB, false = GLTF
        onlyVisible: true,
        trs: true,
        embedImages: true,
        animations: [],
        truncateDrawRange: true,
      };

      // Export only the dynamic group to avoid exporting grid, lights, etc.
      exporter.parse(
        dynamicGroup,
        (result) => {
          if (result instanceof ArrayBuffer) {
            // Create blob from ArrayBuffer
            const blob = new Blob([result], {
              type: "application/octet-stream",
            });

            // Create download link
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = `场景_${new Date()
              .toISOString()
              .slice(0, 19)
              .replace(/:/g, "-")}.glb`;

            // Add to body, click and remove
            document.body.appendChild(link);
            link.click();

            // Clean up
            URL.revokeObjectURL(link.href);
            document.body.removeChild(link);

            setSuccess(" Scene exported successfully as GLB format");
          } else {
            throw new Error("Export result is not valid binary data");
          }
          setIsExporting(false);
        },
        (error) => {
          setError(
            `Export error: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          setIsExporting(false);
        },
        options
      );
    } catch (err) {
      setError(
        `Export scene error: ${err instanceof Error ? err.message : String(err)}`
      );
      setIsExporting(false);
    }
  };

  // Export scene to GLTF format
  const exportToGLTF = async () => {
    if (!scene || !dynamicGroup) {
      setError("Scene or scene group not initialized");
      return;
    }

    setError(null);
    setSuccess(null);
    setIsExporting(true);

    try {
      const exporter = new GLTFExporter();

      // Configure export options
      const options = {
        binary: false, // true = GLB, false = GLTF
        onlyVisible: true,
        trs: true,
        embedImages: true,
        animations: [],
        truncateDrawRange: true,
      };

      // Export only the dynamic group
      exporter.parse(
        dynamicGroup,
        (result) => {
          // For GLTF, result is a JSON object
          if (!(result instanceof ArrayBuffer)) {
            // Convert to JSON string
            const output = JSON.stringify(result, null, 2);

            // Create blob from JSON string
            const blob = new Blob([output], { type: "application/json" });

            // Create download link
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = `scene_${new Date()
              .toISOString()
              .slice(0, 19)
              .replace(/:/g, "-")}.gltf`;

            // Add to body, click and remove
            document.body.appendChild(link);
            link.click();

            // Clean up
            URL.revokeObjectURL(link.href);
            document.body.removeChild(link);

            setSuccess(" Scene exported successfully as GLTF format");
          } else {
            throw new Error("Export result is not valid JSON format");
          }
          setIsExporting(false);
        },
        (error) => {
          setError(
            `Export error: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          setIsExporting(false);
        },
        options
      );
    } catch (err) {
      setError(
        `Export scene error: ${err instanceof Error ? err.message : String(err)}`
      );
      setIsExporting(false);
    }
  };

  return (
    <div className="unified-export-tools">
      <div className="exporter-header" onClick={toggleVisibility}>
        <h3>Export Tools</h3>
        <span className={`toggle-icon ${isVisible ? "expanded" : "collapsed"}`}>
          {isVisible ? "▼" : "▲"}
        </span>
      </div>

      {isVisible && (
        <>
          <div className="tab-selector">
            <button
              className={`tab-button ${activeTab === "image" ? "active" : ""}`}
              onClick={() => setActiveTab("image")}
            >
              Image Export
            </button>
            <button
              className={`tab-button ${activeTab === "model" ? "active" : ""}`}
              onClick={() => setActiveTab("model")}
            >
              Model Export
            </button>
          </div>

          {activeTab === "image" && (
            <div className="exporter-content">
              <button
                className="exporter-button image-button"
                onClick={saveHighQualityImage}
                disabled={isExporting || !scene || !renderer}
              >
                <span className="button-icon"></span>
                <span className="button-text">
                  {isExporting ? "Saving..." : "Save Image"}
                </span>
                <div
                  className={`button-background ${
                    isExporting ? "loading" : ""
                  }`}
                ></div>
              </button>
            </div>
          )}

          {activeTab === "model" && (
            <div className="exporter-content">
              <button
                className="exporter-button glb-button"
                onClick={exportToGLB}
                disabled={isExporting || !scene || !dynamicGroup}
              >
                <span className="button-icon"></span>
                <span className="button-text">
                  {isExporting ? "Exporting..." : "Export as GLB format"}
                </span>
                <div
                  className={`button-background ${
                    isExporting ? "loading" : ""
                  }`}
                ></div>
              </button>

              <button
                className="exporter-button gltf-button"
                onClick={exportToGLTF}
                disabled={isExporting || !scene || !dynamicGroup}
              >
                <span className="button-icon"></span>
                <span className="button-text">
                  {isExporting ? "Exporting..." : "Export as GLTF format"}
                </span>
                <div
                  className={`button-background ${
                    isExporting ? "loading" : ""
                  }`}
                ></div>
              </button>
            </div>
          )}

          {(error || success) && (
            <div className={`export-message ${error ? "error" : "success"}`}>
              {error || success}
            </div>
          )}
        </>
      )}

      <style jsx>{`
        .unified-export-tools {
          display: flex;
          flex-direction: column;
          border-radius: 10px;
          background-color: rgba(30, 30, 30, 0.85);
          backdrop-filter: blur(10px);
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
          border: 1px solid rgba(255, 255, 255, 0.1);
          transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
          overflow: hidden;
          width: 100%;
        }

        .exporter-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          cursor: pointer;
          background-color: rgba(40, 40, 40, 0.7);
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          user-select: none;
        }

        .exporter-header:hover {
          background-color: rgba(50, 50, 50, 0.7);
        }

        .exporter-header h3 {
          margin: 0;
          color: #f0f0f0;
          font-size: 14px;
          font-weight: 600;
        }

        .toggle-icon {
          color: #f0f0f0;
          font-size: 10px;
          transition: transform 0.3s ease;
        }

        .toggle-icon.collapsed {
          transform: rotate(180deg);
        }

        .tab-selector {
          display: flex;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .tab-button {
          flex: 1;
          padding: 10px;
          background: none;
          border: none;
          color: #ccc;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s ease;
          text-align: center;
        }

        .tab-button:hover {
          background-color: rgba(255, 255, 255, 0.05);
        }

        .tab-button.active {
          color: white;
          background-color: rgba(255, 255, 255, 0.1);
          font-weight: 500;
        }

        .exporter-content {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 12px;
        }

        .exporter-button {
          position: relative;
          padding: 10px 12px;
          border: none;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          background-color: transparent;
          color: white;
          overflow: hidden;
          transition: all 0.2s ease;
        }

        .button-background {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: -1;
          border-radius: 8px;
          opacity: 0.9;
          transition: all 0.3s ease;
        }

        .button-background.loading {
          background-size: 200% 200%;
          animation: loading-gradient 1.5s linear infinite;
        }

        .image-button .button-background {
          background-color:rgb(28, 28, 27)16, 15);
        }

        .glb-button .button-background {
          background-color:rgb(28, 28, 27)16, 15);
        }

        .gltf-button .button-background {
          background-color:rgb(41, 40, 42)24, 25);
        }

        .exporter-button:hover:not(:disabled) .button-background {
          opacity: 1;
          transform: scale(1.03);
        }

        .exporter-button:active:not(:disabled) .button-background {
          transform: scale(0.98);
        }

        .exporter-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .button-icon {
          font-size: 16px;
          z-index: 1;
        }

        .button-text {
          z-index: 1;
          flex-grow: 1;
          text-align: center;
        }

        .export-message {
          padding: 8px 10px;
          border-radius: 6px;
          font-size: 13px;
          margin: 0 12px 12px 12px;
          animation: message-fade-in 0.3s ease;
        }

        .export-message.error {
          background-color: rgba(244, 67, 54, 0.15);
          border-left: 3px solid #f44336;
          color: #ff7961;
        }

        .export-message.success {
          background-color: rgba(76, 175, 80, 0.15);
          border-left: 3px solid #4caf50;
          color: #81c784;
        }

        @keyframes message-fade-in {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes loading-gradient {
          0% {
            background-position: 0% 50%;
            background-image: linear-gradient(
              90deg,
              rgba(255, 255, 255, 0.1) 0%,
              rgba(255, 255, 255, 0.3) 50%,
              rgba(255, 255, 255, 0.1) 100%
            );
          }
          100% {
            background-position: 100% 50%;
            background-image: linear-gradient(
              90deg,
              rgba(255, 255, 255, 0.1) 0%,
              rgba(255, 255, 255, 0.3) 50%,
              rgba(255, 255, 255, 0.1) 100%
            );
          }
        }
      `}</style>
    </div>
  );
}
