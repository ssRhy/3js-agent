import { NextApiRequest, NextApiResponse } from "next";
import { AzureChatOpenAI } from "@langchain/openai";
import { BufferMemory } from "langchain/memory";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

// 初始脚本模板
const initialCode = `function setup(scene, camera, renderer) {
  // 初始示例：一个简单的立方体
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshBasicMaterial({ color: 0x44aa88 });
  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);
}`;

// 后端内存：存储 currentCode，仅在内存中持久化
const memory = new BufferMemory({
  memoryKey: "currentCode",
  inputKey: "input",
  returnMessages: false,
});

// Azure OpenAI model setup
const azureModel = new AzureChatOpenAI({
  model: "gpt-4o",
  temperature: 0,
  azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
  azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
  azureOpenAIApiVersion: "2023-03-15-preview", // 使用较旧但更稳定的版本
  azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
  azureOpenAIEndpoint: process.env.AZURE_OPENAI_API_ENDPOINT,
});

// 创建自然语言解析工具
const parseLanguageTool = new DynamicStructuredTool({
  name: "parseLanguage",
  description:
    "解析用户的自然语言指令，提取关键意图和要求。这是第一步，用于理解用户的需求。",
  schema: z.object({
    userInput: z.string().describe("用户的原始自然语言输入"),
  }),
  func: async ({ userInput }) => {
    console.log("调用parseLanguage工具，输入:", userInput);

    const template = `你是一个专业的Three.js需求分析专家。请对以下用户输入进行详细分析，提取出所有Three.js相关的开发需求并组织成结构化格式。

用户输入: "${userInput}"

请按照以下结构输出需求分析:

1. 主要场景元素：
   - 列出用户希望创建的所有主要3D对象
   - 描述每个对象的关键特征（形状、颜色、材质、尺寸等）
   - 详细说明对象之间的相对位置和关系

2. 视觉效果需求：
   - 光照要求（环境光、点光源、平行光等）
   - 材质需求（基础材质、PBR材质、自定义着色器等）
   - 颜色方案和纹理要求
   - 阴影和反射效果需求

3. 动画和交互要求：
   - 任何需要的动画效果（旋转、移动、缩放等）
   - 用户交互需求（如鼠标交互、点击响应等）
   - 时间和变化相关的要求

4. 技术约束和性能考虑：
   - 任何特定的技术要求或限制
   - 性能优化相关的考虑

请确保分析全面且详细，这将直接用于生成高质量的Three.js代码。`;

    const result = await azureModel.invoke(template);
    const parsedIntent =
      typeof result.content === "string" ? result.content.trim() : "";

    console.log("解析后的意图:", parsedIntent);

    // 确保输出格式一致，便于下一个工具使用
    return parsedIntent;
  },
});

// 创建代码生成工具
const generateCodeTool = new DynamicStructuredTool({
  name: "generateCode",
  description:
    "基于解析后的用户需求和当前代码生成新的Three.js代码。这是第二步，在parseLanguage之后调用。",
  schema: z.object({
    parsedIntent: z
      .string()
      .describe("从parseLanguage工具获取的解析后的用户意图"),
    currentCode: z.string().optional().describe("当前的Three.js代码"),
  }),
  func: async ({ parsedIntent, currentCode }) => {
    console.log("调用generateCode工具，输入:", {
      parsedIntent,
      codeLength: currentCode?.length,
    });

    // 获取当前代码，可能来自工具调用参数或上下文
    let codeToUse = currentCode;
    if (!codeToUse) {
      // 如果参数中没有代码，使用内存或初始代码
      const memoryVars = await memory.loadMemoryVariables({});
      codeToUse = memoryVars.currentCode || initialCode;
    }

    // 使用更直接的方式请求代码修改，明确要求完整的、可执行的代码
    const template = `你是一个Three.js高级可视化专家，擅长创建美观、精细的3D场景。请基于以下当前代码：
\`\`\`js
${codeToUse}
\`\`\`

根据以下详细需求：
"${parsedIntent}"

请对当前代码进行增量修改，而不是完全重写。具体要求：

1. 分析并理解当前代码中已有的元素和功能
2. 保留用户代码中有价值的部分，特别是自定义逻辑和复杂设置
3. 只修改或添加需要实现新需求的代码部分
4. 确保修改后的代码与原有代码风格一致
5. 使用THREE.js的高级特性，如适当的材质（MeshStandardMaterial、MeshPhongMaterial等）
6. 添加适当的光照效果（环境光、方向光、点光源等）
7. 不要使用本地jpg和gltf文件
8. 可以采用CDN库
9. 优化性能
10.可以适当添加一些场景和背景

对于增量修改，请遵循以下原则：
- 如果需求只是添加新对象，保留现有对象并添加新的
- 如果需求是修改现有对象，找到相关代码并修改其属性
- 如果需求是替换场景，可以替换大部分代码，但保留有用的辅助函数和特殊逻辑

返回完整的function setup(scene, camera, renderer) {...}函数定义，确保代码可直接运行。不要返回任何解释、文档或markdown格式。`;

    const result = await azureModel.invoke(template);
    const responseContent = result.content;

    // 提取代码
    let newCode = "";
    if (typeof responseContent === "string") {
      // 尝试提取代码块
      const codeMatch = responseContent.match(
        /```(?:js|javascript)?\s*([\s\S]*?)```/
      );
      if (codeMatch && codeMatch[1]) {
        newCode = codeMatch[1].trim();
      } else if (responseContent.includes("function setup")) {
        // 如果没有代码块标记但包含函数定义
        const setupMatch = responseContent.match(
          /function\s+setup\s*\(\s*(?:scene\s*,\s*camera\s*,\s*renderer|[^)]*)\s*\)\s*\{[\s\S]*?\}/
        );
        if (setupMatch && setupMatch[0]) {
          newCode = setupMatch[0].trim();
        } else {
          // 如果无法提取完整函数，使用完整响应
          newCode = responseContent.trim();
        }
      } else {
        // 基本文本清理
        newCode = responseContent.trim();
        // 确保代码是setup函数定义
        if (!newCode.startsWith("function setup")) {
          newCode = `function setup(scene, camera, renderer) {
${newCode}
}`;
        }
      }
    }

    // 检查提取的代码是否有效
    if (!newCode.includes("function setup")) {
      console.log("提取的代码不包含setup函数，尝试修复...");
      newCode = `function setup(scene, camera, renderer) {
${newCode}
}`;
    }

    // 检查代码是否有变化
    if (newCode === codeToUse) {
      console.log("生成的代码与原代码相同");
      return JSON.stringify({
        unchanged: true,
        message: "生成的代码与原代码相同",
        code: newCode,
      });
    }

    // 计算代码变更百分比，判断是否是增量修改
    const calculateChangePct = (oldCode: string, newCode: string): number => {
      // 简化计算：使用最长公共子序列的长度来估算保留的代码比例
      // 这是一个非常简化的实现，实际上可以使用diff算法来更精确地计算
      let commonChars = 0;
      const minLength = Math.min(oldCode.length, newCode.length);
      for (let i = 0; i < minLength; i++) {
        if (oldCode[i] === newCode[i]) {
          commonChars++;
        }
      }
      return Math.round((commonChars / oldCode.length) * 100);
    };

    const retentionPct = calculateChangePct(codeToUse || initialCode, newCode);
    const isIncremental = retentionPct > 30; // 如果保留了超过30%的代码，认为是增量修改

    console.log(
      `代码保留率: ${retentionPct}%, ${isIncremental ? "是" : "不是"}增量修改`
    );

    // 记录完整的新代码
    console.log("生成的新代码:", newCode);

    // 更新后端记忆
    await memory.saveContext({ input: parsedIntent }, { currentCode: newCode });
    console.log("已更新内存中的代码");

    // 返回结果，确保格式与之前一致
    return JSON.stringify({
      directCode: newCode,
      message: "已生成新代码",
      isIncremental,
      retentionPct,
    });
  },
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "POST") {
    const { prompt, currentCode } = req.body;
    if (!prompt) return res.status(400).json({ error: "No prompt provided" });

    try {
      console.log("处理前端请求:", { prompt, hasCurrentCode: !!currentCode });

      // 检查环境变量是否正确配置
      if (
        !process.env.AZURE_OPENAI_API_KEY ||
        !process.env.AZURE_OPENAI_API_ENDPOINT
      ) {
        console.error("Azure OpenAI API 环境变量未配置");
        return res.status(500).json({ error: "Azure OpenAI API 配置缺失" });
      }

      // 获取当前代码，优先使用请求中提供的代码
      let codeToUse = currentCode;
      if (!codeToUse) {
        // 如果请求中没有代码，尝试从内存中获取
        const memoryVars = await memory.loadMemoryVariables({});
        codeToUse = memoryVars.currentCode || initialCode;
      } else {
        // 如果请求中有代码，更新内存
        await memory.saveContext({ input: prompt }, { currentCode: codeToUse });
        console.log("已更新内存中的代码");
      }

      // 简化处理流程，直接按顺序调用工具，不使用复杂的Agent
      console.log("直接顺序调用工具进行处理...");

      try {
        // 首先解析用户指令
        console.log("步骤1: 调用parseLanguage工具...");
        const parsedIntent = await parseLanguageTool.invoke({
          userInput: prompt,
        });
        console.log("解析后的意图:", parsedIntent);

        // 然后生成代码
        console.log("步骤2: 调用generateCode工具...");
        const generatedCodeResult = await generateCodeTool.invoke({
          parsedIntent,
          currentCode: codeToUse,
        });
        console.log("生成代码工具返回:", typeof generatedCodeResult);

        // 解析JSON结果
        let resultObj;
        try {
          resultObj =
            typeof generatedCodeResult === "string"
              ? JSON.parse(generatedCodeResult)
              : generatedCodeResult;

          console.log("解析后的生成结果:", Object.keys(resultObj).join(", "));
        } catch (parseError) {
          console.error("解析生成结果失败:", parseError);
          resultObj = {
            directCode: String(generatedCodeResult),
            message: "生成了新代码，但无法解析为JSON",
          };
        }

        // 直接返回结果
        return res.status(200).json(resultObj);
      } catch (toolError) {
        console.error("工具调用失败:", toolError);
        return res.status(500).json({
          error: "工具调用失败",
          message:
            toolError instanceof Error ? toolError.message : String(toolError),
        });
      }
    } catch (error) {
      console.error("处理请求时出错:", error);
      res.status(500).json({
        error: "处理请求失败",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    res.status(405).end();
  }
}
