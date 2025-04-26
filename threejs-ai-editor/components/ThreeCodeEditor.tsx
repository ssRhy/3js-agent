import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useSceneStore } from "../stores/useSceneStore";
import { Editor, OnMount } from "@monaco-editor/react";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

interface ApiResponse {
  error?: string;
  message?: string;
  directCode?: string;
  patch?: string;
  // Add other fields you expect from the API
}

export default function ThreeCodeEditor() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const threeRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls?: OrbitControls;
  } | null>(null);

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [prompt, setPrompt] = useState("添加一个旋转的红色立方体");
  const [code, setCode] =
    useState(`function setup(scene, camera, renderer, THREE, OrbitControls) {
    // 创建基本几何体
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x44aa88 });
    const cube = new THREE.Mesh(geometry, material);
    cube.userData.autoRotate = true;
    scene.add(cube);

    // 使用OrbitControls，确保通过create方法创建控制器
    if (OrbitControls) {
      // 通过create方法获取或创建一个新的控制器实例
      const controls = OrbitControls.create(camera, renderer.domElement);
      if (controls) {
        controls.enableDamping = true;
      }
    }
  
    return cube;
  }`);
  const [previousCode, setPreviousCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showDiff, setShowDiff] = useState(false);
  const [diff, setDiff] = useState<string>("");
  const [lintErrors, setLintErrors] = useState<
    {
      ruleId: string | null;
      severity: number;
      message: string;
      line: number;
      column: number;
    }[]
  >([]);
  const [lintOverlayVisible, setLintOverlayVisible] = useState(false);

  const { addToHistory } = useSceneStore();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (threeRef.current) {
      threeRef.current.renderer.dispose();
      container.innerHTML = "";
    }

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

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 5, 5);
    scene.add(directionalLight);

    const gridHelper = new THREE.GridHelper(10, 10);
    scene.add(gridHelper);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.25;
    controls.screenSpacePanning = false;
    controls.maxPolarAngle = Math.PI / 2;

    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
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

  // Run ESLint on code changes
  useEffect(() => {
    if (!code) return;

    // Run lint and send results to agent
    const lintCode = async () => {
      try {
        const response = await fetch("/api/lint", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });

        if (response.ok) {
          const lintResult = await response.json();
          setLintErrors(lintResult.errors || []);

          // Only send lint errors to agent if there are any
          if (lintResult.errors && lintResult.errors.length > 0) {
            // Add visual indicator on the Three.js canvas
            renderLintErrorsIndicator(lintResult.errors);
          } else {
            // Clear visual indicator if no errors
            clearLintErrorsIndicator();
          }
        }
      } catch (err) {
        console.error("Error running lint:", err);
      }
    };

    // Debounce lint checking
    const debounceTimeout = setTimeout(() => {
      lintCode();
    }, 1000);

    return () => clearTimeout(debounceTimeout);
  }, [code]);

  const renderLintErrorsIndicator = (
    errors: {
      ruleId: string | null;
      severity: number;
      message: string;
      line: number;
      column: number;
    }[]
  ) => {
    if (!threeRef.current || errors.length === 0) return;

    const { scene, renderer } = threeRef.current;

    // Clear any previous lint error indicators
    clearLintErrorsIndicator();

    // Create the error indicator in the corner of the canvas
    const canvas = renderer.domElement;
    const errorIndicator = document.createElement("div");
    errorIndicator.id = "lint-error-indicator";
    errorIndicator.style.position = "absolute";
    errorIndicator.style.top = "10px";
    errorIndicator.style.right = "10px";
    errorIndicator.style.backgroundColor = "rgba(255, 0, 0, 0.7)";
    errorIndicator.style.color = "white";
    errorIndicator.style.padding = "5px 10px";
    errorIndicator.style.borderRadius = "4px";
    errorIndicator.style.fontFamily = "monospace";
    errorIndicator.style.cursor = "pointer";
    errorIndicator.style.zIndex = "1000";
    errorIndicator.innerText = `${errors.length} ESLint ${
      errors.length === 1 ? "error" : "errors"
    }`;

    // Add click handler to toggle detailed view
    errorIndicator.onclick = () => setLintOverlayVisible(!lintOverlayVisible);

    // Add to canvas container
    const container = canvas.parentElement;
    if (container) {
      container.style.position = "relative";
      container.appendChild(errorIndicator);
    }

    // Render the scene to show the indicator
    renderer.render(scene, threeRef.current.camera);
  };

  const clearLintErrorsIndicator = () => {
    const existingIndicator = document.getElementById("lint-error-indicator");
    if (existingIndicator && existingIndicator.parentElement) {
      existingIndicator.parentElement.removeChild(existingIndicator);
    }
  };

  useEffect(() => {
    if (!threeRef.current || !code) return;
    if (code === "") return;

    const { scene, camera, renderer } = threeRef.current;
    let customControlsCreated = false;

    try {
      const objectsToRemove: THREE.Mesh[] = [];
      scene.children.forEach((child) => {
        if (
          child instanceof THREE.Mesh &&
          !(child instanceof THREE.GridHelper)
        ) {
          objectsToRemove.push(child);
        }
      });

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

      const isSafeCode =
        code.includes("function setup") &&
        code.match(/\{/g)?.length === code.match(/\}/g)?.length;

      if (!isSafeCode) {
        setError("代码不完整或格式有误，请检查代码");
        return;
      }

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

      // Create a wrapper for OrbitControls to prevent direct instantiation
      const OrbitControlsWrapper = {
        create: function (cam: THREE.Camera, domElement: HTMLElement) {
          if (threeRef.current && threeRef.current.controls) {
            return threeRef.current.controls;
          }
          customControlsCreated = true;
          return new OrbitControls(cam, domElement);
        },
      };

      const getSetupFn = Function(
        "scene",
        "camera",
        "renderer",
        "THREE",
        "OrbitControls",
        functionBody
      );

      const setupFn = getSetupFn(null, null, null, THREE, OrbitControlsWrapper);

      if (typeof setupFn !== "function") {
        throw new Error("setup function not found in code");
      }

      if (THREE && scene && camera && renderer) {
        try {
          setupFn(scene, camera, renderer, THREE, OrbitControlsWrapper);
          renderer.render(scene, camera);
          addToHistory(code);

          if (error) setError("");
          if (
            customControlsCreated &&
            threeRef.current &&
            threeRef.current.controls
          ) {
            console.warn(
              "警告: 检测到同时存在多个OrbitControls实例，可能会导致控制冲突"
            );
          }
        } catch (e) {
          console.error("代码执行错误:", e);
          setError(
            "代码执行错误: " + (e instanceof Error ? e.message : String(e))
          );
        }
      }
    } catch (e) {
      console.error("场景清理错误:", e);
      setError("场景清理错误: " + (e instanceof Error ? e.message : String(e)));
    }
  }, [code, addToHistory, error]);

  const captureScreenshot = async () => {
    if (!threeRef.current) return null;

    try {
      // 强制渲染一次当前场景状态
      const { scene, camera, renderer } = threeRef.current;
      renderer.render(scene, camera);

      // 获取画布并截图
      const canvas = renderer.domElement;

      // 直接使用canvas的toDataURL方法
      const imageBase64 = canvas.toDataURL("image/png");
      console.log("获取到截图数据，长度:", imageBase64.length);

      // 简单验证截图是否有效
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

      const imageBase64 = await captureScreenshot();

      // 获取代码历史上下文
      const historyContext = "";
      try {
        // Add code to get history context if needed
      } catch (err) {
        console.error("获取历史上下文出错:", err);
      }

      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          currentCode: code,
          image: imageBase64,
          historyContext,
          lintErrors: lintErrors.length > 0 ? lintErrors : undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          errorData.message || errorData.error || response.statusText;
        throw new Error("API请求失败: " + errorMessage);
      }

      const data = (await response.json()) as ApiResponse;
      if (data.error) {
        setError(data.message || data.error || "API返回错误");
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

      <div className="preview" ref={containerRef}></div>

      {/* Display code diff when showDiff is true */}
      {showDiff && diff && (
        <div className="diff-viewer">
          <pre>{diff}</pre>
        </div>
      )}

      {/* ESLint errors overlay */}
      {lintOverlayVisible && lintErrors.length > 0 && (
        <div className="lint-overlay">
          <div className="lint-overlay-content">
            <h3>ESLint 检查结果</h3>
            <button
              onClick={() => setLintOverlayVisible(false)}
              className="close-button"
            >
              ×
            </button>
            <ul className="lint-errors-list">
              {lintErrors.map((error, index) => (
                <li key={index} className="lint-error-item">
                  <span className="lint-error-location">
                    行 {error.line}:{error.column}
                  </span>
                  <span className="lint-error-message">{error.message}</span>
                  <span className="lint-error-rule">{error.ruleId}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
