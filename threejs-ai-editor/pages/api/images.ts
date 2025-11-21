import type { NextApiRequest, NextApiResponse } from "next";
import { promises as fs } from "fs";
import path from "path";

interface ImageInfo {
  id: string;
  name: string;
  fileName: string;
  size: number;
  url: string;
  base64Data: string;
  uploadDate: string;
  type: string;
}

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "images");

// 确保上传目录存在
const ensureUploadDir = async () => {
  try {
    await fs.access(UPLOAD_DIR);
  } catch {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  }
};

// 将图片转换为base64格式
const convertToBase64 = async (filePath: string): Promise<string> => {
  try {
    const imageBuffer = await fs.readFile(filePath);
    const base64String = imageBuffer.toString("base64");
    const ext = path.extname(filePath).toLowerCase();
    const mimeType =
      {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
      }[ext] || "image/jpeg";

    return `data:${mimeType};base64,${base64String}`;
  } catch (error) {
    console.error("Failed to convert image to base64:", error);
    return "";
  }
};

// 获取文件信息
const getFileInfo = async (fileName: string): Promise<ImageInfo | null> => {
  try {
    const filePath = path.join(UPLOAD_DIR, fileName);
    const stats = await fs.stat(filePath);
    const ext = path.extname(fileName).toLowerCase();

    if (![".jpg", ".jpeg", ".png", ".webp", ".bmp"].includes(ext)) {
      return null;
    }

    // 生成base64数据
    const base64Data = await convertToBase64(filePath);

    return {
      id: fileName.replace(/\.[^/.]+$/, ""),
      name: fileName,
      fileName: fileName,
      size: stats.size,
      url: `/uploads/images/${fileName}`,
      base64Data: base64Data,
      uploadDate: stats.mtime.toISOString(),
      type: ext,
    };
  } catch (error) {
    console.error(`Error getting file info for ${fileName}:`, error);
    return null;
  }
};

// 获取所有图片文件
const getAllImages = async (): Promise<ImageInfo[]> => {
  try {
    await ensureUploadDir();
    const files = await fs.readdir(UPLOAD_DIR);
    const imageInfos: ImageInfo[] = [];

    for (const file of files) {
      const info = await getFileInfo(file);
      if (info) {
        imageInfos.push(info);
      }
    }

    // 按上传时间排序（最新的在前）
    imageInfos.sort(
      (a, b) =>
        new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime()
    );

    return imageInfos;
  } catch (error) {
    console.error("Error getting all images:", error);
    return [];
  }
};

// 删除文件
const deleteImage = async (fileName: string): Promise<boolean> => {
  try {
    const filePath = path.join(UPLOAD_DIR, fileName);
    await fs.unlink(filePath);
    console.log(`Deleted image: ${fileName}`);
    return true;
  } catch (error) {
    console.error(`Error deleting image ${fileName}:`, error);
    return false;
  }
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    if (req.method === "GET") {
      // 获取所有图片列表
      const images = await getAllImages();
      res.status(200).json({
        success: true,
        images: images,
        count: images.length,
      });
    } else if (req.method === "DELETE") {
      // 删除指定图片
      const { fileName } = req.query;

      if (!fileName || typeof fileName !== "string") {
        return res.status(400).json({
          success: false,
          error: "fileName parameter is required",
        });
      }

      const success = await deleteImage(fileName);

      if (success) {
        res.status(200).json({
          success: true,
          message: `Image ${fileName} deleted successfully`,
        });
      } else {
        res.status(500).json({
          success: false,
          error: "Failed to delete image",
        });
      }
    } else {
      res.status(405).json({
        success: false,
        error: "Method not allowed",
      });
    }
  } catch (error) {
    console.error("Images API error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
