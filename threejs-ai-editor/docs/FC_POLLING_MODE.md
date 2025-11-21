# 阿里云FC Polling模式配置说明

## 问题：WebSocket连接不稳定

部署到阿里云FC后，Socket.IO连接断断续续，无法正常工作。

## 解决方案：Polling优先模式

### 为什么选择Polling模式？

#### 项目特点分析

本项目使用Socket.IO的场景是：
- **AI Agent请求截图** → 浏览器返回截图 → **Agent分析**
- 这是**间歇性的请求-响应**模式，不是连续的双向流
- 不需要一直保持连接

#### 阿里云FC的限制

- HTTP触发器对WebSocket支持有限
- 实例会被冷启动/回收
- 长连接不稳定且成本高

#### Polling模式的优势

✅ **完全适配FC**：基于HTTP，FC完全支持  
✅ **连接稳定**：不受FC实例生命周期影响  
✅ **优雅降级**：Socket.IO自动处理重连  
✅ **够用的实时性**：对于间歇性请求完全够用

## 配置变更

### 1. Socket.IO客户端 (`lib/socket.ts`)

```typescript
const socket = io(serverUrl, {
  // 关键：优先使用polling
  transports: ["polling", "websocket"],
  upgrade: true,
  rememberUpgrade: false,
  
  // 增加超时和重连，应对FC冷启动
  timeout: 30000,
  reconnectionAttempts: 10,
  reconnectionDelay: 2000,
  reconnectionDelayMax: 10000,
});
```

**核心改变**：
- `transports` 顺序从 `["websocket", "polling"]` 改为 `["polling", "websocket"]`
- 优先使用polling，连接更稳定

### 2. 心跳优化 (`hooks/socket/useSocketConnection.ts`)

```typescript
// 降低频率：1分钟 → 2分钟
// Socket.IO自带心跳，客户端不需要主动ping
heartbeatIntervalRef.current = setInterval(() => {
  // 仅检查状态，不发送ping
  console.log("[Socket] Connection status check:", socket.connected);
}, 120000);
```

### 3. FC函数配置 (`s.yaml`)

```yaml
props:
  timeout: 600 # 10分钟，支持较长流程
  instanceConcurrency: 10 # Polling模式支持更多并发
  cpu: 0.1
  memorySize: 256
  
  # 实例生命周期管理
  instanceLifecycleConfig:
    preFreeze:
      handler: index.preFreeze
      timeout: 3
```

## 技术对比

| 特性 | WebSocket模式 | Polling模式 ✅ |
|-----|--------------|---------------|
| **阿里云FC支持** | ❌ 有限 | ✅ 完全支持 |
| **连接稳定性** | ❌ 不稳定 | ✅ 稳定 |
| **冷启动影响** | ❌ 影响大 | ✅ 影响小 |
| **实时性** | 优秀 | 足够 |
| **资源消耗** | 较高 | 较低 |
| **适用场景** | 连续双向流 | 请求-响应 ✅ |

## 部署步骤

### 1. 更新代码

```bash
git pull origin main
```

### 2. 部署到阿里云

```bash
cd threejs-ai-editor
s deploy
```

### 3. 验证连接

访问：https://threejsagent-ieldvplhjj.cn-hangzhou.fcapp.run

打开浏览器控制台，查看日志：

```
[Socket.IO Client] Connecting to: https://...
[Socket.IO Client] Connected with ID: xxx
[Socket] Connection status check: true
```

如果看到以上日志，说明连接成功！

## 故障排查

### 连接失败？

1. **检查transports顺序**
   ```typescript
   // 确保是 polling 在前
   transports: ["polling", "websocket"]
   ```

2. **检查FC配置**
   ```bash
   s info --region cn-hangzhou
   ```
   确认：
   - timeout >= 600
   - instanceConcurrency >= 10

3. **查看FC日志**
   ```bash
   s logs --region cn-hangzhou -t
   ```

### 连接慢？

- 这是正常的，FC冷启动需要时间
- Polling模式会自动重连
- 增加了重连次数和超时时间来应对

### 想要更快的响应？

可以考虑：
1. 使用FC预留实例（避免冷启动）
2. 增加CPU/内存配置
3. 使用VPC内网访问

## FAQ

### Q: Polling模式会不会很慢？

A: 不会。Socket.IO的polling使用HTTP长轮询，对于间歇性请求（如截图）完全够用。实际延迟在可接受范围内。

### Q: 为什么不直接用HTTP API？

A: Socket.IO提供了很多便利：
- 自动重连
- 事件驱动
- 请求追踪
- 降级处理

改为纯HTTP API需要大量重构，而Polling模式就是优化的HTTP。

### Q: WebSocket会完全不用吗？

A: 不是。`upgrade: true` 允许在条件好时升级到WebSocket，但优先使用稳定的Polling。

### Q: 生产环境建议？

A: 当前配置已经针对FC优化。如果有更高要求，可以考虑：
- 使用FC预留实例
- 配置自定义域名
- 增加资源配额

## 结论

**保持Socket.IO + Polling优先模式是最佳方案**

既保留了Socket.IO的便利性，又完美适配阿里云FC环境。不需要改为纯HTTP轮询API。

