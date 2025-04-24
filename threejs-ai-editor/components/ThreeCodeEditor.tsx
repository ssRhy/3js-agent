import React, { useState } from "react";
import { Editor, OnMount } from "@monaco-editor/react";
import { callTestApi, callAgentApi } from "../lib/api-client";
import ThreeScene from "./ThreeScene";

export default function ThreeCodeEditor() {
  const editorRef = React.useRef<monaco.editor.IStandaloneCodeEditor | null>(
    null
  );
  const [prompt, setPrompt] = useState("添加一个旋转的红色立方体");
  const [code, setCode] =
    useState(`function setup(scene, camera, renderer, THREE, OrbitControls) {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x44aa88 });
    const cube = new THREE.Mesh(geometry, material);
    cube.userData.autoRotate = true;
    scene.add(cube);

    if (OrbitControls && OrbitControls.create) {
      const controls = OrbitControls.create(camera, renderer.domElement);
      controls.enableDamping = true;
    }
  
    return cube;
  }`);
  const [previousCode, setPreviousCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showDiff, setShowDiff] = useState(false);
  const [diff, setDiff] = useState<string>("");

  const captureScreenshot = async () => {
    try {
      // 使用canvas.toDataURL获取截图
      const canvas = document.querySelector("canvas");
      if (!canvas) {
        throw new Error("Canvas not found");
      }

      const imageBase64 = canvas.toDataURL("image/png");
      console.log("获取到截图数据，长度:", imageBase64.length);

      if (imageBase64 === "data:,") {
        console.error("截图为空白");
        throw new Error("截图内容为空");
      }

      return imageBase64;
    } catch (err) {
      console.error("截图失败:", err);
      setError("无法捕获场景截图");
      return null;
    }
  };

  const handleGenerate = async () => {
    if (!prompt) {
      setError("请输入指令");
      return;
    }

    try {
      setIsLoading(true);
      setError("");

      console.log("开始生成代码...");

      // 先测试简单的API端点是否能正常工作
      try {
        console.log("测试API端点...");
        const testResult = await callTestApi();
        console.log("测试API响应:", testResult);

        if (!testResult.success) {
          throw new Error(`测试API失败: ${testResult.error || "未知错误"}`);
        }
      } catch (testErr) {
        console.error("测试API错误:", testErr);
        setError(
          `API测试失败: ${
            testErr instanceof Error ? testErr.message : String(testErr)
          }`
        );
        setIsLoading(false);
        return;
      }

      // 确保可以获取截图
      let imageBase64 = null;
      try {
        imageBase64 = await captureScreenshot();
        console.log(
          "截图获取成功，长度:",
          imageBase64 ? imageBase64.length : 0
        );
      } catch (imgErr) {
        console.warn("截图获取失败，将继续不使用截图:", imgErr);
        // 截图失败继续执行，只是不传递图像
      }

      // 如果截图失败，则不传递图像参数
      const apiPayload = {
        instruction: prompt,
        currentCode: code,
      };

      // 只有当imageBase64不为null时才添加图像
      if (imageBase64 !== null) {
        // @ts-expect-error - 动态添加属性
        apiPayload.image = imageBase64;
      }

      console.log("准备调用Agent API...");
      // 使用API客户端调用Agent API
      const data = await callAgentApi(apiPayload);
      console.log("Agent API响应:", data);

      if (!data.success || data.error) {
        const errorMsg = data.error || data.message || "未知错误";
        console.error("API错误:", errorMsg);
        setError(`API返回错误: ${errorMsg}`);
        return;
      }

      // 确保directCode存在
      if (!data.directCode) {
        console.error("API响应中缺少directCode:", data);
        setError("API响应格式不正确，缺少代码内容");
        return;
      }

      const validateCode = (codeToValidate: string) => {
        const hasSetupFn = codeToValidate.includes("function setup");
        const openBraces = (codeToValidate.match(/\{/g) || []).length;
        const closeBraces = (codeToValidate.match(/\}/g) || []).length;

        return hasSetupFn && openBraces === closeBraces;
      };

      if (data.directCode) {
        if (validateCode(data.directCode)) {
          setPreviousCode(code);
          setCode(data.directCode);
        } else {
          setError("API返回的代码不完整，无法安全渲染");
          console.error("不完整代码:", data.directCode);
        }
      }

      if (data.patch) {
        try {
          const { applyDiff } = await import("../utils/applyDiff");
          const newCode = applyDiff(code, data.patch);

          if (newCode !== code) {
            if (validateCode(newCode)) {
              setPreviousCode(code);
              setCode(newCode);
              setDiff(data.patch);
            } else {
              setError("应用差异后的代码不完整，无法安全渲染");
              console.error("应用diff后的不完整代码:", newCode);
            }
          } else {
            setError("补丁应用后代码没有变化");
          }
        } catch (diffError) {
          console.error("应用diff时出错:", diffError);
          setError("应用代码差异时出错");
        }
      }
    } catch (err) {
      console.error("生成代码错误:", err);
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditorDidMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  return (
    <div className="editor-container">
      <div className="sidebar">
        <h2>Three.js AI 编辑器</h2>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="例如: 添加一个旋转的红色球体"
          rows={4}
        />
        <button onClick={handleGenerate} disabled={isLoading}>
          {isLoading ? "生成中..." : "生成增量修改"}
        </button>
        {error && <div className="error">{error}</div>}
        {previousCode && code !== previousCode && (
          <div className="diff-toggle">
            <button onClick={() => setShowDiff(!showDiff)}>
              {showDiff ? "隐藏代码差异" : "显示代码差异"}
            </button>
          </div>
        )}
        <div className="code-section">
          <Editor
            height="100%"
            defaultLanguage="javascript"
            value={code}
            onChange={(value) => value !== undefined && setCode(value)}
            onMount={handleEditorDidMount}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              wordWrap: "on",
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
        </div>
      </div>

      <div className="preview">
        <ThreeScene code={code} />
      </div>

      {/* Display code diff when showDiff is true */}
      {showDiff && diff && (
        <div className="diff-viewer">
          <pre>{diff}</pre>
        </div>
      )}
    </div>
  );
}
