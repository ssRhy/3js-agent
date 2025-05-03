import { NextApiRequest, NextApiResponse } from "next";
import handler from "./agentHandler";
import { SceneStateObject } from "../../lib/types/sceneTypes";
import { LintError } from "../../lib/types/codeTypes";

/**
 * Agent API endpoint
 *
 * This file redirects requests to the agentHandler implementation.
 * It serves as the entry point for the /api/agent API route.
 */

// Increase the body parser size limit to handle larger requests
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb", // Increase from the default 1mb
    },
    responseLimit: "10mb", // Also increase response size limit
  },
};

// 更新请求体接口定义
export interface AgentRequest {
  action: string;
  code?: string;
  prompt?: string;
  screenshot?: string;
  // 新增截图分析结果字段
  screenshotAnalysis?: {
    status: string;
    message: string;
    scene_objects?: Record<string, unknown>[];
    matches_requirements?: boolean;
    needs_improvements?: boolean;
    recommendation?: string;
    [key: string]: unknown;
  };
  sceneState?: SceneStateObject[];
  sceneHistory?: Record<string, unknown>;
  modelSize?: number;
  renderingComplete?: boolean;
  lintErrors?: LintError[];
}

export default async function agentEndpoint(
  req: NextApiRequest,
  res: NextApiResponse
) {
  return handler(req, res);
}
