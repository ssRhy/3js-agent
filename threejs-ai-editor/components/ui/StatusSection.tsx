import React from "react";

interface StatusSectionProps {
  error: string;
  success: string;
  showUpdateCodeReminder: boolean;
  isModelLoading: boolean;
}

const StatusSection: React.FC<StatusSectionProps> = ({
  error,
  success,
  showUpdateCodeReminder,
  isModelLoading,
}) => {
  return (
    <div className="status-section">
      {error && <div className="error">{error}</div>}
      {success && <div className="success">{success}</div>}
      {showUpdateCodeReminder && (
        <div className="update-reminder">
          <span>
            The object position has changed, click &quot;Generate&quot; button
            to update the code
          </span>
        </div>
      )}
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
