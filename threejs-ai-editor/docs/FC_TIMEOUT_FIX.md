# 阿里云 FC 超时问题修复 - 快速参考

## 问题现象

❌ **Agent 生成的代码无法在前端显示**  
❌ **请求超时，但 Agent 还在后台执行**  
❌ **WebSocket/Socket.IO 连接不稳定**

## 根本原因

```
问题：多层超时限制，层层递进
├── 前端Fetch: 浏览器默认超时 (30-60秒)
├── Next.js API: 默认60秒超时
├── 阿里云FC: 配置600秒
└── Agent执行: 实际需要几分钟

结果：即使FC配置了600秒，前端和Next.js先超时了！
```

## 解决方案速查

### 1. Next.js 配置（`next.config.js`）

```javascript
api: {
  externalResolver: true,    // 移除默认超时
  responseLimit: false,       // 移除响应大小限制
},
```

### 2. API Route 配置（`pages/api/agentHandler.ts`）

```javascript
export const config = {
  api: {
    bodyParser: { sizeLimit: "50mb" },
    responseLimit: false,
    externalResolver: true,
  },
  maxDuration: 600, // 10分钟
};
```

### 3. 前端 Fetch（`components/ThreeCodeEditor.tsx`）

```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 570000); // 9.5分钟

const response = await fetch("/api/agentHandler", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
  signal: controller.signal, // ← 关键
});

clearTimeout(timeoutId);
```

### 4. Socket.IO（`lib/socket.ts`）

```typescript
const socket = io(serverUrl, {
  transports: ["polling", "websocket"], // Polling优先
  upgrade: true,
  rememberUpgrade: false,
  timeout: 30000,
  reconnectionAttempts: 10,
  reconnectionDelay: 2000,
});
```

### 5. 阿里云 FC（`s.yaml`）

```yaml
props:
  timeout: 600 # 10分钟
  instanceConcurrency: 10 # 支持更多并发
  cpu: 0.1
  memorySize: 256
```

## 超时时间配置表

| 层级           | 超时时间 | 原因                          |
| -------------- | -------- | ----------------------------- |
| 阿里云 FC      | 600 秒   | Agent 执行的最大时间          |
| Next.js API    | 600 秒   | 与 FC 一致                    |
| 前端 Fetch     | 570 秒   | 略小于 FC，确保能收到 FC 响应 |
| Socket.IO 连接 | 30 秒    | Polling 模式快速重连          |

## 部署命令

```bash
# 1. 进入项目目录
cd threejs-ai-editor

# 2. 部署到阿里云FC
s deploy --region cn-hangzhou

# 3. 查看日志
s logs --region cn-hangzhou -t
```

## 验证步骤

### 1. 测试简单请求

```
提示词："创建一个红色立方体"
预期：10-20秒内返回代码
```

### 2. 测试复杂请求

```
提示词："创建一个包含多个物体的复杂场景"
预期：1-2分钟内返回代码（不超时）
```

### 3. 检查控制台

看到以下日志表示成功：

```
[Socket.IO Client] Connected with ID: xxx
[Generate] Sending request to backend...
[Generate] Received response from backend: {...}
[Generate] Set new code to editor
```

## 常见问题

### Q: 为什么前端设置 570 秒，而不是 600 秒？

A: 留 30 秒 buffer 给 FC 返回超时响应，避免前端和 FC 同时超时导致无响应。

### Q: 如果还是超时怎么办？

1. 检查 FC 日志：`s logs --region cn-hangzhou -t`
2. 检查浏览器控制台是否有网络错误
3. 确认 FC 实例是否冷启动（第一次请求会慢）
4. 检查 LLM API 是否响应慢

### Q: Polling 模式会影响性能吗？

A: 对于间歇性请求（如截图）不会。Polling 就是 HTTP 长轮询，适合 FC 环境。

### Q: 能否进一步优化？

可以考虑：

1. 使用 FC 预留实例（避免冷启动）
2. 流式响应（SSE/WebSocket）
3. 任务队列（异步处理）
4. 增加 CPU/内存配置

## 技术架构对比

### 修改前 ❌

```
用户 → Fetch(60s) → Next.js(60s) → FC(600s) → Agent
                ↓
            超时报错
```

### 修改后 ✅

```
用户 → Fetch(570s) → Next.js(600s) → FC(600s) → Agent
                                           ↓
                                      生成代码
         ↓
    显示在编辑器
```

## 相关文件清单

```
修改的文件：
├── threejs-ai-editor/next.config.js
├── threejs-ai-editor/pages/api/agentHandler.ts
├── threejs-ai-editor/components/ThreeCodeEditor.tsx
├── threejs-ai-editor/lib/socket.ts
├── threejs-ai-editor/hooks/socket/useSocketConnection.ts
└── threejs-ai-editor/s.yaml

新增文档：
├── docs/FC_TIMEOUT_FIX.md (本文件)
├── docs/FC_POLLING_MODE.md
└── docs/pro.md (更新)
```

## 监控建议

### FC 监控

```bash
# 实时日志
s logs --region cn-hangzhou -t

# 查看函数信息
s info --region cn-hangzhou
```

### 前端监控

浏览器控制台关键日志：

- `[Socket.IO Client] Connected` - Socket 连接成功
- `[Generate] Sending request` - 开始请求
- `[Generate] Received response` - 收到响应
- `[Generate] Set new code` - 代码已更新

## 成功指标

✅ Agent 请求成功率 > 95%  
✅ 平均响应时间 < 2 分钟  
✅ Socket.IO 连接稳定  
✅ 无超时错误

## 联系支持

如果问题持续：

1. 检查阿里云 FC 配额和限制
2. 查看 OpenAI API 状态
3. 检查网络连接
4. 查看详细错误日志

---

**最后更新：** 2025 年 11 月 12 日  
**适用版本：** Next.js 14 + 阿里云 FC3  
**维护状态：** 🟢 活跃维护中
