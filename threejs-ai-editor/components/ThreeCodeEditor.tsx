import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useSceneStore } from "../stores/useSceneStore";
import { Editor, OnMount } from "@monaco-editor/react";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";

interface ApiResponse {
  error?: string;
  message?: string;
  directCode?: string;
  patch?: string;
  modelUrl?: string;
  modelUrls?: string[];
  sceneHistory?: {
    history: Array<{
      timestamp: string;
      prompt: string;
      objectCount: number;
      objects: Array<{
        id: string;
        type: string;
        name: string;
        position?: number[];
      }>;
    }>;
    lastUpdateTimestamp?: string;
  };
  // Add other fields you expect from the API
}

export default function ThreeCodeEditor() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const threeRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls?: OrbitControls;
    gltfLoader?: GLTFLoader;
    dynamicGroup?: THREE.Group;
  } | null>(null);

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [prompt, setPrompt] = useState("添加一个旋转的红色立方体");
  const [code, setCode] =
    useState(`function setup(scene, camera, renderer, THREE, OrbitControls) {
  // Create a red cube
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  const cube = new THREE.Mesh(geometry, material);
  
  // Set auto rotation
  cube.userData.autoRotate = true;
  
  // Add to scene
  scene.add(cube);
  
  // Create OrbitControls properly
  const controls = OrbitControls.create(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.25;
  
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
  const [loadedModels, setLoadedModels] = useState<
    Array<{ id: string; url: string }>
  >([]);
  const [isModelLoading, setIsModelLoading] = useState(false);

  const {
    addToHistory,
    setScene,
    setDynamicGroup,
    addHistoryEntry,
    serializeSceneState,
  } = useSceneStore();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (threeRef.current) {
      threeRef.current.renderer.dispose();
      container.innerHTML = "";
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);

    const dynamicGroup = new THREE.Group();
    dynamicGroup.name = "ai-generated-objects";
    scene.add(dynamicGroup);

    const camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    camera.position.z = 5;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 5, 5);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    const gridHelper = new THREE.GridHelper(10, 10);
    scene.add(gridHelper);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.25;
    controls.screenSpacePanning = false;
    controls.maxPolarAngle = Math.PI / 2;

    const gltfLoader = new GLTFLoader();

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

    threeRef.current = {
      scene,
      camera,
      renderer,
      controls,
      gltfLoader,
      dynamicGroup,
    };

    setScene(scene);
    setDynamicGroup(dynamicGroup);

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
  }, [setScene, setDynamicGroup]);

  const loadModel = async (modelUrl: string) => {
    if (!threeRef.current || !threeRef.current.gltfLoader) {
      setError("Three.js scene not initialized");
      return false;
    }

    try {
      setIsModelLoading(true);

      if (loadedModels.some((model) => model.url === modelUrl)) {
        console.log("Model already loaded:", modelUrl);
        setIsModelLoading(false);
        return true;
      }

      console.log("Loading 3D model from URL:", modelUrl);

      const { scene, camera } = threeRef.current;
      const loader = threeRef.current.gltfLoader;

      loader.setCrossOrigin("anonymous");

      return new Promise<boolean>((resolve) => {
        fetch("/api/proxy-model", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url: modelUrl }),
        })
          .then((response) => {
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.arrayBuffer();
          })
          .then((buffer) => {
            console.log(
              "Received model buffer, size:",
              buffer.byteLength,
              "bytes"
            );
            loader.parse(
              buffer,
              "",
              (gltf) => {
                try {
                  console.log("Model parsed successfully:", gltf);
                  const model = gltf.scene;

                  // 为每个新模型计算唯一位置
                  const existingModels = scene.children.filter(
                    (child) => child.userData.modelId
                  );

                  // 默认位置
                  let position = { x: 0, y: 0, z: 0 };

                  // 如果已有模型，计算新位置
                  if (existingModels.length > 0) {
                    // 在半径为3的圆上放置模型
                    const angle = Math.random() * Math.PI * 2;
                    const radius = 3 + Math.random() * 2; // 半径3-5之间随机
                    position = {
                      x: Math.cos(angle) * radius,
                      y: 0, // 保持y=0使模型在同一平面
                      z: Math.sin(angle) * radius,
                    };
                  }

                  model.position.set(position.x, position.y, position.z);

                  model.traverse((node: THREE.Object3D) => {
                    if ((node as THREE.Mesh).isMesh) {
                      console.log(
                        "Applied shadows to mesh:",
                        (node as THREE.Mesh).name || "unnamed mesh"
                      );
                      (node as THREE.Mesh).castShadow = true;
                      (node as THREE.Mesh).receiveShadow = true;
                    }
                  });

                  scene.add(model);
                  console.log(
                    "Model added to scene with position:",
                    model.position
                  );

                  const box = new THREE.Box3().setFromObject(model);
                  const helper = new THREE.Box3Helper(
                    box,
                    new THREE.Color(0xff0000)
                  );
                  scene.add(helper);
                  console.log("Added bounding box helper to model");

                  fitCameraToModel(camera, model);

                  const modelId = `model_${Date.now()}`;
                  model.userData.modelId = modelId;
                  setLoadedModels((prev) => [
                    ...prev,
                    { id: modelId, url: modelUrl },
                  ]);

                  console.log("Model loaded successfully through proxy");
                  setIsModelLoading(false);
                  resolve(true);
                } catch (err) {
                  console.error("Error processing model data:", err);
                  setError(
                    `Error processing model: ${
                      err instanceof Error ? err.message : String(err)
                    }`
                  );
                  setIsModelLoading(false);
                  resolve(false);
                }
              },
              (event: ErrorEvent) => {
                console.error("Error loading model:", event);
                setError(
                  `Failed to load model: ${
                    event instanceof ErrorEvent ? event.message : String(event)
                  }`
                );
                setIsModelLoading(false);
                resolve(false);
              }
            );
          })
          .catch((err) => {
            console.error("Error fetching model:", err);
            setError(
              `Failed to fetch model: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
            setIsModelLoading(false);
            resolve(false);
          });
      });
    } catch (err) {
      console.error("Error initiating model load:", err);
      setError(
        `Model loading error: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      setIsModelLoading(false);
      return false;
    }
  };

  const fitCameraToModel = (
    camera: THREE.PerspectiveCamera,
    model: THREE.Object3D
  ) => {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / Math.sin(fov / 2));

    cameraZ *= 1.5;

    const oldPosition = { ...camera.position };
    camera.position.set(center.x, center.y, center.z + cameraZ);
    console.log("Camera position adjusted:", {
      from: oldPosition,
      to: { ...camera.position },
      lookAt: { ...center },
    });

    camera.lookAt(center);
    camera.updateProjectionMatrix();
  };

  useEffect(() => {
    if (!code) return;

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

          if (lintResult.errors && lintResult.errors.length > 0) {
            renderLintErrorsIndicator(lintResult.errors);
          } else {
            clearLintErrorsIndicator();
          }
        }
      } catch (err) {
        console.error("Error running lint:", err);
      }
    };

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

    clearLintErrorsIndicator();

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

    errorIndicator.onclick = () => setLintOverlayVisible(!lintOverlayVisible);

    const container = canvas.parentElement;
    if (container) {
      container.style.position = "relative";
      container.appendChild(errorIndicator);
    }

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

    try {
      const { scene, camera, renderer, dynamicGroup } = threeRef.current;
      if (!scene || !camera || !renderer || !dynamicGroup) {
        console.warn("Scene, camera, renderer or dynamicGroup not available");
        return;
      }

      let customControlsCreated = false;

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

      if (!validateCode(code)) {
        setError("代码不完整或包含语法错误，请检查代码");
        return;
      }

      try {
        const sanitizedCode = code.trim();

        const functionBody = `
          let setup;
          try {
            ${sanitizedCode}
            if (typeof setup !== 'function') {
              throw new Error('setup function not defined in code');
            }
            return setup;
          } catch(e) {
            console.error("Setup function parsing error:", e);
            throw e;
          }
        `;

        const OrbitControlsWrapper = {
          create: function (cam: THREE.Camera, domElement: HTMLElement) {
            if (threeRef.current && threeRef.current.controls) {
              return threeRef.current.controls;
            }
            customControlsCreated = true;
            return new OrbitControls(cam, domElement);
          },
        };

        const ExtendedTHREE = { ...THREE } as typeof THREE & {
          GLTFLoader?: typeof GLTFLoader;
        };
        if (threeRef.current.gltfLoader) {
          ExtendedTHREE.GLTFLoader = GLTFLoader;
        }

        let getSetupFn;
        try {
          getSetupFn = Function(
            "scene",
            "camera",
            "renderer",
            "THREE",
            "OrbitControls",
            "GLTFLoader",
            functionBody
          );
        } catch (syntaxError) {
          console.error("代码语法错误:", syntaxError);
          setError(
            "代码语法错误: " +
              (syntaxError instanceof Error
                ? syntaxError.message
                : String(syntaxError))
          );
          return;
        }

        let setupFn;
        try {
          setupFn = getSetupFn(
            null,
            null,
            null,
            ExtendedTHREE,
            OrbitControlsWrapper,
            GLTFLoader
          );
        } catch (execError) {
          console.error("Setup函数执行错误:", execError);
          setError(
            "Setup函数执行错误: " +
              (execError instanceof Error
                ? execError.message
                : String(execError))
          );
          return;
        }

        if (typeof setupFn !== "function") {
          throw new Error("setup function not found in code");
        }

        try {
          setupFn(
            dynamicGroup,
            camera,
            renderer,
            ExtendedTHREE,
            OrbitControlsWrapper,
            GLTFLoader
          );
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
      } catch (e) {
        console.error("代码评估错误:", e);
        setError(
          "代码评估错误: " + (e instanceof Error ? e.message : String(e))
        );
      }
    } catch (e) {
      console.error("场景处理错误:", e);
      setError("场景处理错误: " + (e instanceof Error ? e.message : String(e)));
    }
  }, [code, addToHistory, error]);

  const captureScreenshot = async () => {
    console.log("[Screenshot] Starting screenshot capture process...");
    if (!threeRef.current) {
      console.warn("[Screenshot] Failed: Three.js scene not initialized");
      return null;
    }

    const { scene, camera, renderer } = threeRef.current;
    if (!scene || !camera || !renderer) {
      console.warn("[Screenshot] Failed: Three.js components incomplete", {
        hasScene: !!scene,
        hasCamera: !!camera,
        hasRenderer: !!renderer,
      });
      return null;
    }

    try {
      console.log("[Screenshot] Rendering scene before capture...");
      renderer.render(scene, camera);

      const canvas = renderer.domElement;
      if (!canvas) {
        console.warn("[Screenshot] Failed: Canvas element not found");
        return null;
      }

      console.log("[Screenshot] Converting canvas to base64...");
      const imageBase64 = canvas.toDataURL("image/png");
      console.log(
        "[Screenshot] Base64 data generated, length:",
        imageBase64.length,
        "bytes"
      );

      if (
        imageBase64 === "data:," ||
        !imageBase64.startsWith("data:image/png;base64,")
      ) {
        console.error("[Screenshot] Invalid base64 data format", {
          isEmpty: imageBase64 === "data:",
          hasCorrectPrefix: imageBase64.startsWith("data:image/png;base64,"),
        });
        return null;
      }

      console.log("[Screenshot] Successfully captured scene");
      return imageBase64;
    } catch (err) {
      console.error("[Screenshot] Capture failed with error:", err, {
        errorType: err instanceof Error ? err.constructor.name : typeof err,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      setError(
        "无法捕获场景截图: " +
          (err instanceof Error ? err.message : String(err))
      );
      return null;
    }
  };

  const validateCode = (codeToValidate: string) => {
    const hasSetupFn = codeToValidate.includes("function setup");

    const openBraces = (codeToValidate.match(/\{/g) || []).length;
    const closeBraces = (codeToValidate.match(/\}/g) || []).length;
    const balancedBraces = openBraces === closeBraces;

    const hasValidSyntax = (() => {
      try {
        new Function(`"use strict"; ${codeToValidate}`);
        return true;
      } catch (e) {
        console.error("代码语法检查失败:", e);
        return false;
      }
    })();

    return hasSetupFn && balancedBraces && hasValidSyntax;
  };

  const handleGenerate = async () => {
    if (!prompt) {
      setError("请输入指令");
      return;
    }

    try {
      setIsLoading(true);
      setError("");

      console.log(
        "[Screenshot] Initiating screenshot capture for scene analysis..."
      );
      const imageBase64 = await captureScreenshot();
      console.log(
        "[Screenshot] Screenshot capture completed:",
        imageBase64 ? "Success" : "Failed"
      );

      const sceneState = serializeSceneState();

      // 获取场景历史数据
      let sceneHistory = null;
      try {
        const historyResponse = await fetch("/api/memory-state");
        if (historyResponse.ok) {
          const historyData = await historyResponse.json();
          if (historyData.success && historyData.memoryState.sceneHistory) {
            sceneHistory = historyData.memoryState.sceneHistory;
          }
        }
      } catch (historyError) {
        console.warn("Failed to fetch scene history:", historyError);
      }

      try {
        const response = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "analyze-screenshot",
            code,
            prompt,
            screenshot: imageBase64,
            sceneState,
            sceneHistory, // 将场景历史传递给 API
            lintErrors: lintErrors.length > 0 ? lintErrors : undefined,
          }),
        });

        if (!response.ok) {
          throw new Error(`API responded with status: ${response.status}`);
        }

        const data: ApiResponse = await response.json();
        console.log("API response data:", data);

        const modelUrls: string[] = [];

        if (data.modelUrl) {
          console.log("Model URL received:", data.modelUrl);
          setIsModelLoading(true);
          const modelLoaded = await loadModel(data.modelUrl);
          console.log("Model loading result:", modelLoaded);
          setIsModelLoading(false);

          modelUrls.push(data.modelUrl);
        }

        if (data.directCode) {
          setPreviousCode(code);

          const newCode = `${code}\n\n/* AI 新增代码 - ${new Date().toLocaleString()} */\n${
            data.directCode
          }`;
          setCode(newCode);

          addHistoryEntry(newCode, modelUrls);

          if (data.patch) {
            setDiff(data.patch);
          } else {
            const diffLines = data.directCode
              .split("\n")
              .filter((line, i) => {
                const oldLines = code.split("\n");
                return i >= oldLines.length || line !== oldLines[i];
              })
              .join("\n");
            setDiff(diffLines);
          }
        } else if (data.error) {
          throw new Error(data.error);
        }

        if (data.directCode && !data.modelUrl) {
          const hyper3dMatches = data.directCode.match(
            /['"]https:\/\/hyperhuman-file\.deemos\.com\/[^'"]+\.glb[^'"]*['"]/g
          );

          if (hyper3dMatches && hyper3dMatches.length > 0) {
            const modelUrl = hyper3dMatches[0].replace(/^['"]|['"]$/g, "");
            console.log("从代码中提取到模型URL:", modelUrl);

            setIsModelLoading(true);
            const modelLoaded = await loadModel(modelUrl);
            console.log(
              "Model loading result from code extraction:",
              modelLoaded
            );
            setIsModelLoading(false);

            modelUrls.push(modelUrl);

            if (modelLoaded) {
              addHistoryEntry(code, modelUrls);
            }
          }
        }
      } catch (error) {
        console.error("生成错误:", error);
        setError(
          "生成错误: " +
            (error instanceof Error ? error.message : String(error))
        );
      }
    } catch (error) {
      console.error("生成错误:", error);
      setError(
        "生成错误: " + (error instanceof Error ? error.message : String(error))
      );
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
          placeholder="例如: 添加一个旋转的红色球体 或 生成一只红色的猫"
          rows={4}
        />
        <div className="button-group">
          <button
            onClick={handleGenerate}
            disabled={isLoading || isModelLoading}
          >
            {isLoading ? "生成中..." : "生成场景代码"}
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        {isModelLoading && (
          <div className="loading-model">
            <span className="loading-spinner"></span>
            <span>加载3D模型中...</span>
          </div>
        )}
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
            value={showDiff && diff ? diff : code}
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

      <style jsx>{`
        .button-group {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
      `}</style>
    </div>
  );
}
