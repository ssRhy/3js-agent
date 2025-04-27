import type { NextApiRequest, NextApiResponse } from "next";
import fetch from "node-fetch";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // 支持GET和POST请求
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // 获取模型URL (支持POST和GET两种方式)
    let modelUrl;

    if (req.method === "POST") {
      // 从POST请求体中获取URL
      modelUrl = req.body.url;
    } else {
      // 从GET请求查询参数中获取URL
      modelUrl = req.query.url as string;
    }

    if (!modelUrl || typeof modelUrl !== "string") {
      return res.status(400).json({ error: "Valid URL is required" });
    }

    // 确保URL是绝对URL
    try {
      // 判断如果modelUrl是以/api开头，说明是相对路径，需要转换为绝对路径
      if (modelUrl.startsWith("/api/")) {
        // 这种情况是客户端错误地传入了相对URL，需要转为绝对URL
        console.warn(
          "Received relative URL, attempting to convert to absolute"
        );

        // 尝试从URL中提取实际需要代理的URL
        const urlParam = new URLSearchParams(modelUrl.split("?")[1]).get("url");
        if (urlParam) {
          console.log(
            "Extracted actual target URL from query parameter:",
            urlParam
          );
          // 将解码后的URL作为目标
          modelUrl = decodeURIComponent(urlParam);
        } else {
          throw new Error("Cannot extract target URL from relative path");
        }
      }

      // 确保URL有协议前缀
      if (!modelUrl.startsWith("http://") && !modelUrl.startsWith("https://")) {
        throw new Error(
          `Invalid URL format - must be absolute URL with http/https protocol: ${modelUrl}`
        );
      }

      // 验证URL格式
      new URL(modelUrl);
    } catch (urlError) {
      console.error("URL validation error:", urlError);
      return res.status(400).json({
        error: `Invalid URL format: ${
          urlError instanceof Error ? urlError.message : String(urlError)
        }`,
      });
    }

    console.log("Proxying model request for URL:", modelUrl);

    // 获取模型文件
    const modelResponse = await fetch(modelUrl, {
      headers: {
        // 添加必要的头部确保内容正确获取
        Accept: "model/gltf-binary,*/*",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });

    if (!modelResponse.ok) {
      console.error(
        `Failed to fetch model: ${modelResponse.status} ${modelResponse.statusText}`
      );
      return res.status(modelResponse.status).json({
        error: `Failed to fetch model: ${modelResponse.statusText}`,
      });
    }

    // 获取二进制数据
    const modelBuffer = await modelResponse.arrayBuffer();

    // 获取Content-Type或默认为gltf-binary
    const contentType =
      modelResponse.headers.get("Content-Type") || "model/gltf-binary";

    // 设置跨域头
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    // 返回数据
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", 'attachment; filename="model.glb"');
    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.status(200);

    // 直接返回二进制数据
    res.send(Buffer.from(modelBuffer));
  } catch (error) {
    console.error("Error proxying model:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error occurred",
    });
  }
}
