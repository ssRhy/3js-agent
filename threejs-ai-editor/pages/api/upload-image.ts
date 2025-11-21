import type { NextApiRequest, NextApiResponse } from "next";
import { IncomingForm, File } from "formidable";
import { promises as fs } from "fs";
import path from "path";

export const config = {
  api: {
    bodyParser: false,
  },
};

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "images");
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".bmp"];

// 确保上传目录存在
const ensureUploadDir = async () => {
  try {
    await fs.access(UPLOAD_DIR);
  } catch {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  }
};

// 验证文件类型
const validateFile = (file: File): { isValid: boolean; error?: string } => {
  const ext = path.extname(file.originalFilename || "").toLowerCase();

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      isValid: false,
      error: `Invalid file type. Only image files are allowed (${ALLOWED_EXTENSIONS.join(
        ", "
      )}). Got: ${ext}`,
    };
  }

  if (file.size > MAX_FILE_SIZE) {
    return {
      isValid: false,
      error: `File size too large. Maximum size is 10MB. Got: ${Math.round(
        file.size / 1024 / 1024
      )}MB`,
    };
  }

  return { isValid: true };
};

// 生成唯一文件名
const generateFileName = (originalName: string): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const ext = path.extname(originalName);
  const baseName = path.basename(originalName, ext);
  return `${baseName}_${timestamp}_${random}${ext}`;
};

// 将图片转换为base64格式（用于后续分析）
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
    throw error;
  }
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    await ensureUploadDir();

    const form = new IncomingForm({
      uploadDir: UPLOAD_DIR,
      keepExtensions: true,
      maxFileSize: MAX_FILE_SIZE,
      multiples: false,
    });

    // 使用 Promise 包装 form.parse 方法
    const [fields, files] = await new Promise<[any, any]>((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve([fields, files]);
      });
    });

    const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;

    if (!uploadedFile) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // 验证文件
    const validation = validateFile(uploadedFile);
    if (!validation.isValid) {
      // 删除已上传的文件
      try {
        await fs.unlink(uploadedFile.filepath);
      } catch (error) {
        console.error("Failed to delete invalid file:", error);
      }
      return res.status(400).json({ error: validation.error });
    }

    // 生成新文件名并移动文件
    const newFileName = generateFileName(
      uploadedFile.originalFilename || "image"
    );
    const newFilePath = path.join(UPLOAD_DIR, newFileName);

    await fs.rename(uploadedFile.filepath, newFilePath);

    // 转换为base64格式用于后续分析
    let base64Data = "";
    try {
      base64Data = await convertToBase64(newFilePath);
    } catch (error) {
      console.error("Failed to convert to base64:", error);
      // base64转换失败不影响文件上传，继续处理
    }

    // 返回文件信息
    const fileInfo = {
      id: newFileName.replace(/\.[^/.]+$/, ""), // 去掉扩展名作为ID
      name: uploadedFile.originalFilename || "Unknown",
      fileName: newFileName,
      size: uploadedFile.size,
      url: `/uploads/images/${newFileName}`,
      base64Data: base64Data, // 添加base64数据用于分析
      uploadDate: new Date().toISOString(),
      type: path.extname(newFileName).toLowerCase(),
    };

    res.status(200).json({
      success: true,
      file: fileInfo,
      message: "Image uploaded successfully",
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({
      error: "Upload failed",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
