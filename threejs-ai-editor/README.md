# Three.js AI Editor

一个基于 AI 的 Three.js 代码编辑器，支持实时渲染和增量修改。

## 功能特点

- 基于 Monaco 编辑器进行代码编辑
- 实时 Three.js 场景渲染
- LangChain + Azure OpenAI 支持的智能代码生成
- 增量式代码更新（生成 diff 而非全新代码）
- 保持场景状态，支持多轮编辑

## 核心流程

1. 用户在前端输入指令（如"添加旋转动画"）
2. 后端 LangChain Agent 基于现有代码和用户意图生成增量代码变更（diff）
3. 前端应用增量变更到现有代码
4. 新代码立即执行并更新 Three.js 场景
5. 历史代码保存在后端内存中，用于下一轮编辑

## 技术栈

- **前端**：Next.js、Monaco 编辑器、Three.js、Zustand（状态管理）
- **后端**：Next.js API Routes、LangChain.js、Azure OpenAI
- **工具**：diff-match-patch（处理代码差异）

## 项目架构

```
threejs-ai-editor/
├── components/
│   └── ThreeCodeEditor.tsx - 主编辑器组件
├── pages/
│   ├── index.tsx - 主页面
│   └── api/
│       └── agent.ts - LangChain Agent 接口
├── stores/
│   └── useSceneStore.ts - Zustand 状态管理
└── utils/
    ├── applyDiff.ts - 应用代码差异
    └── parseSceneObjects.ts - 解析场景对象
```

## 运行项目

1. 安装依赖

```bash
npm install
```

2. 启动开发服务器

```bash
npm run dev
```

3. 访问 http://localhost:3000

## 使用方法

1. 在文本框中输入自然语言指令（如"添加一个红色的立方体"）
2. 点击"生成增量修改"按钮
3. AI 将生成代码差异并应用到编辑器
4. Three.js 场景会立即更新

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/pages/api-reference/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `pages/index.tsx`. The page auto-updates as you edit the file.

[API routes](https://nextjs.org/docs/pages/building-your-application/routing/api-routes) can be accessed on [http://localhost:3000/api/hello](http://localhost:3000/api/hello). This endpoint can be edited in `pages/api/hello.ts`.

The `pages/api` directory is mapped to `/api/*`. Files in this directory are treated as [API routes](https://nextjs.org/docs/pages/building-your-application/routing/api-routes) instead of React pages.

This project uses [`next/font`](https://nextjs.org/docs/pages/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn-pages-router) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/pages/building-your-application/deploying) for more details.
