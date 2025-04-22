import { NextApiRequest, NextApiResponse } from "next";
import { AzureChatOpenAI } from "@langchain/openai";
import { BufferMemory } from "langchain/memory";

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

// Azure OpenAI model setup if needed
const azureModel = new AzureChatOpenAI({
  model: "gpt-4o",
  temperature: 0,
  azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
  azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
  azureOpenAIApiVersion: "2023-03-15-preview", // 使用较旧但更稳定的版本
  azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
  azureOpenAIEndpoint: process.env.AZURE_OPENAI_API_ENDPOINT,
});

// 直接生成代码的函数
async function generateCode(prompt: string, currentCode: string) {
  try {
    // 使用更直接的方式请求代码修改，明确要求完整的、可执行的代码
    const template = `你是一个Three.js代码生成专家。请基于以下当前代码：
\`\`\`js
${currentCode}
\`\`\`

根据用户需求："${prompt}"，生成一个新的、完整的setup函数实现。

你必须给出完整的可执行代码，包括完整的function setup(scene, camera, renderer) {...}函数定义。
代码必须使用THREE库，必须能直接运行，不要添加任何注释或解释。

只返回代码，不要返回任何解释、文档或markdown格式。`;

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
        newCode = responseContent.trim();
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

    // 检查代码是否有变化
    if (newCode === currentCode) {
      console.log("生成的代码与原代码相同");
      return {
        unchanged: true,
        message: "生成的代码与原代码相同",
        code: newCode,
      };
    }

    // 记录完整的新代码
    console.log("生成的新代码:", newCode);

    // 更新后端记忆
    await memory.saveContext({ input: prompt }, { currentCode: newCode });
    console.log("已更新内存中的代码");

    // 直接返回完整代码
    return {
      directCode: newCode,
      message: "已生成新代码",
    };
  } catch (error) {
    console.error("生成Three.js代码时出错:", error);
    throw error;
  }
}

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

      // 调用直接生成代码的函数
      const result = await generateCode(prompt, codeToUse);

      return res.status(200).json(result);
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
