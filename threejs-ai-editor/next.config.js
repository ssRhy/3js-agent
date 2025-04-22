/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  reactStrictMode: true,
  webpack: (config) => {
    // Monaco Editor的webpack配置
    config.resolve.alias = {
      ...config.resolve.alias,
      "monaco-editor": "monaco-editor/esm/vs/editor/editor.api.js",
    };

    return config;
  },
};

module.exports = nextConfig;
