# 部署指南

## 阿里云函数计算部署配置

### WebSocket 连接问题解决方案

#### 1. 前端环境变量配置

在前端部署（Vercel 或其他平台）时，需要配置以下环境变量：

```bash
# 后端服务器地址 - 您的阿里云函数地址
NEXT_PUBLIC_BACKEND_URL=https://your-function-id.cn-hangzhou.fcapp.run

# 如果使用自定义域名
NEXT_PUBLIC_BACKEND_URL=https://your-custom-domain.com
```

**重要**：环境变量必须以 `NEXT_PUBLIC_` 开头才能在浏览器端使用。

#### 2. 阿里云函数配置

修改 `s.yaml` 中的配置以支持 WebSocket：

```yaml
props:
  timeout: 300              # 增加超时时间到 5 分钟
  instanceConcurrency: 10   # 增加并发数
  cpu: 0.1                  # CPU 核心数
  memorySize: 256           # 内存 MB
```

**重要限制**：

1. **内存/CPU 比例**：阿里云函数要求**内存（GB）/ CPU（核心）的比例必须在 1-4 之间**
2. **sessionAffinity**：FC3 不支持此配置，已移除（WebSocket 通过其他机制保持连接）

示例配置：
- 256 MB (0.25 GB) / 0.1 核心 = 2.5 ✅
- 512 MB (0.5 GB) / 0.2 核心 = 2.5 ✅
- 128 MB (0.128 GB) / 0.05 核心 = 2.56 ✅
- ~~256 MB (0.25 GB) / 0.05 核心 = 5.0~~ ❌（比例超过4）

#### 3. WebSocket 降级策略

系统已配置自动降级：

- 优先尝试 WebSocket 连接
- 如果 WebSocket 失败，自动降级到 HTTP 长轮询
- 适用于不支持 WebSocket 的云环境

### 连接配置说明

在 `lib/socket.ts` 中，Socket.IO 客户端会按以下顺序选择服务器地址：

1. `NEXT_PUBLIC_BACKEND_URL` - 后端服务器地址（推荐）
2. `NEXT_PUBLIC_API_URL` - 备用 API 地址
3. `window.location.origin` - 当前页面地址（默认）

### 部署步骤

#### Vercel 前端部署

1. 在 Vercel 项目设置中添加环境变量：
   ```
   NEXT_PUBLIC_BACKEND_URL = https://your-aliyun-function-url.com
   ```

2. 触发重新部署

#### 阿里云函数后端部署

1. 确保 `s.yaml` 配置正确
2. 运行部署命令：
   ```bash
   cd threejs-ai-editor
   s deploy
   ```

3. 获取函数公网地址
4. 将该地址配置到 Vercel 的 `NEXT_PUBLIC_BACKEND_URL` 环境变量

### 故障排查

#### WebSocket 连接失败

**症状**：
```
POST https://xxx/api/socket 400 (Bad Request)
[Socket.IO Client] Connection error: xhr poll error
```

**原因**：
- 前端连接到错误的服务器地址
- 后端不支持 WebSocket 协议

**解决方案**：
1. 检查 `NEXT_PUBLIC_BACKEND_URL` 是否正确配置
2. 在浏览器控制台查看实际连接地址：
   ```
   [Socket.IO Client] Connecting to: https://...
   ```
3. 确认该地址可访问

#### 连接频繁断开

**原因**：
- 云函数超时设置过短
- 并发限制

**解决方案**：
1. 增加 `s.yaml` 中的 `timeout` 值
2. 增加 `instanceConcurrency` 值
3. 考虑升级云函数规格

#### 部署错误：sessionAffinity CLIENT_IP is invalid

**原因**：
- 阿里云 FC3 不支持 `sessionAffinity` 配置

**解决方案**：
- 已从配置中移除，WebSocket 通过 Socket.IO 自身机制维护连接
- 不影响功能，Socket.IO 会自动处理重连

#### CORS 错误

**解决方案**：
在 `pages/api/socket.ts` 中已配置 CORS：
```typescript
cors: {
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
}
```

### 性能优化

#### 1. 连接池

系统使用全局连接池管理客户端连接：
- 自动清理断开的连接
- 重用已建立的连接

#### 2. 心跳机制

- 服务器每 30 秒发送心跳
- 客户端自动响应
- 超时 60 秒自动断开

#### 3. 超时配置

- 连接超时：20 秒
- 截图请求超时：30 秒
- 重连延迟：1-5 秒

### 监控和日志

#### 查看连接状态

浏览器控制台会显示详细日志：
```
[Socket.IO Client] Connecting to: https://...
[Socket.IO Client] Connected with ID: xxx
[Socket.IO Client] Connection established: { clientId, timestamp }
```

#### 服务器端日志

阿里云函数日志会显示：
```
[Socket.IO] Client connected: client_xxx
[Socket.IO] Screenshot request sent to client xxx
```

### 注意事项

1. **环境变量更新**：修改环境变量后需要重新部署
2. **跨域配置**：确保后端允许前端域名的跨域请求
3. **函数冷启动**：首次连接可能较慢，属于正常现象
4. **成本控制**：长连接会增加函数计算费用，建议监控使用量

### 其他部署选项

如果阿里云函数 WebSocket 支持有限，可考虑：

1. **使用轮询模式**：系统已自动配置降级
2. **部署到支持 WebSocket 的平台**：
   - 阿里云 ECS
   - 腾讯云 Serverless
   - AWS Lambda + API Gateway
3. **使用 Redis Pub/Sub**：替代 WebSocket 进行消息传递

