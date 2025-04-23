import { NextApiRequest, NextApiResponse } from "next";
import { AzureChatOpenAI } from "@langchain/openai";
import { BufferMemory } from "langchain/memory";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { AgentExecutor, createOpenAIToolsAgent } from "langchain/agents";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
  SystemMessagePromptTemplate,
  HumanMessagePromptTemplate,
} from "@langchain/core/prompts";
import { StructuredOutputParser } from "langchain/output_parsers";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";

// 日志记录器
class Logger {
  private prefix: string;
  private debugMode: boolean;

  constructor(prefix: string) {
    this.prefix = prefix;
    this.debugMode = process.env.NODE_ENV === "development";
  }

  info(message: string, data?: object): void {
    console.log(`[${this.prefix}] INFO: ${message}`, data ? data : "");
  }

  error(message: string, error?: Error): void {
    console.error(`[${this.prefix}] ERROR: ${message}`, error ? error : "");
  }

  debug(message: string, data?: object): void {
    if (this.debugMode) {
      console.debug(`[${this.prefix}] DEBUG: ${message}`, data ? data : "");
    }
  }

  warn(message: string, data?: object): void {
    console.warn(`[${this.prefix}] WARN: ${message}`, data ? data : "");
  }

  trace(message: string): void {
    if (this.debugMode) {
      console.trace(`[${this.prefix}] TRACE: ${message}`);
    }
  }
}

// 创建Logger实例
const logger = new Logger("ThreeJSAgent");

// 初始脚本模板
const initialCode = `function setup(scene, camera, renderer) {
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshBasicMaterial({ color: 0x44aa88 });
  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);
}`;

// 定义用于结构化输出的schema
const codeOutputSchema = z.object({
  directCode: z.string().describe("完整的Three.js代码"),
  summary: z.string().describe("本次修改的摘要"),
  diff: z.string().optional().describe("代码的差异部分，使用diff格式"),
});

// 后端内存：存储 currentCode
const memory = new BufferMemory({
  memoryKey: "chatHistory",
  inputKey: "input",
  returnMessages: false,
});

// Azure OpenAI model setup
const setupModel = () => {
  logger.info("初始化Azure OpenAI模型");

  if (
    !process.env.AZURE_OPENAI_API_KEY ||
    !process.env.AZURE_OPENAI_API_ENDPOINT
  ) {
    logger.error("缺少Azure OpenAI API配置");
    throw new Error("Azure OpenAI API 配置缺失");
  }

  return new AzureChatOpenAI({
    model: "gpt-4o",
    temperature: 0,
    azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
    azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
    azureOpenAIApiVersion: "2024-02-15-preview",
    azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
    azureOpenAIEndpoint: process.env.AZURE_OPENAI_API_ENDPOINT,
    maxTokens: 4000,
  });
};

const azureModel = setupModel();

// 定义提取代码结果的类型
interface CodeResult {
  type: string;
  content: string;
}

// 提取代码块的函数
function extractCodeFromMessage(message: string): string | CodeResult {
  logger.debug("从消息中提取代码", { messageLength: message.length });

  // 尝试提取代码块
  const codeBlockRegex = /```(?:js|javascript)?\s*([\s\S]*?)\s*```/;
  const match = message.match(codeBlockRegex);

  if (match && match[1]) {
    logger.debug("找到代码块");
    return match[1].trim();
  }

  // 如果没有代码块，尝试提取function setup部分
  const setupRegex = /(function\s+setup\s*\([^)]*\)\s*\{[\s\S]*?\})/;
  const setupMatch = message.match(setupRegex);

  if (setupMatch && setupMatch[1]) {
    logger.debug("找到setup函数");
    return setupMatch[1].trim();
  }

  // 检查是否包含diff标记
  if (message.includes("```diff")) {
    const diffBlockRegex = /```diff\s*([\s\S]*?)\s*```/;
    const diffMatch = message.match(diffBlockRegex);

    if (diffMatch && diffMatch[1]) {
      logger.debug("找到diff格式代码");
      return {
        type: "diff",
        content: diffMatch[1].trim(),
      };
    }
  }

  logger.warn("无法从消息中提取代码");
  return message;
}

// 解析自然语言工具
const parseLanguageTool = new DynamicStructuredTool({
  name: "parseLanguage",
  description: "解析用户的自然语言请求，并提取关键技术需求",
  schema: z.object({
    userPrompt: z.string().describe("用户的自然语言请求"),
  }),
  func: async ({ userPrompt }) => {
    logger.info("使用parseLanguage工具", { prompt: userPrompt });

    try {
      const response = await azureModel.invoke(
        `分析以下Three.js相关需求，提取关键技术细节和特性：
        "${userPrompt}"
        
        以JSON格式返回以下内容：
        1. intention: 用户的主要意图
        2. features: Three.js需要实现的具体特性列表
        3. technicalDescription: 详细的技术描述
        4. complexity: 复杂度评估 (simple/moderate/complex)
        `
      );

      logger.debug("parseLanguage工具结果", {
        responseLength: response.content.length,
      });
      return response.content;
    } catch (error: unknown) {
      logger.error(
        "parseLanguage工具出错",
        error instanceof Error ? error : new Error(String(error))
      );
      throw error instanceof Error ? error : new Error(String(error));
    }
  },
});

const analyzeImageTool = new DynamicStructuredTool({
  name: "analyzeImage",
  description: "分析图像并提取3D场景的视觉特征",
  schema: z.object({
    imageUrl: z.string().describe("图像URL"),
  }),
  func: async ({ imageUrl }) => {
    logger.info("使用analyzeImage工具", {
      imageUrl: imageUrl.substring(0, 30) + "...",
    });

    try {
      // 修复调用参数，使用正确的消息格式
      const response = await azureModel.invoke([
        {
          role: "system",
          content: "你是一个三维图形专家，分析图像并提取特征。",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `分析这个图像，提取其中可能的3D场景特征：...`,
            },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ]);

      // 返回处理结果
      return response.content;
    } catch (error: unknown) {
      logger.error(
        "图像分析出错",
        error instanceof Error ? error : new Error(String(error))
      );
      throw error instanceof Error ? error : new Error(String(error));
    }
  },
});

// 添加缺失的analyzeScreenshotTool
const analyzeScreenshotTool = new DynamicStructuredTool({
  name: "analyzeScreenshot",
  description: "分析Three.js场景的截图，识别场景元素和潜在问题",
  schema: z.object({
    imageBase64: z.string().describe("场景截图的base64编码"),
    currentCode: z.string().optional().describe("当前Three.js代码"),
    userPrompt: z.string().optional().describe("用户的原始指令"),
  }),
  func: async ({ imageBase64, currentCode, userPrompt }) => {
    logger.info("========== 开始分析截图 ==========");
    logger.info(`用户提示: "${userPrompt}"`);

    // 记录代码信息
    if (currentCode) {
      logger.debug(`分析当前代码: 长度 ${currentCode.length}字符`);
    }

    // 保存图像截图到临时文件以便查看（可选）
    const imageDataSize = imageBase64.length;
    logger.info(`图像数据大小: ${(imageDataSize / 1024).toFixed(2)} KB`);

    if (!imageBase64.startsWith("data:image")) {
      throw new Error("无效的图像格式");
    }

    // 处理base64图像数据
    const base64Image = imageBase64.replace(/^data:image\/\w+;base64,/, "");

    const systemPrompt =
      "你是一个Three.js视觉分析专家，能够分析3D场景并提供具体的改进建议。";
    const userPromptText = `分析以下Three.js场景截图，${
      userPrompt ? `考虑用户的需求: "${userPrompt}"，` : ""
    }识别出以下内容：
1.模型是否符合生活常识和精细程度
2. 材质和纹理是否正确应用？
3.如果物体为黑色，一般就是纹理和材质选择了本地的，导致渲染失败
4. 提出具体的代码级改进或修复建议。`;

    try {
      // 在调用AI前记录
      logger.info("将图像发送给AI进行分析...");

      const result = await azureModel.invoke([
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userPromptText },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${base64Image}` },
            },
          ],
        },
      ]);

      // 记录分析结果
      const analysisResult = String(result.content);
      logger.info("========== 截图分析结果 ==========");
      console.log(analysisResult); // 直接打印完整结果，便于查看
      logger.info("====================================");

      // 保存截图到临时文件，便于查看
      try {
        const debugImageDir = path.join(process.cwd(), "debug-images");
        if (!fs.existsSync(debugImageDir)) {
          fs.mkdirSync(debugImageDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const imagePath = path.join(
          debugImageDir,
          `screenshot-${timestamp}.png`
        );

        // 去掉data:image/png;base64,前缀
        const base64Data = base64Image;
        fs.writeFileSync(imagePath, Buffer.from(base64Data, "base64"));

        logger.info(`截图已保存到: ${imagePath}`);
      } catch (saveError) {
        logger.warn(
          "保存调试截图失败",
          saveError instanceof Error ? saveError : new Error(String(saveError))
        );
      }

      return analysisResult;
    } catch (error) {
      logger.warn(
        "图像分析错误:",
        error instanceof Error ? error : new Error(String(error))
      );
      return "图像分析失败。请确保提供有效的图像并检查API密钥和设置。";
    }
  },
});

// 代码生成工具
const generateCodeTool = new DynamicStructuredTool({
  name: "generateCode",
  description: "生成或修改Three.js代码",
  schema: z.object({
    parsedIntent: z.string().describe("已解析的用户意图"),
    imageAnalysis: z.string().optional().describe("图像分析结果"),
    currentCode: z.string().describe("当前的Three.js代码"),
  }),
  func: async ({ parsedIntent, imageAnalysis, currentCode }) => {
    logger.info("========== 开始生成代码 ==========");
    logger.info(`基于用户意图: "${parsedIntent}"`);

    if (imageAnalysis) {
      logger.info("使用图像分析结果进行代码生成");
      // 可选：截取前200字符作为摘要
      const analysisSummary =
        imageAnalysis.substring(0, 200) +
        (imageAnalysis.length > 200 ? "..." : "");
      logger.info(`分析摘要: ${analysisSummary}`);
    }

    try {
      let prompt = `根据以下需求，生成或修改Three.js代码：

用户需求：${parsedIntent}

当前代码：
\`\`\`javascript
${currentCode}
\`\`\``;

      // 添加图像分析（如果有）
      if (imageAnalysis) {
        prompt += `\n\n场景分析：${imageAnalysis}`;
      }

      prompt += `
请生成一个完整的、经过改进的setup函数，确保：
1. 代码是完整且可执行的
2. 遵循Three.js最佳实践
3. 保持原始代码的基本结构
4. 有效地实现用户需求
5. 使用在线cdn纹理或者贴图，不要使用本地纹理jpg和gtlf
特别重要：如果提供了 analyzeScreenshotTool 的场景分析建议，请确保根据分析结果来修改代码，解决分析中指出的问题。

同时，请生成一个diff格式的补丁，显示与原始代码的差异。

返回格式：
{
  "directCode": "完整的修改后代码",
  "summary": "简要描述所做的修改",
  "diff": "diff格式的代码差异（如有）"
}`;

      const response = await azureModel.invoke(prompt);

      // 尝试解析JSON响应
      try {
        let jsonMatch;
        if (typeof response.content === "string") {
          jsonMatch =
            response.content.match(/```json\s*([\s\S]*?)\s*```/) ||
            response.content.match(/({[\s\S]*})/);
        }

        if (jsonMatch && jsonMatch[1]) {
          const result = JSON.parse(jsonMatch[1]);
          logger.debug("generateCode工具结果已解析为JSON");

          // 添加详细的diff日志记录
          if (result.diff) {
            logger.info("========== Diff 内容 ==========");
            console.log(result.diff);
            logger.info("==============================");

            // 统计diff的修改行数
            const diffLines = result.diff.split("\n");
            const addedLines = diffLines.filter((line: string) =>
              line.startsWith("+")
            ).length;
            const removedLines = diffLines.filter((line: string) =>
              line.startsWith("-")
            ).length;
            logger.info(
              `Diff统计: 添加了${addedLines}行, 删除了${removedLines}行`
            );
          } else if (result.directCode && result.directCode !== currentCode) {
            // 如果没有diff但有新代码，则生成diff
            logger.info("模型未生成diff但返回了新代码，自动生成diff");
            result.diff = generateDiff(currentCode, result.directCode);

            logger.info("========== 自动生成的Diff内容 ==========");
            console.log(result.diff);
            logger.info("======================================");
          }

          return result;
        } else {
          // 如果不是JSON，提取代码块
          const extractedCode = extractCodeFromMessage(
            response.content as string
          );
          let result: {
            directCode?: string;
            summary?: string;
            diff?: string;
            patch?: string;
            [key: string]: unknown;
          } = {};

          if (typeof extractedCode === "string") {
            result = {
              directCode: extractedCode,
              summary: "生成了新的Three.js代码",
            };

            // 如果生成了新代码，添加自动生成的diff
            if (extractedCode !== currentCode) {
              result.diff = generateDiff(currentCode, extractedCode);
              logger.info("========== 为提取的代码生成Diff ==========");
              console.log(result.diff);
              logger.info("=======================================");
            }

            logger.debug("generateCode工具结果已提取为代码");
          } else if (
            typeof extractedCode === "object" &&
            extractedCode.type === "diff"
          ) {
            result = {
              patch: extractedCode.content,
              summary: "生成了增量修改代码",
            };

            logger.info("========== 提取的Diff内容 ==========");
            console.log(extractedCode.content);
            logger.info("==================================");

            logger.debug("从输出中提取了diff格式代码");
          }

          return result;
        }
      } catch (error: unknown) {
        logger.error(
          "解析generateCode结果失败",
          error instanceof Error ? error : new Error(String(error))
        );
        return {
          directCode: currentCode,
          summary: "代码生成失败，保留原有代码",
        };
      }
    } catch (error: unknown) {
      logger.error(
        "generateCode工具出错",
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  },
});

// 设置Agent
const setupAgent = async () => {
  logger.info("设置Agent");

  // 定义工具集
  const tools = [
    parseLanguageTool,
    analyzeImageTool,
    analyzeScreenshotTool,
    generateCodeTool,
  ];

  // 创建提示模板
  const systemMessage = SystemMessagePromptTemplate.fromTemplate(
    `你是一个先进的Three.js AI助手，能够理解、生成和优化Three.js代码。
你可以根据用户需求动态选择最合适的工具：
- 如果用户提供了自然语言需求，使用parseLanguage工具进行分析
- 如果需要分析当前场景的视觉状态，系统会自动提供场景截图，你可使用analyzeScreenshot工具分析图像
- 根据analyzeScreenshot分析的结果和建议，使用generateCode工具生成或修改代码

每次生成代码时，请确保：
1. 保持渐进式修改，不要完全重写用户的代码
2. 返回完整、可执行的代码
3. 保持代码风格一致性
4. 提供修改摘要

请以结构化JSON格式返回结果，包含directCode（完整代码）、summary（修改摘要）和可选的diff（代码差异）。`
  );

  const promptTemplate = ChatPromptTemplate.fromMessages([
    systemMessage,
    HumanMessagePromptTemplate.fromTemplate("{input}"),
    new MessagesPlaceholder("agent_scratchpad"),
  ]);

  // 创建输出解析器 - 需要保留但当前未使用
  StructuredOutputParser.fromZodSchema(codeOutputSchema);
  logger.debug("创建输出解析器");

  // 创建agent
  const agent = await createOpenAIToolsAgent({
    llm: azureModel,
    tools: tools,
    prompt: promptTemplate,
  });
  logger.info("Agent创建成功");

  // 创建agent执行器
  return new AgentExecutor({
    agent,
    tools,
    verbose: process.env.NODE_ENV === "development",
    maxIterations: 3, // 限制最大迭代次数
  });
};

// 缓存agent实例
let agentExecutor: AgentExecutor | null = null;

// 创建一个diff生成函数
function generateDiff(originalCode: string, newCode: string): string {
  // 简化的diff生成算法
  const originalLines = originalCode.split("\n");
  const newLines = newCode.split("\n");

  let diffResult = "";
  diffResult += "```diff\n";

  let i = 0,
    j = 0;
  while (i < originalLines.length || j < newLines.length) {
    if (
      i < originalLines.length &&
      j < newLines.length &&
      originalLines[i] === newLines[j]
    ) {
      // 相同行，保留上下文
      diffResult += " " + originalLines[i] + "\n";
      i++;
      j++;
    } else {
      // 查找下一个匹配点
      let found = false;
      const lookAhead = 3; // 向前看几行

      for (let k = 1; k <= lookAhead && i + k < originalLines.length; k++) {
        for (let l = 1; l <= lookAhead && j + l < newLines.length; l++) {
          if (originalLines[i + k] === newLines[j + l]) {
            // 找到匹配点，先输出删除的行
            for (let m = 0; m < k; m++) {
              diffResult += "-" + originalLines[i + m] + "\n";
            }
            // 再输出添加的行
            for (let m = 0; m < l; m++) {
              diffResult += "+" + newLines[j + m] + "\n";
            }
            i += k;
            j += l;
            found = true;
            break;
          }
        }
        if (found) break;
      }

      if (!found) {
        // 没找到匹配点，按顺序输出
        if (i < originalLines.length) {
          diffResult += "-" + originalLines[i] + "\n";
          i++;
        }
        if (j < newLines.length) {
          diffResult += "+" + newLines[j] + "\n";
          j++;
        }
      }
    }
  }

  diffResult += "```";
  return diffResult;
}

// API 路由处理
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === "POST") {
    const startTime = Date.now();
    const { prompt, image, currentCode } = req.body;

    logger.info("收到API请求", {
      promptLength: prompt?.length,
      hasImage: !!image,
      hasCurrentCode: !!currentCode,
    });

    if (!prompt) {
      logger.error("请求缺少prompt参数");
      return res.status(400).json({ error: "No prompt provided" });
    }

    try {
      // 初始化agent（如果未初始化）
      if (!agentExecutor) {
        logger.info("初始化Agent执行器");
        agentExecutor = await setupAgent();
      }

      let response;

      // 两种不同的处理路径
      if (image) {
        // 1. 如果提供了图像，直接使用analyzeScreenshotTool
        logger.info("========== 使用截图驱动模式 ==========");
        logger.info(`处理用户请求: "${prompt}"`);

        const analysisResult = await analyzeScreenshotTool.invoke({
          imageBase64: image,
          currentCode: currentCode || initialCode,
          userPrompt: prompt,
        });
        // 增加时间戳
        logger.info(`图像分析完成，耗时: ${Date.now() - startTime}ms`);

        const codeResult = await generateCodeTool.invoke({
          parsedIntent: prompt,
          imageAnalysis: analysisResult,
          currentCode: currentCode || initialCode,
        });

        const totalTime = Date.now() - startTime;
        logger.info(`截图驱动模式处理完成，总耗时: ${totalTime}ms`);

        // 增加一个分隔行，便于日志阅读
        logger.info("=======================================");

        response = codeResult;
      } else {
        // 2. 否则，使用Agent进行推理和工具选择
        logger.info("使用Agent推理路径");

        const input: { input: string; currentCode: string } = {
          input: prompt,
          currentCode: currentCode || initialCode,
        };

        const result = await agentExecutor.invoke(input);
        logger.debug("Agent执行完成", { outputType: typeof result.output });

        // 解析返回结果
        if (typeof result.output === "string") {
          // 尝试将输出解析为JSON
          try {
            response = JSON.parse(result.output);
            logger.debug("成功解析JSON输出");
          } catch (parseError) {
            logger.warn("解析JSON失败，尝试提取代码", parseError as Error);

            // 如果不是JSON，检查是否包含代码块
            const cleanCode = extractCodeFromMessage(result.output);

            if (typeof cleanCode === "string") {
              response = {
                directCode: cleanCode,
                summary: "代码已生成",
              };
              logger.debug("从输出中提取了代码字符串");
            } else if (
              typeof cleanCode === "object" &&
              cleanCode.type === "diff"
            ) {
              response = {
                patch: cleanCode.content,
                summary: "生成了增量修改代码",
              };
              logger.debug("从输出中提取了diff格式代码");
            } else {
              // 没有找到代码，返回错误
              logger.error("Agent未生成有效代码");
              throw new Error("Agent未能生成有效代码");
            }
          }
        } else {
          // 直接返回输出（已经是对象）
          response = result.output;
          logger.debug("Agent返回了对象输出");
        }

        // 如果有directCode，确保保存到记忆中
        if (response.directCode) {
          await memory.saveContext(
            { input: prompt },
            { currentCode: response.directCode }
          );
          logger.debug("更新了内存中的代码");
        }
      }

      // 计算处理时间
      const processingTime = Date.now() - startTime;

      // 确保生成diff并记录详细信息
      if (response) {
        // 如果没有diff但有新代码，生成diff
        if (
          !response.diff &&
          !response.patch &&
          response.directCode &&
          response.directCode !== (currentCode || initialCode)
        ) {
          response.diff = generateDiff(
            currentCode || initialCode,
            response.directCode
          );
          logger.info("在API响应前自动生成Diff");
        }

        // 记录diff或patch的详细信息
        if (response.diff) {
          logger.info("========== 最终返回的Diff内容 ==========");
          console.log(response.diff);

          // 统计diff的修改内容
          const diffLines = response.diff.split("\n");
          const addedLines = diffLines.filter((line: string) =>
            line.startsWith("+")
          ).length;
          const removedLines = diffLines.filter((line: string) =>
            line.startsWith("-")
          ).length;
          const contextLines = diffLines.filter((line: string) =>
            line.startsWith(" ")
          ).length;

          logger.info("Diff统计信息:", {
            totalLines: diffLines.length,
            addedLines,
            removedLines,
            contextLines,
            changeRatio: (
              (addedLines + removedLines) /
              diffLines.length
            ).toFixed(2),
          });
          logger.info("=========================================");
        } else if (response.patch) {
          logger.info("========== 最终返回的Patch内容 ==========");
          console.log(response.patch);
          logger.info("=========================================");
        } else {
          logger.warn("最终响应中没有diff或patch内容");
        }
      }

      logger.info(`请求处理完成 (耗时: ${processingTime}ms)`, {
        responseType: typeof response,
        hasDirectCode: !!response.directCode,
        hasDiff: !!response.diff,
        hasPatch: !!response.patch,
      });

      // 返回生成的代码和摘要
      return res.status(200).json(response);
    } catch (error: unknown) {
      const processingTime = Date.now() - startTime;
      logger.error(
        `处理请求时出错: ${
          error instanceof Error ? error.message : "未知错误"
        } (耗时: ${processingTime}ms)`,
        error instanceof Error ? error : new Error(String(error))
      );

      return res.status(500).json({
        error: "处理请求失败",
        message: error instanceof Error ? error.message : "未知错误",
      });
    }
  } else {
    logger.warn("收到非POST请求", { method: req.method });
    return res.status(405).json({ error: "Method not allowed" });
  }
}
