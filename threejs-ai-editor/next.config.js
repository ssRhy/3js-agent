/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    // Fix for webpack-internal URL scheme errors
    config.module.exprContextCritical = false;

    // Avoid client-side imports of node-only modules
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
        child_process: false,
        console: false,
        chromadb: false,
        "@langchain/community/vectorstores/chroma": false,
        "langchain/document": false,
        "@langchain/openai": false,
        "@langchain/community": false,
        "@langchain/core": false,
        langchain: false,
      };
    }

    // Resolve Monaco Editor webpack issues
    config.resolve.alias = {
      ...config.resolve.alias,
      "monaco-editor": "monaco-editor/esm/vs/editor/editor.api.js",
    };

    return config;
  },
  // Add CORS headers for WebSocket support
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          {
            key: "Access-Control-Allow-Methods",
            value: "GET,POST,PUT,DELETE,OPTIONS",
          },
          {
            key: "Access-Control-Allow-Headers",
            value: "X-Requested-With,Content-Type,Authorization",
          },
          { key: "Access-Control-Allow-Credentials", value: "true" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
