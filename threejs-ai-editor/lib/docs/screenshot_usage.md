# 截图分析工具使用说明

## 概述

`screenshotTool` 是一个用于分析 Three.js 场景截图的工具，它可以：

- 比较当前场景与用户需求的差异
- 提供改进建议
- 判断场景是否符合用户需求

## 工作流程

1. 前端通过 API 端点发送场景截图(Base64)和用户需求
2. API 直接调用 `screenshotTool` 工具
3. 工具分析截图并返回结果
4. API 将结果返回给前端
5. 前端根据分析结果决定后续操作（是否需要修改代码等）

## 使用方式

### API 调用

```typescript
// 前端调用示例
const response = await fetch("/api/screenshot", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    screenshotBase64: "data:image/png;base64,...", // 场景截图
    userPrompt: "创建一个红色的立方体", // 用户需求
  }),
});

const result = await response.json();
// result包含分析结果、是否符合需求等信息
```

### Agent 工具调用

```typescript
// Agent内部调用
const result = await this.tools.analyze_screenshot.invoke({
  screenshotBase64: screenshotBase64,
  userRequirement: userPrompt,
});

const analysisResult = JSON.parse(result);
```

## 返回数据格式

```json
{
  "status": "success",
  "analysis": "详细的分析文本...",
  "matches_requirements": true|false,
  "needs_improvements": true|false,
  "recommendation": "场景完全符合要求，无需修改" | "场景需要调整，请参考分析建议"
}
```

## 注意事项

1. 截图工具专注于视觉分析，不涉及代码生成
2. 当 Agent 需要分析场景时，可以直接调用该工具，无需创建专门的分析 Agent
3. 使用时请确保截图和用户需求的内容准确、完整
