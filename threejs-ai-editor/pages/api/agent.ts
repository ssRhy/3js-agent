import type { NextApiRequest, NextApiResponse } from "next";
import { runAgent } from "../../lib/agent/agentRunner";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // 确保是POST请求
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "仅支持POST请求",
    });
  }

  // 提取并验证参数
  const { instruction, currentCode } = req.body;

  if (!instruction) {
    return res.status(400).json({
      success: false,
      error: "请提供指令（instruction）参数",
    });
  }

  try {
    console.log("API请求接收:", {
      instruction: instruction.substring(0, 50) + "...",
    });

    // 使用模拟数据进行快速测试
    const USE_MOCK =
      process.env.USE_MOCK === "true" || !process.env.AZURE_OPENAI_API_KEY;

    let result;
    if (USE_MOCK) {
      console.log("使用模拟数据");
      // 返回简单的模拟数据
      result = `function setup(scene, camera, renderer, THREE, OrbitControls) {
        // 创建一个红色立方体
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        const cube = new THREE.Mesh(geometry, material);
        cube.userData.autoRotate = true;
        scene.add(cube);
        
        return cube;
      }`;
    } else {
      // 调用实际的Agent
      result = await runAgent(instruction, {
        maxIterations: 5,
        currentCode,
      });
    }

    if (!result) {
      return res.status(500).json({
        success: false,
        error: "生成代码失败，结果为空",
      });
    }

    // 返回成功响应
    res.status(200).json({
      success: true,
      directCode: result,
    });
  } catch (err: unknown) {
    console.error("API错误:", err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
}
