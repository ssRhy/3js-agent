import type { NextApiRequest, NextApiResponse } from "next";
import { promises as fs } from "fs";
import path from "path";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "models");

interface ModelInfo {
  id: string;
  name: string;
  fileName: string;
  size: number;
  url: string;
  uploadDate: string;
  type: string;
}

// 确保上传目录存在
const ensureUploadDir = async () => {
  try {
    await fs.access(UPLOAD_DIR);
  } catch {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  }
};

// 获取文件信息
const getFileInfo = async (fileName: string): Promise<ModelInfo | null> => {
  try {
    const filePath = path.join(UPLOAD_DIR, fileName);
    const stats = await fs.stat(filePath);
    const ext = path.extname(fileName).toLowerCase();

    if (![".glb", ".gltf"].includes(ext)) {
      return null;
    }

    return {
      id: fileName.replace(/\.[^/.]+$/, ""),
      name: fileName,
      fileName: fileName,
      size: stats.size,
      url: `/uploads/models/${fileName}`,
      uploadDate: stats.mtime.toISOString(),
      type: ext,
    };
  } catch (error) {
    console.error(`Error getting file info for ${fileName}:`, error);
    return null;
  }
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    await ensureUploadDir();

    if (req.method === "GET") {
      // 列出所有已上传的模型
      const files = await fs.readdir(UPLOAD_DIR);
      const models: ModelInfo[] = [];

      for (const file of files) {
        const modelInfo = await getFileInfo(file);
        if (modelInfo) {
          models.push(modelInfo);
        }
      }

      // 按上传时间排序（最新的在前）
      models.sort(
        (a, b) =>
          new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime()
      );

      res.status(200).json({
        success: true,
        models,
      });
    } else if (req.method === "DELETE") {
      // 删除指定模型
      const { fileName } = req.query;

      if (!fileName || typeof fileName !== "string") {
        return res.status(400).json({ error: "File name is required" });
      }

      const filePath = path.join(UPLOAD_DIR, fileName);

      try {
        await fs.access(filePath);
        await fs.unlink(filePath);

        res.status(200).json({
          success: true,
          message: "Model deleted successfully",
        });
      } catch (error) {
        res.status(404).json({ error: "Model not found" });
      }
    } else {
      res.status(405).json({ error: "Method not allowed" });
    }
  } catch (error) {
    console.error("Models API error:", error);
    res.status(500).json({
      error: "Internal server error",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
