import { DynamicStructuredTool } from "@langchain/core/tools";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { createModelClient } from "../agents/agentFactory";
import { extractTextContent } from "../processors/codeProcessor";
import {
  saveAnalysisToMemory,
  prepareHistoryContext,
} from "../memory/memoryManager";
import { modelGenTool } from "./modelGenTool";

/**
 * Validates a base64 string to ensure it's properly formatted
 * @param base64String The base64 string to validate
 * @returns Whether the string appears to be valid base64
 */
function isValidBase64Image(base64String: string): boolean {
  // If it's already a data URL, extract just the base64 part
  if (base64String.startsWith("data:image")) {
    const parts = base64String.split(",");
    if (parts.length !== 2) return false;
    base64String = parts[1];
  }

  // Check if it follows base64 pattern (length is multiple of 4, valid chars)
  const regex = /^[A-Za-z0-9+/]+(=|==)?$/;
  return regex.test(base64String) && base64String.length % 4 === 0;
}

/**
 * Internal helper function to analyze an image and generate scene description
 * @param imageData Base64 encoded image data
 * @param userRequirement User's additional requirements
 * @returns Analysis result with scene description
 */
async function analyzeImageForScene(
  imageData: string,
  userRequirement: string
): Promise<{
  status: string;
  sceneDescription?: string;
  objects?: Array<{
    type: string;
    description: string;
    position?: string;
    color?: string;
    material?: string;
  }>;
  lighting?: string;
  camera?: string;
  environment?: string;
  message?: string;
}> {
  const requestId = `image_scene_analysis_${Date.now()}`;
  console.log(
    `[${requestId}] [Image Scene Tool] Started image analysis at ${new Date().toISOString()}`
  );

  try {
    // Validate image data
    if (!imageData || imageData.length < 100) {
      console.error(
        `[${requestId}] [Image Scene Tool] Invalid image data: too short or empty`
      );
      throw new Error("Image data is too short or empty");
    }

    if (!isValidBase64Image(imageData) && !imageData.startsWith("data:image")) {
      console.error(
        `[${requestId}] [Image Scene Tool] Invalid image format detected`
      );
      throw new Error("Invalid image data format");
    }

    // Get historical context
    const historyContext = await prepareHistoryContext();

    // Build analysis prompt for scene reconstruction
    const prompt = `分析这张图片并为Three.js 3D场景重建提供详细描述。

用户需求:
${userRequirement || "根据图片内容创建相似的3D场景"}

${historyContext ? `历史上下文:\n${historyContext}\n\n` : ""}

请详细分析图片并提供以下信息：

1. **场景概述**: 图片展示的是什么类型的场景？(室内/室外/抽象等)
2. **主要物体**: 识别图片中的主要物体，包括：
   - 物体类型 (立方体、球体、圆柱体、复杂模型等)
   - 大致位置 (前景、中景、背景)
   - 颜色和材质特征
   - 相对大小关系
3. **空间布局**: 物体之间的空间关系和布局
4. **光照条件**: 光源类型、方向、强度、阴影情况
5. **相机视角**: 观察角度、距离、焦点
6. **环境设置**: 背景、地面、天空等环境要素
7. **材质纹理**: 物体表面的材质特征

基于分析，为每个主要物体提供：
- Three.js几何体类型建议
- 建议的材质类型 (MeshBasicMaterial, MeshLambertMaterial, MeshPhongMaterial等)
- 大致的位置坐标
- 颜色值(十六进制)
- 大小尺寸

请确保描述足够详细，以便生成准确的Three.js代码重现相似场景。`;

    // Create image URL
    const imageUrl = imageData.startsWith("data:")
      ? imageData
      : `data:image/png;base64,${imageData}`;

    console.log(
      `[${requestId}] [Image Scene Tool] Prepared image URL for analysis`
    );

    // Get model client
    const model = createModelClient();

    // Create message with image
    const message = new HumanMessage({
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
    });

    console.log(
      `[${requestId}] [Image Scene Tool] Sending request to vision model`
    );

    // Call model
    const result = await model.invoke([message]);
    const analysis = extractTextContent(result.content);

    console.log(
      `[${requestId}] [Image Scene Tool] Analysis completed at ${new Date().toISOString()}`
    );

    // Save analysis to memory
    await saveAnalysisToMemory(userRequirement, analysis);

    // Extract structured information from analysis
    const objects = extractObjectsFromAnalysis(analysis);
    const lighting = extractLightingFromAnalysis(analysis);
    const camera = extractCameraFromAnalysis(analysis);
    const environment = extractEnvironmentFromAnalysis(analysis);

    return {
      status: "success",
      sceneDescription: analysis,
      objects: objects,
      lighting: lighting,
      camera: camera,
      environment: environment,
    };
  } catch (error) {
    console.error(`[${requestId}] [Image Scene Tool] Error:`, error);
    return {
      status: "error",
      message: `Error analyzing image: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * Extract object information from analysis text
 */
function extractObjectsFromAnalysis(analysis: string): Array<{
  type: string;
  description: string;
  position?: string;
  color?: string;
  material?: string;
}> {
  const objects: Array<{
    type: string;
    description: string;
    position?: string;
    color?: string;
    material?: string;
  }> = [];

  // Simple extraction - in a real implementation, you might use more sophisticated NLP
  const lines = analysis.split("\n");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let currentObject: any = null;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Look for object descriptions
    if (trimmedLine.includes("立方体") || trimmedLine.includes("BoxGeometry")) {
      if (currentObject) objects.push(currentObject);
      currentObject = { type: "box", description: trimmedLine };
    } else if (
      trimmedLine.includes("球体") ||
      trimmedLine.includes("SphereGeometry")
    ) {
      if (currentObject) objects.push(currentObject);
      currentObject = { type: "sphere", description: trimmedLine };
    } else if (
      trimmedLine.includes("圆柱") ||
      trimmedLine.includes("CylinderGeometry")
    ) {
      if (currentObject) objects.push(currentObject);
      currentObject = { type: "cylinder", description: trimmedLine };
    } else if (
      trimmedLine.includes("平面") ||
      trimmedLine.includes("PlaneGeometry")
    ) {
      if (currentObject) objects.push(currentObject);
      currentObject = { type: "plane", description: trimmedLine };
    }

    // Extract color information
    if (
      currentObject &&
      (trimmedLine.includes("颜色") || trimmedLine.includes("color"))
    ) {
      currentObject.color = trimmedLine;
    }

    // Extract position information
    if (
      currentObject &&
      (trimmedLine.includes("位置") || trimmedLine.includes("position"))
    ) {
      currentObject.position = trimmedLine;
    }

    // Extract material information
    if (
      currentObject &&
      (trimmedLine.includes("材质") || trimmedLine.includes("material"))
    ) {
      currentObject.material = trimmedLine;
    }
  }

  if (currentObject) objects.push(currentObject);

  return objects;
}

/**
 * Extract lighting information from analysis text
 */
function extractLightingFromAnalysis(analysis: string): string {
  const lightingMatch = analysis.match(
    /光照[\s\S]*?(?=\n\n|\n[0-9]|\n[a-zA-Z]|$)/i
  );
  return lightingMatch ? lightingMatch[0] : "使用环境光和点光源的组合";
}

/**
 * Extract camera information from analysis text
 */
function extractCameraFromAnalysis(analysis: string): string {
  const cameraMatch = analysis.match(
    /相机[\s\S]*?(?=\n\n|\n[0-9]|\n[a-zA-Z]|$)/i
  );
  return cameraMatch ? cameraMatch[0] : "使用透视相机，适中距离观察场景";
}

/**
 * Extract environment information from analysis text
 */
function extractEnvironmentFromAnalysis(analysis: string): string {
  const envMatch = analysis.match(/环境[\s\S]*?(?=\n\n|\n[0-9]|\n[a-zA-Z]|$)/i);
  return envMatch ? envMatch[0] : "简单的背景和地面设置";
}

/**
 * Identify objects that need complex 3D models using LLM analysis
 */
async function identifyComplexObjects(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  objects: Array<any>,
  sceneDescription: string
): Promise<Array<{ type: string; description: string }>> {
  const requestId = `complex_object_analysis_${Date.now()}`;
  console.log(`[${requestId}] Analyzing objects for 3D model generation`);

  try {
    // Get model client for analysis
    const model = createModelClient();

    const analysisPrompt = `分析以下场景和物体，确定哪些需要使用3D模型生成工具创建复杂模型，而不是简单的几何体。

## 场景描述
${sceneDescription}

## 识别的物体
${objects
  .map((obj, index) => `${index + 1}. ${obj.type}: ${obj.description}`)
  .join("\n")}

## 分析要求
请分析上述物体，判断哪些需要使用3D模型生成工具创建：

**需要3D模型生成的情况：**
- 复杂形状的物体（家具、车辆、建筑、动植物、人物、装饰品等）
- 有特殊细节和纹理的物体
- 现实世界中存在的具体物品
- 艺术品、雕塑、装置等

**不需要3D模型生成的情况：**
- 基本几何体（简单的立方体、球体、圆柱体、平面）
- 抽象形状
- 用于布局的基础元素

**输出格式：**
只需要输出需要3D模型生成的物体，每行一个，格式如下：
物体类型|物体描述

例如：
chair|现代办公椅，黑色皮质
tree|高大的松树，绿色针叶
car|红色跑车，流线型设计

如果没有需要3D模型生成的物体，请输出："无需要3D模型生成的物体"

限制：最多选择3个最重要的物体进行3D模型生成（考虑生成时间和资源）。`;

    const message = new HumanMessage({
      content: analysisPrompt,
    });

    const result = await model.invoke([message]);
    const analysis = extractTextContent(result.content);

    console.log(`[${requestId}] LLM analysis result:`, analysis);

    // Parse the analysis result
    const complexObjects: Array<{ type: string; description: string }> = [];

    if (analysis.includes("无需要3D模型生成的物体")) {
      console.log(`[${requestId}] No objects need 3D model generation`);
      return complexObjects;
    }

    const lines = analysis.split("\n").filter((line) => line.includes("|"));

    for (const line of lines) {
      const parts = line.split("|");
      if (parts.length >= 2) {
        const type = parts[0].trim();
        const description = parts[1].trim();

        if (type && description) {
          complexObjects.push({
            type: type,
            description: description,
          });
          console.log(
            `[${requestId}] Identified complex object: ${type} - ${description}`
          );
        }
      }
    }

    console.log(
      `[${requestId}] Total complex objects identified: ${complexObjects.length}`
    );
    return complexObjects.slice(0, 3); // Limit to 3 objects max
  } catch (error) {
    console.error(`[${requestId}] Error in LLM analysis:`, error);
    // Fallback to empty array if analysis fails
    return [];
  }
}

/**
 * Generate Three.js code based on image analysis with 3D model integration
 */
async function generateSceneCode(
  sceneDescription: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  objects: Array<any>,
  lighting: string,
  camera: string,
  environment: string,
  userRequirement: string
): Promise<string> {
  const requestId = `scene_code_gen_${Date.now()}`;
  console.log(
    `[${requestId}] [Image Scene Tool] Generating Three.js code with 3D models`
  );

  try {
    // Step 1: Identify objects that need complex 3D models
    const complexObjects = await identifyComplexObjects(
      objects,
      sceneDescription
    );

    // Step 2: Generate 3D models for complex objects
    const generatedModels: Array<{
      type: string;
      modelUrl: string;
      description: string;
    }> = [];

    for (const complexObj of complexObjects) {
      console.log(
        `[${requestId}] Generating 3D model for: ${complexObj.description}`
      );
      try {
        const modelResult = await modelGenTool.func(
          JSON.stringify({
            prompt: `${complexObj.description} - 高质量3D模型，适合Three.js场景`,
            meshMode: "Quad",
            quality: "medium",
            material: "pbr",
          })
        );

        const modelData = JSON.parse(modelResult);
        if (modelData.success && modelData.modelUrl) {
          generatedModels.push({
            type: complexObj.type,
            modelUrl: modelData.modelUrl,
            description: complexObj.description,
          });
          console.log(
            `[${requestId}] Successfully generated model for ${complexObj.type}`
          );
        }
      } catch (error) {
        console.log(
          `[${requestId}] Failed to generate model for ${complexObj.type}:`,
          error
        );
        // Continue with basic geometry as fallback
      }
    }

    // Get model client for code generation
    const model = createModelClient();

    const codePrompt = `基于以下图片分析结果，生成完整的Three.js场景代码：

## 场景描述
${sceneDescription}

## 物体信息
${objects.map((obj) => `- ${obj.type}: ${obj.description}`).join("\n")}

## 生成的3D模型
${
  generatedModels.length > 0
    ? generatedModels
        .map(
          (model) =>
            `- ${model.type}: ${model.description} (模型URL: ${model.modelUrl})`
        )
        .join("\n")
    : "无生成的3D模型，使用基础几何体"
}

## 光照设置
${lighting}

## 相机设置
${camera}

## 环境设置
${environment}

## 用户需求
${userRequirement}

请生成一个完整的Three.js setup函数，包含：
1. 场景初始化
2. 相机设置
3. 光照配置
4. 基础几何体物体创建
5. 外部3D模型加载（使用GLTFLoader）
6. 材质和纹理
7. 适当的位置布局

代码要求：
- 使用function setup(scene, camera, renderer, THREE, OrbitControls)格式
- 对于外部模型，使用GLTFLoader加载GLB文件
- 确保所有物体底部与地面对齐
- 使用合适的颜色和材质
- 添加适当的光照效果
- 包含加载进度和错误处理
- 代码简洁高效
- 只返回纯代码，不要包含解释文字

${
  generatedModels.length > 0
    ? `
外部模型加载示例：
\`\`\`javascript
// 创建GLTFLoader
const loader = new THREE.GLTFLoader();

// 加载模型
loader.load(
  '${generatedModels[0].modelUrl}',
  function (gltf) {
    const model = gltf.scene;
    model.position.set(0, 0, 0);
    model.scale.set(1, 1, 1);
    scene.add(model);
  },
  function (progress) {
    console.log('Loading progress:', progress);
  },
  function (error) {
    console.error('Loading error:', error);
  }
);
\`\`\`
`
    : ""
}

示例格式：
\`\`\`javascript
function setup(scene, camera, renderer, THREE, OrbitControls) {
  // 创建基础物体和场景
  // 加载外部3D模型
  // ...
  return scene;
}
\`\`\``;

    const message = new HumanMessage({
      content: codePrompt,
    });

    const result = await model.invoke([message]);
    const code = extractTextContent(result.content);

    // Clean up the code (remove markdown formatting if present)
    let cleanCode = code.replace(/```javascript\n?|```\n?/g, "").trim();

    // Ensure it's a proper function if not already
    if (!cleanCode.includes("function setup")) {
      cleanCode = `function setup(scene, camera, renderer, THREE, OrbitControls) {
  ${cleanCode}
  return scene;
}`;
    }

    console.log(`[${requestId}] [Image Scene Tool] Code generation completed`);
    return cleanCode;
  } catch (error) {
    console.error(
      `[${requestId}] [Image Scene Tool] Code generation error:`,
      error
    );

    // Return a basic fallback scene
    return `function setup(scene, camera, renderer, THREE, OrbitControls) {
  // 基于图片分析的基础场景
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
  const cube = new THREE.Mesh(geometry, material);
  cube.position.y = 0.5;
  scene.add(cube);
  
  // 添加光照
  const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
  scene.add(ambientLight);
  
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(5, 5, 5);
  scene.add(directionalLight);
  
  // 添加地面
  const groundGeometry = new THREE.PlaneGeometry(10, 10);
  const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x999999 });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  
  return scene;
}`;
  }
}

/**
 * Image Scene Generation Tool - Analyzes an image and generates a similar 3D scene
 */
export const imageSceneTool = new DynamicStructuredTool({
  name: "analyze_image_generate_scene",
  description:
    "Analyze an uploaded image and generate a similar Three.js 3D scene based on the image content. Use this when user uploads an image and wants to create a 3D scene that matches the image.",
  schema: z.object({
    imageData: z
      .string()
      .describe("Base64 encoded image data (with or without data URL prefix)"),
    userRequirement: z
      .string()
      .optional()
      .describe("Additional user requirements for the scene generation"),
  }),
  func: async ({ imageData, userRequirement = "" }) => {
    const requestId = `image_scene_tool_${Date.now()}`;
    const startTime = Date.now();
    console.log(
      `[${requestId}] [Image Scene Tool] Starting image-to-scene conversion at ${new Date().toISOString()}`
    );

    try {
      // Step 1: Analyze the image
      console.log(`[${requestId}] [Image Scene Tool] Step 1: Analyzing image`);
      const analysis = await analyzeImageForScene(imageData, userRequirement);

      if (analysis.status === "error") {
        return JSON.stringify({
          success: false,
          error: analysis.message,
          code: null,
        });
      }

      // Step 2: Generate Three.js code based on analysis
      console.log(
        `[${requestId}] [Image Scene Tool] Step 2: Generating scene code`
      );
      const sceneCode = await generateSceneCode(
        analysis.sceneDescription || "",
        analysis.objects || [],
        analysis.lighting || "",
        analysis.camera || "",
        analysis.environment || "",
        userRequirement
      );

      const endTime = Date.now();
      console.log(
        `[${requestId}] [Image Scene Tool] Completed in ${
          endTime - startTime
        }ms`
      );

      // Return the result
      return JSON.stringify({
        success: true,
        analysis: analysis,
        code: sceneCode,
        message: "Successfully generated 3D scene from image",
      });
    } catch (error) {
      console.error(`[${requestId}] [Image Scene Tool] Error:`, error);
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        code: null,
      });
    }
  },
});
