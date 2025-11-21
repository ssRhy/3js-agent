# 阿里云轻量服务器部署指南

## 📋 服务器信息

```
服务器类型：阿里云轻量应用服务器
推荐配置：2核4GB（¥108/月）
操作系统：Ubuntu 22.04 LTS
```

## 🚀 快速部署步骤

### 1️⃣ 连接服务器

```bash
# 使用SSH连接（替换为您的服务器IP）
ssh admin@your-server-ip

# 或使用root用户
ssh root@your-server-ip

# 如果使用admin用户，切换到root
sudo su -
```

### 2️⃣ 安装环境

```bash
# 更新系统
apt update && apt upgrade -y

# 安装Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 验证安装
node -v  # 应该显示 v20.x.x
npm -v

# 安装PM2（进程管理器）
npm install -g pm2

# 安装Git
apt install -y git

# 安装Nginx（反向代理）
apt install -y nginx

# 安装其他有用工具
apt install -y htop nano curl wget
```

### 3️⃣ 克隆项目

```bash
# 创建项目目录
mkdir -p /var/www
cd /var/www

# 克隆项目（替换为您的仓库地址）
git clone https://github.com/YOUR_USERNAME/3js-agent.git

# 进入项目目录
cd 3js-agent/threejs-ai-editor
```

### 4️⃣ 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env.local

# 编辑环境变量
nano .env.local
```

**重要配置项**：

```bash
# OpenAI API密钥（必需）
OPENAI_API_KEY=sk-your-actual-key-here

# 后端地址（必需，替换为您的服务器IP）
NEXT_PUBLIC_BACKEND_URL=http://your-server-ip

# 其他配置
NODE_ENV=production
PORT=3000
```

保存并退出（Ctrl+X, Y, Enter）

### 5️⃣ 安装依赖并构建

```bash
# 安装依赖
npm install

# 构建项目
npm run build
```

### 6️⃣ 启动应用

```bash
# 使用PM2启动
pm2 start npm --name "3js-agent" -- start

# 查看状态
pm2 status

# 查看日志
pm2 logs 3js-agent

# 设置开机自启动
pm2 startup
pm2 save
```

### 7️⃣ 配置 Nginx（推荐）

```bash
# 创建Nginx配置文件
nano /etc/nginx/sites-available/3js-agent
```

**配置内容**：

```nginx
server {
    listen 80;
    server_name your-server-ip;  # 或域名

    # 增加超时时间
    proxy_connect_timeout 600;
    proxy_send_timeout 600;
    proxy_read_timeout 600;
    send_timeout 600;

    # 增加请求体大小限制
    client_max_body_size 50M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;

        # WebSocket/Socket.IO支持
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;

        # 其他头部
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

保存后：

```bash
# 启用配置
ln -s /etc/nginx/sites-available/3js-agent /etc/nginx/sites-enabled/

# 删除默认配置
rm /etc/nginx/sites-enabled/default

# 测试配置
nginx -t

# 重启Nginx
systemctl restart nginx

# 设置开机自启动
systemctl enable nginx
```

### 8️⃣ 配置防火墙

**阿里云控制台配置**：

1. 登录阿里云控制台
2. 找到您的轻量服务器实例
3. 点击"防火墙"标签
4. 添加以下规则：

```
HTTP (80端口)
来源: 0.0.0.0/0
策略: 允许

HTTPS (443端口) - 如果配置SSL
来源: 0.0.0.0/0
策略: 允许
```

## ✅ 验证部署

打开浏览器访问：

```
http://your-server-ip
```

您应该能看到 Three.js AI Editor 界面！

## 📊 日常管理

### PM2 命令

```bash
# 查看应用状态
pm2 status

# 查看实时日志
pm2 logs 3js-agent

# 查看最近100行日志
pm2 logs 3js-agent --lines 100

# 重启应用
pm2 restart 3js-agent

# 停止应用
pm2 stop 3js-agent

# 删除应用
pm2 delete 3js-agent
```

### 更新代码

```bash
cd /var/www/3js-agent/threejs-ai-editor

# 拉取最新代码
git pull

# 安装新依赖（如果有）
npm install

# 重新构建
npm run build

# 重启应用
pm2 restart 3js-agent
```

### Nginx 管理

```bash
# 测试配置
nginx -t

# 重启Nginx
systemctl restart nginx

# 查看Nginx状态
systemctl status nginx

# 查看错误日志
tail -f /var/log/nginx/error.log

# 查看访问日志
tail -f /var/log/nginx/access.log
```

### 查看系统资源

```bash
# 实时资源监控
htop

# 查看磁盘使用
df -h

# 查看内存使用
free -h

# 查看网络连接
netstat -tlnp
```

## 🔧 常见问题排查

### 1. 应用无法访问

```bash
# 检查应用是否运行
pm2 status

# 检查端口是否监听
netstat -tlnp | grep 3000

# 查看应用日志
pm2 logs 3js-agent --lines 50

# 检查Nginx状态
systemctl status nginx

# 检查Nginx配置
nginx -t
```

### 2. Socket.IO 连接失败

检查 `.env.local` 中的配置：

```bash
# 确保设置了正确的后端地址
NEXT_PUBLIC_BACKEND_URL=http://your-server-ip
```

重启应用：

```bash
pm2 restart 3js-agent
```

### 3. 内存不足

```bash
# 查看内存使用
free -h

# 如果内存不足，可以添加swap
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### 4. 构建失败

```bash
# 清理并重新安装
rm -rf node_modules .next
npm install
npm run build
```

## 🎯 性能优化

### 1. 启用 Gzip 压缩

编辑 Nginx 配置：

```nginx
# 在 http 块中添加
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 6;
gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/rss+xml font/truetype font/opentype application/vnd.ms-fontobject image/svg+xml;
```

### 2. 启用 HTTP/2（需要 SSL）

```nginx
listen 443 ssl http2;
```

### 3. 配置静态资源缓存

```nginx
location /_next/static/ {
    alias /var/www/3js-agent/threejs-ai-editor/.next/static/;
    expires 365d;
    access_log off;
}
```

## 🔒 安全建议

### 1. 配置 SSL 证书（HTTPS）

```bash
# 安装Certbot
apt install certbot python3-certbot-nginx -y

# 自动配置SSL（需要域名）
certbot --nginx -d your-domain.com

# 自动续期
certbot renew --dry-run
```

### 2. 配置防火墙

```bash
# 安装ufw
apt install ufw

# 允许必要端口
ufw allow 22/tcp   # SSH
ufw allow 80/tcp   # HTTP
ufw allow 443/tcp  # HTTPS

# 启用防火墙
ufw enable
```

### 3. 定期更新

```bash
# 每周更新系统
apt update && apt upgrade -y

# 更新Node.js包
npm outdated
npm update
```

## 📈 监控和日志

### 1. 启用 PM2 监控

```bash
# 安装PM2监控模块
pm2 install pm2-logrotate
pm2 install pm2-server-monit

# 查看监控
pm2 monit
```

### 2. 配置日志轮转

```bash
# 编辑logrotate配置
nano /etc/logrotate.d/nginx

# 添加配置
/var/log/nginx/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data adm
    sharedscripts
    postrotate
        [ -f /var/run/nginx.pid ] && kill -USR1 `cat /var/run/nginx.pid`
    endscript
}
```

## 🆘 需要帮助？

如果遇到问题：

1. 查看应用日志：`pm2 logs 3js-agent`
2. 查看 Nginx 日志：`tail -f /var/log/nginx/error.log`
3. 查看系统日志：`journalctl -xe`

## 📝 文件清单

部署相关文件：

```
threejs-ai-editor/
├── .env.example          # 环境变量模板
├── .env.local           # 实际环境变量（不提交到Git）
├── next.config.js       # Next.js配置（已优化）
├── package.json         # 依赖配置
└── docs/
    ├── SERVER_DEPLOYMENT.md  # 本文件
    └── FC_TIMEOUT_FIX.md     # FC问题文档（仅供参考）
```

---

**最后更新：** 2025 年 11 月 13 日  
**适用环境：** Ubuntu 22.04 LTS + Node.js 20 LTS  
**维护状态：** 🟢 活跃维护中
