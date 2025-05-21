# Three.js AI Editor 优化记录

## 数据传输优化 - 解决 3D 模型数据传输问题

### 问题描述

当前端存在 3D 模型的时候会传输大量数据给后端，导致系统负担过重甚至崩溃。问题根源是传递了整个模型的完整几何数据，而不仅仅是 URL 引用。

### 解决方案

修改前端序列化场景状态的逻辑，只包含必要的元数据：

- 模型 URL
- 位置/旋转/缩放信息
- 基本属性(名称、ID 等)

### 实现方法

前端序列化模型对象时应该这样处理:

```javascript
// 前端序列化模型时应该这样处理
function serializeSceneObject(object) {
  return {
    id: object.id,
    name: object.name,
    type: object.type,
    position: [object.position.x, object.position.y, object.position.z],
    rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
    scale: [object.scale.x, object.scale.y, object.scale.z],
    url: object.userData?.modelUrl || null,
    // 不包含几何数据和材质数据
  };
}
```

在与 agent 通信前，检查并清理数据:

```javascript
// 添加到agentExecutor.ts中，在处理sceneState之前
function sanitizeSceneState(sceneState) {
  if (!sceneState) return [];

  return sceneState.map((obj) => {
    // 确保不包含几何数据
    const { geometry, vertices, faces, ...cleanObject } = obj;
    return cleanObject;
  });
}
```

这些修改将大大减少数据传输量，只保留必要的引用和元数据，避免传输完整的模型几何数据。

## Agent 工作流优化

### 问题描述

Agent 工作流程中存在多个问题：

1. `modelGenTool.ts` 中输出大量调试数据到控制台，包括完整的模型数据
2. Agent 不等待模型生成完成就继续执行后续步骤
3. 缓存机制对 `generate_3d_model` 工具失效

### 解决方案

1. 修改 `modelGenTool.ts` 减少日志输出，避免打印完整的模型数据
2. 确保 `modelGenTool` 返回值中添加清晰的完成标志
3. 明确排除 `generate_3d_model` 工具不使用缓存

### 实现方法

1. 修改 `modelGenTool.ts` 中日志输出:

   - 添加前缀"ModelGenTool:"以便于识别
   - 移除大型数据结构的日志输出
   - 使用简短摘要替代完整数据

2. 修改 `agentExecutor.ts` 中的缓存处理:

```javascript
// 创建缓存包装的工具集
const cachedTools = tools.map((tool) => {
  // 对于generate_3d_model工具，不应用缓存，直接使用原始调用
  if (tool.name === "generate_3d_model") {
    console.log(
      `[${requestId}] Using ORIGINAL implementation for ${tool.name} - bypassing cache system completely`
    );
    return tool; // 直接返回原始工具，不做包装
  }

  // 其他工具正常应用缓存
  // ...
});
```

通过这些优化，大大减少了数据传输量和内存占用，提高了系统稳定性。
