# 3js-Agentic - Three.js AI 编辑器

## 📋 项目概览

3js-agent 是一个创新的 3D 场景编辑器，融合了 **Three.js 3D 图形库**和 **LangChain AI 代理**技术。该项目实现了 AI 自主规划执行路径，使用多个工具完成复杂的 3D 场景创建和编辑任务，而不是通过外部代码硬编码执行流程，真正实现了 **Agentic Workflow**。

### 🎯 核心特性

- **🤖 AI 代理驱动**: 基于 LangChain 0.3 Agent API 的智能 3D 场景生成
- **🎨 实时 3D 编辑**: Monaco Editor 代码编辑 + Three.js 实时预览
- **📡 WebSocket 通信**: Socket.IO 实现前后端实时数据同步
- **🔍 向量存储**: ChromaDB 集成，支持 3D 对象的语义检索
- **📱 响应式设计**: 科幻风格 UI，移动端友好
- **⚡ 性能优化**: React Server Components + 动态导入
- **🔄 版本管理**: 完整的编辑历史和版本回退功能

## 🏗️ 技术架构

### 前端技术栈

Next.js 14.1.0 (Pages Router)
├── React 18 + TypeScript
├── Three.js + @react-three/fiber + @react-three/drei
├── Monaco Editor (@monaco-editor/react)
├── Socket.IO Client (实时通信)
├── Zustand (状态管理)
├── Framer Motion (动画效果)
└── 高级科幻风格 UI 设计

### 后端技术栈

Next.js API Routes
├── LangChain.js 0.3 (AI Agent 核心)
├── OpenAI GPT-4 集成
├── ChromaDB (向量数据库)
├── Socket.IO Server (WebSocket)
├── Three.js 服务端处理
└── TypeScript 类型安全

### AI Agentic 工作流

用户输入 → LangChain Agent → 智能决策，工具调用
├── 代码生成工具 (Code Generator)
├── 3D 模型加载工具 (Model Loader)
├── 场景分析工具 (Scene Analyzer)
├── 错误修复工具 (Error Fixer)
└── 截图生成工具 (Screenshot Tool)

## 📁 项目结构

3js-agent/
├── threejs-ai-editor/ # 主应用目录
│ ├── components/ # React 组件
│ │ ├── ThreeCodeEditor.tsx # 核心编辑器组件
│ │ ├── EnhancedChatInterface.tsx # AI 聊天界面
│ │ ├── AgentProgressDialog.tsx # Agent 进度显示
│ │ ├── ObjectManipulationControls.tsx # 3D 对象控制
│ │ ├── UnifiedExportTools.tsx # 导出工具
│ │ ├── ui/ # UI 组件库
│ │ ├── preview/ # 3D 预览组件
│ │ └── editor/ # 编辑器组件
│ ├── pages/ # Next.js 页面
│ │ ├── api/ # API 路由
│ │ │ ├── agentHandler.ts # AI Agent 处理器
│ │ │ ├── socket.ts # WebSocket 服务器
│ │ │ ├── proxy-model.ts # 模型代理
│ │ │ └── ... # 其他 API 端点
│ │ ├── index.js # 主页面
│ │ └── editor.js # 编辑器页面
│ ├── hooks/ # 自定义 React Hooks
│ ├── stores/ # Zustand 状态管理
│ ├── lib/ # 工具库和配置
│ ├── styles/ # 样式文件
│ └── config/ # 配置文件
├── package.json # 根项目配置
└── README.md # 项目文档

## 🔧 核心功能详解

### 1. AI 代理系统

基于 LangChain 0.3 的智能代理，支持：

- **自主规划**: AI 自动分解复杂任务为执行步骤
- **工具调用**: 动态选择和组合多种工具
- **上下文记忆**: 维护对话和场景上下文
- **错误恢复**: 自动检测和修复代码错误

### 2. 实时协作

通过 Socket.IO 实现：

- **实时代码同步**: 多用户协作编辑
- **Agent 状态广播**: 实时显示 AI 工作进度
- **场景状态同步**: 3D 场景变化实时共享

### 3. 3D 场景管理

完整的 3D 场景操作：

- **代码驱动**: Monaco Editor 编写 Three.js 代码
- **实时预览**: 代码变化立即在 3D 场景中体现
- **对象操作**: 拖拽、缩放、旋转 3D 对象
- **模型加载**: 支持 GLTF/GLB 模型导入

### 4. 向量存储集成

ChromaDB 提供：

- **语义检索**: 基于描述查找 3D 对象
- **上下文存储**: 保存场景和代码片段
- **智能推荐**: 基于历史数据的内容建议

## 🎨 设计理念

### 高级科幻风格 UI

- **极简主义**: 黑白灰主色调，几何化设计
- **无装饰**: 严格禁止 emoji，使用纯文本标签
- **专业感**: 参考 Cursor AI IDE 的设计语言
- **科技感**: 微妙的动画和状态反馈

### 代码规范

- **函数式编程**: 避免类，优先使用函数组件
- **TypeScript**: 全面的类型安全
- **模块化**: 高内聚低耦合的组件设计
- **性能优先**: React Server Components + 动态导入

## 📈 项目进展

### 已完成功能 ✅

- [x] 基础 3D 编辑器框架
- [x] AI 代理集成（LangChain 0.3）
- [x] 实时 WebSocket 通信
- [x] ChromaDB 向量存储
- [x] 代码编辑器（Monaco）
- [x] 3D 场景预览
- [x] 版本历史管理
- [x] Agent 进度可视化
- [x] 科幻风格 UI 设计

### 开发中功能 🚧

- [ ] 多用户协作模式
- [ ] 更多 AI 工具集成
- [ ] 高级 3D 渲染效果
- [ ] 移动端优化

### 计划功能 📋

- [ ] VR/AR 支持
- [ ] 云端场景存储
- [ ] 插件系统
- [ ] 社区分享平台

## 🤝 贡献指南

欢迎为项目贡献代码！请遵循以下步骤：

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 开启 Pull Request

### 开发规范

- 遵循 TypeScript 严格模式
- 使用 ESLint 代码检查
- 编写清晰的提交信息
- 保持代码简洁高效

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源协议。

## 👨‍💻 作者

**韩蕴** - _项目创建者和主要维护者_

## 🙏 致谢

- [Three.js](https://threejs.org/) - 强大的 3D 图形库
- [LangChain](https://js.langchain.com/) - AI 代理框架
- [Next.js](https://nextjs.org/) - React 全栈框架
- [ChromaDB](https://www.trychroma.com/) - 向量数据库
- [OpenAI](https://openai.com/) - AI 模型支持

---

**注**: 更多详细信息请查看 [`threejs-ai-editor/pro.md`](threejs-ai-editor/pro.md) 项目进展文档。
