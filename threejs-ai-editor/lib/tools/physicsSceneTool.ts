import { DynamicStructuredTool } from "@langchain/core/tools";
import { AzureChatOpenAI } from "@langchain/openai";
import { z } from "zod";

// Initialize Azure OpenAI client for physics scene generation
const physicsModel = new AzureChatOpenAI({
  model: "gpt-4.1",
  temperature: 0.3, // Balanced temperature for educational content
  azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
  azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
  azureOpenAIApiVersion: "2024-12-01-preview",
  azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
});

/**
 * 物理场景类型枚举
 */
enum PhysicsSceneType {
  GRAVITY = "gravity", // 重力实验
  COLLISION = "collision", // 碰撞实验
  FRICTION = "friction", // 摩擦力实验
  PENDULUM = "pendulum", // 摆锤实验
  SPRING = "spring", // 弹簧实验
  PROJECTILE = "projectile", // 抛物运动
  ENERGY = "energy", // 能量转换
  MOMENTUM = "momentum", // 动量守恒
  FLUID = "fluid", // 流体力学
  CUSTOM = "custom", // 自定义场景
}

/**
 * 物理场景生成工具 - 专门为物理教育设计的场景生成器
 */
export const physicsSceneTool = new DynamicStructuredTool({
  name: "generate_physics_scene",
  description:
    "Generate educational physics scenes with Rapier physics engine. " +
    "Creates complete Three.js + Rapier physics demonstrations for learning physics concepts.",
  schema: z.object({
    sceneType: z
      .nativeEnum(PhysicsSceneType)
      .describe("Type of physics experiment to create"),
    description: z
      .string()
      .describe("Natural language description of the physics scenario"),
    complexity: z
      .enum(["beginner", "intermediate", "advanced"])
      .describe("Educational difficulty level"),
    physicsParams: z
      .object({
        gravity: z
          .array(z.number())
          .optional()
          .describe("Gravity vector [x, y, z], default [0, -9.81, 0]"),
        restitution: z
          .number()
          .min(0)
          .max(2)
          .optional()
          .describe("Bounciness factor, 0-2"),
        friction: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Friction coefficient, 0-1"),
        density: z
          .number()
          .min(0.1)
          .max(10)
          .optional()
          .describe("Object density"),
      })
      .optional()
      .describe("Physics parameters for the simulation"),
    objectCount: z
      .number()
      .min(1)
      .max(20)
      .default(3)
      .describe("Number of objects in the scene"),
    enableControls: z
      .boolean()
      .default(true)
      .describe("Enable interactive controls for physics parameters"),
  }),
  func: async ({
    sceneType,
    description,
    complexity,
    physicsParams,
    objectCount,
    enableControls,
  }) => {
    const requestId = `physics_${Date.now()}`;
    const startTime = Date.now();
    console.log(
      `[${requestId}] [Physics Scene Tool] 🎓 Generating physics education scene: ${sceneType}`
    );
    console.log(
      `[${requestId}] [Physics Scene Tool] Description: "${description}"`
    );
    console.log(
      `[${requestId}] [Physics Scene Tool] Complexity: ${complexity}, Objects: ${objectCount}`
    );

    try {
      // 构建物理场景生成提示词
      const prompt = `作为物理教育专家和Three.js + Rapier物理引擎专家，请生成一个教育性的物理场景。

## 场景要求
- **场景类型**: ${sceneType}
- **描述**: ${description}
- **复杂度**: ${complexity}
- **对象数量**: ${objectCount}
- **物理参数**: ${
        physicsParams ? JSON.stringify(physicsParams, null, 2) : "使用默认值"
      }

## 技术要求
1. 使用Three.js + @react-three/rapier创建完整的物理场景
2. 场景必须包含Rapier物理世界设置
3. 所有物体必须有正确的物理属性（刚体、碰撞器）
4. 使用setup函数格式: function setup(scene, camera, renderer, THREE, OrbitControls, RAPIER) { ... }
5. 包含适当的光照和环境设置
6. 添加地面或边界，防止物体无限下落

## 教育性要求
1. 清晰展示目标物理概念
2. 使用不同颜色和形状区分不同功能的物体
3. 包含说明性的文本标签（使用Three.js Text几何体）
4. 设置合理的初始条件以展示物理现象
${enableControls ? "5. 包含交互控制元素（如按钮、滑块效果）" : ""}

## 物理场景特殊要求

${getSceneSpecificRequirements(sceneType)}

## 代码结构要求
\`\`\`javascript
function setup(scene, camera, renderer, THREE, OrbitControls, RAPIER) {
  // 1. 初始化Rapier物理世界
  const world = new RAPIER.World({ x: 0.0, y: -9.81, z: 0.0 });
  
  // 2. 创建物理对象和Three.js视觉对象
  // 3. 设置碰撞器和刚体
  // 4. 添加教育性标签和说明
  // 5. 设置交互控制（如果启用）
  // 6. 设置动画循环
  
  // 确保在渲染循环中更新物理世界
  const animate = () => {
    world.step();
    // 同步物理和视觉对象位置
    requestAnimationFrame(animate);
  };
  animate();
  
  return scene;
}
\`\`\`

⚠️ 重要提醒：
- 必须包含完整的Rapier物理引擎集成代码
- 确保物理对象和Three.js对象位置同步
- 只返回可执行的JavaScript代码，不要包含任何说明文字
- 不要使用markdown代码块标记`;

      console.log(
        `[${requestId}] [Physics Scene Tool] 🤖 Calling LLM for physics scene generation...`
      );
      const llmStartTime = Date.now();

      const result = await physicsModel.invoke(prompt);

      const llmEndTime = Date.now();
      console.log(
        `[${requestId}] [Physics Scene Tool] ✅ LLM response received, time: ${
          llmEndTime - llmStartTime
        }ms`
      );

      let physicsCode =
        typeof result.content === "string"
          ? result.content
          : JSON.stringify(result.content);

      // 清理代码输出
      if (physicsCode.includes("```")) {
        const codeMatch = physicsCode.match(
          /```(?:js|javascript)?\s*([\s\S]*?)```/
        );
        if (codeMatch && codeMatch[1]) {
          physicsCode = codeMatch[1].trim();
        }
      }

      // 确保代码包含必要的物理引擎导入
      if (!physicsCode.includes("RAPIER")) {
        console.log(
          `[${requestId}] [Physics Scene Tool] ⚠️ Adding missing RAPIER import`
        );
        physicsCode = `// Physics engine import\nimport * as RAPIER from '@dimforge/rapier3d-compat';\n\n${physicsCode}`;
      }

      // 验证setup函数格式
      if (!physicsCode.includes("function setup")) {
        console.log(
          `[${requestId}] [Physics Scene Tool] ⚠️ Wrapping code in setup function`
        );
        physicsCode = `function setup(scene, camera, renderer, THREE, OrbitControls, RAPIER) {
  ${physicsCode}
  return scene;
}`;
      }

      const endTime = Date.now();
      console.log(
        `[${requestId}] [Physics Scene Tool] ✅ Physics scene generation complete, total time: ${
          endTime - startTime
        }ms`
      );

      return physicsCode;
    } catch (error) {
      console.error(
        `[${requestId}] [Physics Scene Tool] 🔴 Error generating physics scene:`,
        error
      );
      throw new Error(`Physics scene generation failed: ${error}`);
    }
  },
});

/**
 * 获取特定场景类型的特殊要求
 */
function getSceneSpecificRequirements(sceneType: PhysicsSceneType): string {
  switch (sceneType) {
    case PhysicsSceneType.GRAVITY:
      return `
- 创建不同质量的物体从不同高度下落
- 展示重力加速度对所有物体的影响相同
- 包含轻重不同但同时落地的演示`;

    case PhysicsSceneType.COLLISION:
      return `
- 设置弹性和非弹性碰撞对比
- 使用不同颜色标识不同弹性系数的物体
- 包含动量守恒的直观展示`;

    case PhysicsSceneType.FRICTION:
      return `
- 创建不同表面摩擦系数的斜面
- 展示摩擦力对物体运动的影响
- 包含静摩擦和动摩擦的对比`;

    case PhysicsSceneType.PENDULUM:
      return `
- 创建单摆或复摆装置
- 展示周期性运动和能量转换
- 包含不同摆长对周期的影响演示`;

    case PhysicsSceneType.SPRING:
      return `
- 创建弹簧振子系统
- 展示胡克定律和简谐振动
- 包含弹性势能和动能的相互转换`;

    case PhysicsSceneType.PROJECTILE:
      return `
- 创建抛物运动轨迹演示
- 展示水平和竖直方向的运动分量
- 包含不同发射角度的轨迹对比`;

    case PhysicsSceneType.ENERGY:
      return `
- 展示机械能守恒定律
- 包含势能转动能的过程
- 添加能量条或数值显示`;

    case PhysicsSceneType.MOMENTUM:
      return `
- 创建碰撞前后动量守恒演示
- 使用不同质量和速度的物体
- 包含完全弹性和完全非弹性碰撞`;

    case PhysicsSceneType.FLUID:
      return `
- 模拟流体阻力效果
- 展示浮力原理
- 包含不同密度物体在流体中的行为`;

    default:
      return `
- 根据描述创建相应的物理场景
- 确保物理概念清晰可见
- 包含适当的教育元素`;
  }
}
