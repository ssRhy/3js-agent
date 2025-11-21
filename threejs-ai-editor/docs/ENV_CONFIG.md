# 环境变量配置说明

## 快速开始

### 1. 创建环境变量文件

在 `threejs-ai-editor` 目录下创建 `.env.local` 文件（用于本地开发）：

```bash
# ===================================
# 后端服务器配置
# ===================================

# 本地开发时使用本机地址
NEXT_PUBLIC_BACKEND_URL=http://localhost:3000

# 或者连接到远程服务器
# NEXT_PUBLIC_BACKEND_URL=https://your-aliyun-function.cn-hangzhou.fcapp.run
```

### 2. 生产环境配置（Vercel）

在 Vercel 项目设置中添加环境变量：

1. 进入项目设置 → Environment Variables
2. 添加以下变量：

| 变量名                    | 值                                     | 说明           |
| ------------------------- | -------------------------------------- | -------------- |
| `NEXT_PUBLIC_BACKEND_URL` | `https://your-aliyun-function-url.com` | 阿里云函数地址 |

**重要**：

- 必须以 `NEXT_PUBLIC_` 开头才能在浏览器端访问
- 修改后需要重新部署

### 3. 获取阿里云函数地址

部署阿里云函数后，在控制台或命令行输出中找到公网访问地址：

```bash
cd threejs-ai-editor
s deploy

# 输出示例：
# Function: threejsagent
# URL: https://1234567890.cn-hangzhou.fcapp.run
```

使用这个 URL 作为 `NEXT_PUBLIC_BACKEND_URL` 的值。

### 4. 验证配置

部署后打开浏览器控制台，查看连接日志：

```
✅ 成功：
[Socket.IO Client] Connecting to: https://your-backend-url
[Socket.IO Client] Connected with ID: xxx

❌ 失败（未配置环境变量）：
[Socket.IO Client] Connecting to: https://3js-agent.vercel.app
POST https://3js-agent.vercel.app/api/socket 400 (Bad Request)
```

## 完整环境变量列表

```bash
# ===================================
# 后端服务器（必需）
# ===================================
NEXT_PUBLIC_BACKEND_URL=https://your-backend-url.com

# ===================================
# API 配置（可选）
# ===================================
OPENAI_API_KEY=sk-xxx
OPENAI_API_BASE_URL=https://api.openai.com/v1

# ===================================
# Chroma 向量数据库（可选）
# ===================================
CHROMA_SERVER_URL=http://localhost:8000

# ===================================
# 环境标识（自动设置）
# ===================================
NODE_ENV=production
```

## 常见问题

### Q: 为什么必须以 NEXT*PUBLIC* 开头？

**A**: Next.js 只会将以 `NEXT_PUBLIC_` 开头的环境变量暴露给浏览器端代码。这是出于安全考虑，防止敏感信息（如 API 密钥）泄露到前端。

### Q: 本地开发如何配置？

**A**: 创建 `.env.local` 文件，使用本机地址：

```bash
NEXT_PUBLIC_BACKEND_URL=http://localhost:3000
```

### Q: 如何在不同环境使用不同配置？

**A**: 创建不同的环境变量文件：

- `.env.local` - 本地开发
- `.env.development` - 开发环境
- `.env.production` - 生产环境（在 Vercel 设置）

### Q: 修改环境变量后为什么不生效？

**A**: 需要重新部署：

- **本地**：重启开发服务器 (`npm run dev`)
- **Vercel**：触发重新部署或修改代码推送

### Q: 如何检查当前使用的后端地址？

**A**: 在浏览器控制台查看日志：

```javascript
// 打开控制台，输入：
console.log(process.env.NEXT_PUBLIC_BACKEND_URL);
```

### Q: WebSocket 连接失败怎么办？

**A**: 参考 [DEPLOYMENT.md](docs/DEPLOYMENT.md) 中的故障排查部分：

1. 确认环境变量配置正确
2. 检查后端服务器可访问性
3. 查看浏览器控制台日志
4. 验证阿里云函数配置

## 安全注意事项

⚠️ **不要在前端环境变量中存储敏感信息**

以下信息**不应该**使用 `NEXT_PUBLIC_` 前缀：

- API 密钥（如 `OPENAI_API_KEY`）
- 数据库连接字符串
- 私钥和证书
- 任何敏感凭证

这些应该只在后端（服务器端）使用，通过 API 路由安全地访问。

## 更多信息

- [部署指南](docs/DEPLOYMENT.md)
- [项目进度](docs/pro.md)
- [Next.js 环境变量文档](https://nextjs.org/docs/basic-features/environment-variables)
