import { DynamicTool } from "@langchain/core/tools";
import { AzureChatOpenAI } from "@langchain/openai";

export const codeGenTool = new DynamicTool({
  name: "generate_code",
  description: "根据用户自然语言指令生成初始代码",
  func: async (instruction: string) => {
    const llm = new AzureChatOpenAI({
      temperature: 0,
      azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
      azureOpenAIApiDeploymentName:
        process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
      azureOpenAIApiVersion: "2024-02-15-preview",
      azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
    });

    const prompt = `请生成一个完整的、经过改进的setup函数，确保：
1. 遵循Three.js最佳实践
2. 有效地实现用户需求
请生成一个符合以下格式的 Three.js 代码：
function setup(scene, camera, renderer, THREE, OrbitControls) {
  // 在这里编写 Three.js 代码，使用传入的参数
  // 创建几何体、材质、网格等
  // 添加到场景中
  // 可以配置相机、渲染器
  // 可以设置动画、交互等
  
  // 必须返回主要的 3D 对象
  
}
注意事项：
1. 不要包含任何 import 语句，所有需要的库已通过参数提供
2. 不要包含 HTML、CSS 或完整网页结构
3. 不要使用 Markdown 代码块标记，只返回纯 JavaScript 代码
4. 确保代码在函数内定义并使用传入的 scene, camera, renderer, THREE 和 OrbitControls 参数
5. 不要尝试重新创建场景、相机或渲染器，使用传入的参数
6. 函数必须显式返回创建的主要对象（例如网格对象）
7. 使用 scene.add() 将对象添加到场景中
8. 如果需要创建控制器，请使用 OrbitControls.create(camera, renderer.domElement)

指令: ${instruction}`;

    const resp = await llm.invoke(prompt);

    // 提取代码内容
    let code =
      typeof resp.content === "string"
        ? resp.content
        : JSON.stringify(resp.content);

    // 如果代码包含markdown标记，提取其中的代码块
    if (code.includes("```")) {
      const match = code.match(/```(?:js|javascript)?([\s\S]*?)```/);
      code = match ? match[1].trim() : code;
    }

    // 确保代码是setup函数格式
    if (!code.includes("function setup")) {
      code = `function setup(scene, camera, renderer, THREE, OrbitControls) {
  ${
    code.includes("const geometry")
      ? code
      : `
  // 创建一个符合要求的对象
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  const cube = new THREE.Mesh(geometry, material);
  cube.userData.autoRotate = true;
  scene.add(cube);
  
  return cube;`
  }
}`;
    }

    return code;
  },
});
