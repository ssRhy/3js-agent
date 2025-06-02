import React from "react";

interface StatusSectionProps {
  error: string;
  isModelLoading: boolean;
}

const StatusSection: React.FC<StatusSectionProps> = ({
  error,
  isModelLoading,
}) => {
  return (
    <div className="status-section">
      {error && <div className="error">{error}</div>}
      {isModelLoading && (
        <div className="loading-model">
          <span className="loading-spinner"></span>
          <span>Loading 3D Modeling...</span>
        </div>
      )}
    </div>
  );
};

export default StatusSection;
