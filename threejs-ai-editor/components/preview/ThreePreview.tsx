import React from "react";
import { ThreeSceneRef } from "../../hooks/three/useThreeScene";
import UnifiedExportTools from "../UnifiedExportTools";
import ObjectManipulationControls from "../ObjectManipulationControls";

interface ThreePreviewProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  threeRef: React.RefObject<ThreeSceneRef | null>;
  lintErrors: Array<{
    ruleId: string | null;
    severity: number;
    message: string;
    line: number;
    column: number;
  }>;
  lintOverlayVisible: boolean;
  setLintOverlayVisible: (visible: boolean) => void;
}

const ThreePreview: React.FC<ThreePreviewProps> = ({
  containerRef,
  threeRef,
  lintErrors,
  lintOverlayVisible,
  setLintOverlayVisible,
}) => {
  return (
    <>
      <div className="preview" ref={containerRef}></div>

      {/* Scene Exporter component for image export */}
      {threeRef.current?.renderer && (
        <div className="scene-exporter-container">
          <UnifiedExportTools renderer={threeRef.current.renderer} />
        </div>
      )}

      {/* 始终显示操作控制面板 */}
      <div className="ui-controls-container">
        <ObjectManipulationControls />
      </div>

      {lintOverlayVisible && lintErrors.length > 0 && (
        <div className="lint-overlay">
          <div className="lint-overlay-content">
            <h3>ESLint Result</h3>
            <button
              onClick={() => setLintOverlayVisible(false)}
              className="close-button"
            >
              ×
            </button>
            <ul className="lint-errors-list">
              {lintErrors.map((error, index) => (
                <li key={index} className="lint-error-item">
                  <span className="lint-error-location">
                    行 {error.line}:{error.column}
                  </span>
                  <span className="lint-error-message">{error.message}</span>
                  <span className="lint-error-rule">{error.ruleId}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
};

export default ThreePreview;
