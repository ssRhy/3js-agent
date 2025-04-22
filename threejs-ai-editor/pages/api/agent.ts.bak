import { NextApiRequest, NextApiResponse } from "next";
import { AzureChatOpenAI } from "@langchain/openai";
import { BufferMemory } from "langchain/memory";
import { createReactAgent, AgentExecutor } from "langchain/agents";
import { DynamicTool } from "@langchain/core/tools";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";

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

// 创建解析用户输入的工具
interface ParsedUserIntent {
  intention: string;
  threeJsFeatures: string[];
  technicalDescription: string;
  complexity: "simple" | "moderate" | "complex";
}

// 创建解析用户意图的工具
const parseUserIntentTool = new DynamicTool({
  name: "parse_user_intent",
  description: "解析用户的意图并提供对Three.js实现的详细技术描述",
  func: async (input: string) => {
    try {
      // 创建解析器来处理结构化数据
      const parser = new JsonOutputParser<ParsedUserIntent>();

      // 创建提示模板
      const promptTemplate = ChatPromptTemplate.fromTemplate(
        `你是一个Three.js专家，请分析用户的需求拆分描述，描述生成物体的详细形状，并返回一个JSON对象，包含以下字段:
        用户需求: "{input}"
        
        请返回一个JSON对象，包含以下字段:
        - intention: 用户意图的描述
        - threeJsFeatures: 需要用到的Three.js特性列表
        
      
        
        请确保返回格式正确的JSON，不要有额外的文本或解释。`
      );

      // 创建链
      const chain = promptTemplate.pipe(azureModel).pipe(parser);

      // 执行链
      const result = await chain.invoke({ input });
      console.log("用户意图解析结果:", result);
      return JSON.stringify(result);
    } catch (error) {
      console.error("解析用户意图时出错:", error);
      throw error;
    }
  },
});

// 直接生成代码的函数
async function generateCode(technicalDescription: string, currentCode: string) {
  try {
    // 使用更直接的方式请求代码修改，明确要求完整的、可执行的代码
    const template = `你是一个Three.js代码生成专家。请基于以下当前代码：
\`\`\`js
${currentCode}
\`\`\`

根据以下技术描述：
"${technicalDescription}"

生成一个新的、完整的setup函数实现。

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
    await memory.saveContext(
      { input: technicalDescription },
      { currentCode: newCode }
    );
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

// 创建代码生成工具 - 这是之前缺少的定义
const generateCodeTool = new DynamicTool({
  name: "generate_threejs_code",
  description: "基于技术描述和当前代码生成Three.js代码",
  func: async (input: string) => {
    try {
      const { technicalDescription, currentCode } = JSON.parse(input);

      // 获取当前代码，如果没有提供则从内存中加载
      let codeToUse = currentCode;
      if (!codeToUse) {
        const memoryVars = await memory.loadMemoryVariables({});
        codeToUse = memoryVars.currentCode || initialCode;
      }

      const result = await generateCode(technicalDescription, codeToUse);
      return JSON.stringify(result);
    } catch (error) {
      console.error("生成代码工具出错:", error);
      throw error;
    }
  },
});

// 创建代理
// 创建代理
// 创建代理
async function createAgent() {
  const tools = [parseUserIntentTool, generateCodeTool];

  try {
    // 正确创建ReAct agent的提示，包含所有必需的变量
    const prompt = ChatPromptTemplate.fromTemplate(
      `你是一个Three.js代码生成助手，负责将用户的需求转换为可执行的Three.js代码。
      你将按照以下步骤工作：
      1. 首先，使用parse_user_intent工具解析用户需求并获取技术细节
      2. 然后，使用generate_threejs_code工具生成对应的Three.js代码
      3. 最后，返回完整代码给用户

      可用工具: {tools}
      工具名称: {tool_names}

      用户输入: {input}

      {agent_scratchpad}`
    );

    // 创建 Agent
    const agent = await createReactAgent({
      llm: azureModel,
      tools: tools,
      prompt: prompt,
    });

    // 创建执行器
    const executor = new AgentExecutor({
      agent,
      tools,
      verbose: true,
    });

    return executor;
  } catch (error) {
    console.error("创建Agent时出错:", error);
    throw error;
  }
}
// Agent实例缓存
let agentExecutor: AgentExecutor | null = null;

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

      // 如果请求中有代码，更新内存
      if (currentCode) {
        await memory.saveContext({ input: prompt }, { currentCode });
        console.log("已更新内存中的代码");
      }

      // 创建或获取Agent
      if (!agentExecutor) {
        agentExecutor = await createAgent();
      }

      // 使用Agent处理用户输入
      const result = await agentExecutor.invoke({
        input: prompt,
        currentCode:
          currentCode ||
          (
            await memory.loadMemoryVariables({})
          ).currentCode ||
          initialCode,
      });

      // 解析Agent返回的结果
      let finalResult;
      try {
        // 尝试查找返回结果中的代码 - 可能是JSON字符串
        const responseText = result.output;

        // 首先尝试解析为JSON
        try {
          const jsonResult = JSON.parse(responseText);
          if (jsonResult.directCode) {
            finalResult = jsonResult;
          } else {
            finalResult = {
              directCode: jsonResult.code || responseText,
              message: jsonResult.message || "代码已生成",
            };
          }
        } catch {
          // 如果不是JSON，尝试提取代码块
          const codeMatch = responseText.match(
            /```(?:js|javascript)?\s*([\s\S]*?)```/
          );
          if (codeMatch && codeMatch[1]) {
            finalResult = {
              directCode: codeMatch[1].trim(),
              message: "代码已生成",
            };
          } else if (responseText.includes("function setup")) {
            // 如果找到了function setup定义
            finalResult = {
              directCode: responseText,
              message: "代码已生成",
            };
          } else {
            // 返回原始结果
            finalResult = {
              directCode: responseText,
              message: "原始返回结果",
            };
          }
        }
      } catch (error) {
        console.error("解析Agent结果时出错:", error);
        finalResult = {
          error: "解析结果失败",
          rawOutput: result.output,
        };
      }

      return res.status(200).json(finalResult);
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
