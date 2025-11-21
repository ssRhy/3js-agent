import React, { useState, useEffect, useRef } from "react";

export interface AgentStepDetails {
  toolName?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  reasoning?: string;
  suggestions?: string[];
  metrics?: Record<string, number | string>;
}

export interface AgentStep {
  id: string;
  type:
    | "thinking"
    | "tool_call"
    | "analysis"
    | "code_generation"
    | "completion";
  title: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "error";
  timestamp: Date;
  details?: AgentStepDetails;
}

interface AgentProgressDialogProps {
  isVisible: boolean;
  steps: AgentStep[];
  onClose: () => void;
}

const AgentProgressDialog: React.FC<AgentProgressDialogProps> = ({
  isVisible,
  steps,
  onClose,
}) => {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const progressRef = useRef<HTMLDivElement>(null);
  const currentStep =
    steps.find((s) => s.status === "in_progress") ?? steps[steps.length - 1];

  useEffect(() => {
    if (currentStep && progressRef.current) {
      const stepElement = progressRef.current.querySelector<HTMLElement>(
        `[data-step-id="${currentStep.id}"]`
      );
      if (stepElement) {
        stepElement.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [currentStep]);

  const toggleStepExpansion = (stepId: string) => {
    setExpandedSteps((prev) => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(stepId)) {
        newExpanded.delete(stepId);
      } else {
        newExpanded.add(stepId);
      }
      return newExpanded;
    });
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 transition-opacity duration-300">
      <div className="agent-progress-dialog bg-gray-900 border border-gray-700 rounded-xl w-[90vw] max-w-3xl h-[80vh] flex flex-col shadow-2xl">
        <div className="dialog-header flex justify-between items-center p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">Agent Workflow</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            &times;
          </button>
        </div>
        <div
          className="dialog-content flex-1 overflow-y-auto p-6"
          ref={progressRef}
        >
          <div className="steps-timeline">
            {steps.map((step) => (
              <div
                key={step.id}
                data-step-id={step.id}
                className={`step-item ${step.status}`}
              >
                <div className="step-content ml-4">
                  <h3 className="step-title font-medium text-white">
                    {step.title}
                  </h3>
                  <p className="step-description text-sm text-gray-400">
                    {step.description}
                  </p>
                  {step.details && (
                    <div className="mt-2">
                      <button
                        onClick={() => toggleStepExpansion(step.id)}
                        className="text-xs text-blue-400 hover:underline"
                      >
                        {expandedSteps.has(step.id)
                          ? "Hide Details"
                          : "Show Details"}
                      </button>
                      {expandedSteps.has(step.id) && (
                        <div className="details-content bg-gray-800 p-3 rounded-md mt-2 text-xs">
                          <pre className="text-white whitespace-pre-wrap">
                            {JSON.stringify(step.details, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentProgressDialog;
