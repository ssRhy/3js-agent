import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
// 不再直接导入diff库，而是使用applyDiff工具
// import { parsePatch, applyPatch } from "diff";
import { useSceneStore } from "../stores/useSceneStore";
import { Editor, OnMount } from "@monaco-editor/react";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

export default function ThreeCodeEditor() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const threeRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls?: OrbitControls;
  } | null>(null);

  // 使用monaco editor的正确类型，但不创建未使用的state
  // 如果您确实需要编辑器引用，可以使用这个ref
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  // 用户prompt和代码状态
  const [prompt, setPrompt] = useState("添加一个旋转的红色立方体");
  const [code, setCode] = useState(`function setup(scene, camera, renderer) {
  // 创建一个简单的立方体
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0x44aa88 });
  const cube = new THREE.Mesh(geometry, material);
  cube.userData.autoRotate = true;
  scene.add(cube);
  
  return cube;
}`);
  const [previousCode, setPreviousCode] = useState(""); // 存储上一次的代码
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showDiff, setShowDiff] = useState(false); // 控制是否显示对比

  // 从全局状态获取历史记录
  const { addToHistory } = useSceneStore();

  // 初始化Three.js
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 清理旧的渲染器
    if (threeRef.current) {
      threeRef.current.renderer.dispose();
      container.innerHTML = "";
    }

    // 创建新场景
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);

    const camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    camera.position.z = 5;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    // 添加基本灯光
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);

    // 添加网格地面
    const gridHelper = new THREE.GridHelper(10, 10);
    scene.add(gridHelper);

    // 添加OrbitControls以支持手动旋转
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; // 添加阻尼效果使旋转更平滑
    controls.dampingFactor = 0.25;
    controls.screenSpacePanning = false;
    controls.maxPolarAngle = Math.PI / 2; // 限制垂直旋转角度

    // 动画循环
    const animate = () => {
      requestAnimationFrame(animate);

      // 更新OrbitControls
      controls.update();

      // 更新场景中的物体（如旋转）
      scene.children.forEach((child) => {
        if (child.userData.autoRotate) {
          child.rotation.x += 0.01;
          child.rotation.y += 0.01;
        }
      });

      renderer.render(scene, camera);
    };
    animate();

    threeRef.current = { scene, camera, renderer, controls };

    // 响应窗口大小变化
    const handleResize = () => {
      if (!threeRef.current || !container) return;

      const { camera, renderer } = threeRef.current;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
    };
  }, []);

  // 当代码变化时应用到场景
  useEffect(() => {
    if (!threeRef.current || !code) return;

    // 防止空字符串过渡期间的执行
    if (code === "") return;

    const { scene, camera, renderer } = threeRef.current;
    console.log("应用新代码到场景:", code);

    try {
      // 清空场景中的网格物体，保留灯光和辅助工具
      const objectsToRemove: THREE.Mesh[] = [];
      scene.children.forEach((child) => {
        if (
          child instanceof THREE.Mesh &&
          !(child instanceof THREE.GridHelper)
        ) {
          objectsToRemove.push(child);
        }
      });

      // 单独进行移除操作，避免在遍历时修改集合
      objectsToRemove.forEach((obj) => {
        scene.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m: THREE.Material) => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });

      try {
        // 使用更安全的方式执行用户代码
        const functionBody = `
          let setup;
          try {
            ${code}
            if (typeof setup !== 'function') {
              throw new Error('setup function not defined in code');
            }
            return setup;
          } catch(e) {
            console.error("Setup function parsing error:", e);
            throw e;
          }
        `;

        // 创建Function实例，避免使用eval
        const getSetupFn = Function(
          "scene",
          "camera",
          "renderer",
          "THREE",
          "OrbitControls",
          functionBody
        );

        // 执行函数获取setup函数
        const setupFn = getSetupFn(null, null, null, THREE, OrbitControls);

        if (typeof setupFn !== "function") {
          throw new Error("setup function not found in code");
        }

        // 执行用户代码
        if (THREE && scene && camera && renderer) {
          try {
            if (typeof setupFn === "function") {
              setupFn(scene, camera, renderer, THREE, OrbitControls);
            }

            console.log("代码执行成功", scene.children);

            // 确保渲染器重新渲染一次
            renderer.render(scene, camera);

            // 保存到历史记录
            addToHistory(code);

            // 清除错误（如果之前有的话）
            if (error) setError("");
          } catch (e) {
            console.error("代码执行错误:", e);
            setError(
              "代码执行错误: " + (e instanceof Error ? e.message : String(e))
            );
          }
        }
      } catch (e) {
        console.error("场景清理错误:", e);
        setError(
          "场景清理错误: " + (e instanceof Error ? e.message : String(e))
        );
      }
    } catch (e) {
      console.error("场景清理错误:", e);
      setError("场景清理错误: " + (e instanceof Error ? e.message : String(e)));
    }
  }, [code, addToHistory, error]);

  // 确保更新后组件重新渲染
  useEffect(() => {
    console.log("组件状态更新:", { code: code.length, isLoading });
  }, [code, isLoading]);

  // 发送AI请求生成增量更新
  const handleGenerate = async () => {
    if (!prompt) {
      setError("请输入指令");
      return;
    }

    try {
      setIsLoading(true);
      setError("");

      console.log("正在发送请求到 /api/agent", { prompt });

      // 在每次请求开始时记录当前的代码状态
      console.log("当前代码状态:", {
        codeLength: code.length,
        codeStart: code.substring(0, 50),
        codeEnd: code.substring(code.length - 50),
      });

      // 保存当前代码以便对比
      setPreviousCode(code);

      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, currentCode: code }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          errorData.message || errorData.error || response.statusText;
        throw new Error("API请求失败: " + errorMessage);
      }

      const data = await response.json();
      console.log("API返回结果:", data);

      // 处理API返回的错误消息
      if (data.error) {
        setError(data.message || data.error || "API返回错误");
        console.error("API错误:", data);
        return;
      }

      // 处理补丁解析错误
      if (data.patchError) {
        setError(data.message || "补丁解析失败");
        console.warn("补丁错误:", data);
        return;
      }

      // 处理直接返回的代码（当diff解析失败时）
      if (data.directCode) {
        console.log("收到直接代码:", data.directCode);
        if (data.directCode !== code) {
          // 强制刷新状态以确保UI更新
          setCode("");
          setTimeout(() => {
            setCode(data.directCode);
          }, 10);

          if (data.message) {
            console.info(data.message);
          }
        } else {
          setError("返回的代码与当前代码相同");
          console.warn("返回的代码与当前代码相同");
        }
        return;
      }

      // 处理diff并应用到当前代码
      if (data.patch) {
        console.log("收到的补丁:", data.patch);
        try {
          // 导入applyDiff工具
          const { applyDiff } = await import("../utils/applyDiff");

          // 直接使用工具函数应用补丁
          const newCode = applyDiff(code, data.patch);
          console.log("应用补丁后的新代码:", newCode);

          if (newCode !== code) {
            // 强制刷新状态以确保UI更新
            setCode("");
            setTimeout(() => {
              setCode(newCode);
            }, 10);
          } else {
            setError("补丁应用后代码没有变化");
            console.warn("补丁应用后代码没有变化");
          }
        } catch (error) {
          console.error("应用补丁错误:", error);
          setError(
            "应用补丁失败: " +
              (error instanceof Error ? error.message : String(error))
          );
        }
      } else {
        setError("API返回的数据中没有补丁或直接代码");
        console.error("API返回的数据中没有补丁或直接代码", data);
      }
    } catch (err) {
      console.error("生成代码错误:", err);
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setIsLoading(false);
    }
  };

  // 明确指定编辑器挂载处理函数的类型
  const handleEditorDidMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  return (
    <div className="editor-container">
      <div className="sidebar">
        <h2>Three.js AI 编辑器</h2>
        <div className="input-group">
          <label>输入你的指令:</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例如: 添加一个旋转的红色球体"
            rows={4}
          />
        </div>

        <button
          onClick={handleGenerate}
          disabled={isLoading}
          className="generate-btn"
        >
          {isLoading ? "生成中..." : "生成增量修改"}
        </button>

        {error && <div className="error">{error}</div>}

        <div className="controls-help">
          <p>提示: 您可以使用鼠标拖拽来旋转场景，滚轮缩放，按住Shift键平移。</p>
        </div>

        {previousCode && code !== previousCode && (
          <div className="diff-toggle">
            <button
              onClick={() => setShowDiff(!showDiff)}
              className="diff-toggle-btn"
            >
              {showDiff ? "隐藏代码差异" : "显示代码差异"}
            </button>
            {showDiff && (
              <div className="diff-info">
                <p>
                  AI进行了增量代码修改，而不是完全重写。这保留了您之前定义的特性和逻辑。
                </p>
              </div>
            )}
          </div>
        )}

        <div className="code-section">
          <label>当前代码:</label>
          <div className="monaco-container">
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
      </div>

      <div className="preview" ref={containerRef}></div>
    </div>
  );
}
