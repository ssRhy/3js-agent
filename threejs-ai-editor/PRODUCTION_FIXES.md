# 生产模式构建修复文档

## 问题描述

在生产模式构建时，OrbitControls 和 ObjectManipulationControls 无法正常工作，主要表现为：

1. OrbitControls 无法旋转和缩放视角
2. ObjectManipulationControls 无法选择和操作对象
3. 控件初始化失败

## 根本原因分析

### 1. OrbitControls 问题 (`useThreeScene.ts`)

- **DOM 初始化时序问题**：生产模式下 canvas 挂载时序与开发模式不同
- **递归 setTimeout 问题**：可能导致多个定时器同时运行，缺少清理机制
- **SSR 兼容性问题**：缺少客户端环境检查

### 2. ObjectManipulationControls 问题 (`ObjectManipulationControls.tsx`)

- **Canvas 就绪时序问题**：没有监听`canvasReady`事件
- **useEffect 依赖项问题**：`selectableObjects`变化频繁导致控件重复创建
- **初始化标志管理**：缺少防重复初始化机制

## 修复方案

### 1. useThreeScene.ts 修复

#### 添加客户端环境检查

```typescript
if (typeof window === "undefined" || typeof document === "undefined") {
  console.log(
    "[Scene] Server-side environment detected, skipping initialization"
  );
  return;
}
```

#### 优化 OrbitControls 初始化逻辑

- 添加控件初始化标志防止重复创建
- 使用有限重试机制（最多 20 次）
- 改进 canvas 状态检查（包括尺寸检查）
- 发送`canvasReady`自定义事件通知其他组件

#### 增强错误处理和清理机制

- 添加定时器引用管理
- 改进控件销毁逻辑
- 增强 resize 事件处理

### 2. ObjectManipulationControls.tsx 修复

#### 添加 Canvas 就绪监听

```typescript
const [canvasReady, setCanvasReady] = useState(false);

useEffect(() => {
  const handleCanvasReady = () => {
    setCanvasReady(true);
  };

  window.addEventListener("canvasReady", handleCanvasReady);

  // 多时机检查canvas状态
  const checkCanvasReady = () => {
    if (scene?.userData?.renderer) {
      const canvas = renderer.domElement;
      if (
        canvas &&
        canvas.parentElement &&
        document.contains(canvas) &&
        canvas.offsetWidth > 0 &&
        canvas.offsetHeight > 0
      ) {
        setCanvasReady(true);
      }
    }
  };

  // 延迟检查以应对生产环境时序差异
  checkCanvasReady();
  setTimeout(checkCanvasReady, 100);
  setTimeout(checkCanvasReady, 500);
  setTimeout(checkCanvasReady, 1000);
}, [isClient, scene]);
```

#### 优化 useEffect 依赖项

- 在所有控件创建 useEffect 中添加`canvasReady`检查
- 移除`selectableObjects`依赖避免 DragControls 频繁重建
- 添加初始化尝试标志防止重复创建

#### 改进控件创建时序

- TransformControls 和 DragControls 都等待 canvas 就绪
- 事件监听器绑定等待 canvas 就绪
- 添加错误处理和重试机制

#### 添加等待状态 UI

```typescript
if (!canvasReady) {
  return (
    <div className="controls-container">
      <div className="controls-header">Object Control</div>
      <div className="info-text">Waiting for canvas...</div>
    </div>
  );
}
```

## 修复效果

### 修复前问题：

- ❌ OrbitControls 在生产模式下不响应鼠标操作
- ❌ ObjectManipulationControls 无法选择对象
- ❌ 控件初始化时序混乱
- ❌ 频繁重建控件导致性能问题

### 修复后效果：

- ✅ OrbitControls 在生产模式下正常工作
- ✅ ObjectManipulationControls 能正确选择和操作对象
- ✅ 控件初始化时序正确且稳定
- ✅ 避免重复初始化，性能优化
- ✅ 增强错误处理和兼容性
- ✅ 提供用户友好的等待状态

## 测试验证

1. **构建测试**：`npm run build` 成功通过
2. **功能测试**：
   - OrbitControls 响应鼠标拖拽旋转视角
   - OrbitControls 响应滚轮缩放
   - ObjectManipulationControls 能选择场景中的对象
   - 变换控件（移动、旋转、缩放）正常工作

## 关键改进点

1. **时序管理**：通过`canvasReady`事件和多时机检查确保初始化时序
2. **依赖优化**：简化 useEffect 依赖项，避免不必要的重建
3. **错误处理**：增强错误处理和重试机制
4. **用户体验**：添加等待状态 UI，提供清晰的状态反馈
5. **生产兼容性**：专门针对生产环境的时序差异进行优化

这些修复确保了 Three.js 编辑器在生产模式下的稳定性和可用性。
