# 🚀 服务器部署快速开始

## 修改内容总结

本次修改已将项目从**阿里云 FC（Serverless）**优化为**传统服务器部署**。

### ✅ 已完成的修改

1. **`next.config.js`** - 移除了 FC 特殊配置
2. **`pages/api/agentHandler.ts`** - 移除了 maxDuration 等 FC 专用配置
3. **`components/ThreeCodeEditor.tsx`** - 超时时间从 9.5 分钟调整为 5 分钟
4. **`env.template`** - 环境变量配置模板
5. **`.gitignore`** - 允许提交 env.template

### 📦 部署前准备

#### 1. 配置环境变量

```bash
# 在项目根目录创建 .env.local 文件
cp env.template .env.local

# 编辑配置（必需修改）
nano .env.local
```

**必须配置的项**：

```bash
OPENAI_API_KEY=sk-your-actual-key-here
NEXT_PUBLIC_BACKEND_URL=http://your-server-ip
```

#### 2. 提交代码到 Git

```bash
git add .
git commit -m "优化：适配传统服务器部署，移除FC配置"
git push origin main
```

## 🖥️ 服务器部署步骤

### 服务器信息

```
IP: 47.95.159.189
用户: admin（需要使用sudo）或root
系统: Ubuntu/Debian
```

### 一键部署脚本

**SSH 连接服务器后执行：**

```bash
# 切换到root用户
sudo su -

# 更新系统并安装环境
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git nginx
npm install -g pm2

# 克隆项目
mkdir -p /var/www && cd /var/www
git clone https://github.com/YOUR_USERNAME/3js-agent.git
cd 3js-agent/threejs-ai-editor

# 配置环境变量
cp env.template .env.local
nano .env.local  # 填入配置后保存

# 安装依赖并构建
npm install
npm run build

# 启动应用
pm2 start npm --name "3js-agent" -- start
pm2 startup
pm2 save

# 配置Nginx
cat > /etc/nginx/sites-available/3js-agent << 'EOF'
server {
    listen 80;
    server_name 47.95.159.189;

    proxy_connect_timeout 600;
    proxy_send_timeout 600;
    proxy_read_timeout 600;
    client_max_body_size 50M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

ln -s /etc/nginx/sites-available/3js-agent /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx
systemctl enable nginx
```

### 配置防火墙

在阿里云控制台：

1. 进入"轻量应用服务器" → 您的实例
2. 点击"防火墙"标签
3. 添加规则：
   - HTTP(80) - 允许 0.0.0.0/0
   - HTTPS(443) - 允许 0.0.0.0/0（如果需要 SSL）

## ✅ 验证部署

访问：http://47.95.159.189

应该能看到 Three.js AI Editor 界面！

## 📊 常用管理命令

```bash
# 查看应用状态
pm2 status

# 查看日志
pm2 logs 3js-agent

# 重启应用
pm2 restart 3js-agent

# 更新代码
cd /var/www/3js-agent/threejs-ai-editor
git pull
npm install
npm run build
pm2 restart 3js-agent
```

## 🔍 故障排查

### 应用无法访问？

```bash
pm2 status                      # 检查应用状态
pm2 logs 3js-agent --lines 50   # 查看日志
systemctl status nginx          # 检查Nginx状态
netstat -tlnp | grep 3000       # 检查端口
```

### Socket.IO 连接失败？

检查 `.env.local` 中的配置：

```bash
cat .env.local | grep NEXT_PUBLIC_BACKEND_URL
# 应该是：NEXT_PUBLIC_BACKEND_URL=http://47.95.159.189
```

## 📚 详细文档

完整部署文档请查看：`docs/SERVER_DEPLOYMENT.md`

## 🎯 与 FC 部署的区别

| 项目          | FC 部署            | 传统服务器   |
| ------------- | ------------------ | ------------ |
| **超时限制**  | 600 秒（硬性）     | 无限制 ✅    |
| **WebSocket** | 不稳定，需 polling | 完美支持 ✅  |
| **成本**      | 按请求计费         | 固定月费 ✅  |
| **冷启动**    | 有延迟             | 无 ✅        |
| **维护**      | 无需管理           | 需要基础维护 |
| **灵活性**    | 受限               | 完全控制 ✅  |

## 💡 优化建议

### 1. 配置域名（可选）

```bash
# 在域名DNS添加A记录
@ → 47.95.159.189

# 修改Nginx配置中的server_name
server_name your-domain.com;
```

### 2. 配置 SSL（推荐）

```bash
apt install certbot python3-certbot-nginx -y
certbot --nginx -d your-domain.com
```

### 3. 性能监控

```bash
pm2 install pm2-logrotate
pm2 install pm2-server-monit
pm2 monit
```

---

**准备好了吗？** 现在就可以部署到服务器了！🚀

如有问题，请查看详细文档或联系技术支持。
