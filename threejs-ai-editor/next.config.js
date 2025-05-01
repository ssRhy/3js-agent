/** @type {import('next').NextConfig} */
const nextConfig = {
  api: {
    responseLimit: "8mb", // Increase from default 4MB to 8MB
    bodyParser: {
      sizeLimit: "8mb",
    },
  },
  /* config options here */
  reactStrictMode: true,
  // 确保API路由正确处理
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "/api/:path*",
      },
    ];
  },
  // 设置basePath为空，确保正确处理路径
  basePath: "",
  // 禁用文件追踪功能以避免.next/trace文件访问问题
  experimental: {
    outputFileTracingRoot: false,
  },
  // ESLint configuration
  eslint: {
    // Explicitly enable ESLint detection during development
    ignoreDuringBuilds: false,
    dirs: ["pages", "components", "lib", "utils", "stores"],
  },
  // 更安全的webpack配置
  webpack: (config, { isServer }) => {
    // 避免在客户端尝试导入node-only模块
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.alias,
        fs: false,
        path: false,
        os: false,
        child_process: false,
      };
    }
    // Monaco Editor的webpack配置
    config.resolve.alias = {
      ...config.resolve.alias,
      "monaco-editor": "monaco-editor/esm/vs/editor/editor.api.js",
    };

    return config;
  },
};

module.exports = nextConfig;
