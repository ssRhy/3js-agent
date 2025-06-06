# Three.js AI Editor 项目修复记录

## 模板变量问题修复 (2024-12-19)

### 问题描述

```
[chain/error] Missing value for input variable `...`
Error: Missing value for input variable `...`
```

### 问题根因

在使用 LangChain.js 0.3 的 `createOpenAIFunctionsAgent` 时，`ChatPromptTemplate` 中定义了变量占位符（如 `{userPrompt}`, `{currentCode}` 等），但在 agent 执行时没有正确提供这些变量的值。

### 核心问题

1. **变量名不匹配**: 模板中使用 `{userPrompt}` 但输入对象中使用 `input`
2. **变量映射缺失**: agent 执行器没有正确映射所有模板变量
3. **依赖项不完整**: React Hook 依赖项缺失导致闭包捕获过期值

### 修复方案

#### 1. 简化模板变量 (humanPrompts.ts)

```typescript
// 修复前：使用动态内容生成
const template = `{userPrompt}` + dynamicContent + `{currentCode}`;

// 修复后：使用标准化变量名
const template = `{input}

Available model resources:
{modelHistory}

Current scene objects:
{sceneStateInfo}

Current code:
\`\`\`javascript
{currentCode}
\`\`\``;
```

#### 2. 确保变量映射完整 (agentExecutor.ts)

```typescript
// 确保所有模板变量都有对应值
const inputForAgent = {
  input: userPrompt, // 对应 {input}
  currentCode: currentCode || "// No current code", // 对应 {currentCode}
  historyContext: enhancedHistoryContext || "", // 对应 {historyContext}
  modelHistory: formatModelHistory(modelHistory), // 对应 {modelHistory}
  sceneStateInfo: formatSceneState(combinedSceneState), // 对应 {sceneStateInfo}
  // ... 其他变量
};
```

#### 3. 参考成功案例 (chatbotAgent.ts)

成功的实现使用 `RunnableSequence.from()` 明确定义变量映射：

```typescript
const chain = RunnableSequence.from([
  {
    input: (input: { input: string }) => input.input,
    currentCode: () => chatbotContext.currentCode || "// 暂无代码",
    // ... 明确的变量映射
  },
  prompt,
  chatModel,
]);
```

### 最佳实践

#### ✅ 正确做法

1. **模板变量命名统一**: 使用 `{input}` 作为主要用户输入
2. **完整变量映射**: 确保每个模板变量都有对应的值
3. **类型安全**: 为 map 函数添加类型注解避免 TypeScript 错误
4. **依赖项完整**: useEffect 依赖数组包含所有引用的变量

#### ❌ 避免的错误

1. **变量名不匹配**: 模板用 `{userPrompt}` 但输入用 `input`
2. **缺少变量值**: 调用时不提供某些必需变量
3. **动态内容混合**: 在模板创建时混合动态和静态内容
4. **依赖项缺失**: React Hook 捕获过期闭包值

### 验证方法

```bash
cd threejs-ai-editor
npm run dev
# 测试 agent 执行是否正常，无模板变量错误
```

### 修复验证 ✅

**测试结果**: 所有模板变量正确映射，无 "Missing value for input variable" 错误

**测试输出示例**:

````
🧪 测试模板变量映射...
✅ 模板创建成功
✅ 模板格式化成功

📋 格式化后的消息内容:
创建一个红色立方体

Available model resources:
1. Model1: https://example.com/model1.glb
2. Model2: https://example.com/model2.glb

Current scene objects (use THESE EXACT positions):
1. Cube (Mesh) @ [0,0,0]
2. Light (DirectionalLight) @ [10,10,10]

History context: Previous context about scene state

Current code:
```javascript
// Test code
const scene = new THREE.Scene();
````

🎉 所有模板变量测试通过!

```

### 技术要点

- **LangChain.js 0.3**: 使用 `createOpenAIFunctionsAgent` 的标准模式
- **React Hook**: 完整的依赖项数组避免闭包问题
- **TypeScript**: 明确的类型注解避免隐式 any 错误
- **变量映射**: 统一的命名规范确保模板和输入匹配

## ChatPromptTemplate MessagesPlaceholder 修复 (2024-12-19 最新)

### 问题描述

在使用 `RunnableWithMessageHistory` 时遇到错误：
```

Missing value for input variable `...`

````

### 问题根因

在 `agentFactory.ts` 中，`ChatPromptTemplate` 只包含了 `agent_scratchpad` 占位符，但使用 `RunnableWithMessageHistory` 时设置了 `historyMessagesKey: "chat_history"`，系统期望模板中有 `chat_history` 占位符。

### 修复方案

在 `agentFactory.ts` 第144行附近添加缺失的 `chat_history` 占位符：

```typescript
// 修复前
const promptTemplate = ChatPromptTemplate.fromMessages([
  systemMessage,
  humanPromptTemplate,
  new MessagesPlaceholder("agent_scratchpad"),
]);

// 修复后
const promptTemplate = ChatPromptTemplate.fromMessages([
  systemMessage,
  new MessagesPlaceholder("chat_history"),  // 添加这行
  humanPromptTemplate,
  new MessagesPlaceholder("agent_scratchpad"),
]);
````

### 技术要点

- **LangChain.js 0.3**: `RunnableWithMessageHistory` 要求模板中包含对应的 MessagesPlaceholder
- **聊天历史**: `chat_history` 占位符允许保持多轮对话的上下文
- **标准模式**: 按照 [system, chat_history, human, agent_scratchpad] 的标准顺序

### 验证方法

```bash
cd threejs-ai-editor
npm run dev
# 测试 agent 执行，应该不再出现 Missing value 错误
```

### 修复状态 ✅

✅ **已修复**: ChatPromptTemplate 现在包含所有必需的 MessagesPlaceholder
✅ **验证通过**: agent 可以正常执行，支持聊天历史

### 下一步优化

1. 实现更健壮的错误处理
2. 添加变量验证机制
3. 优化 agent 性能和响应时间
4. 完善 ChromaDB 集成

```

```
