import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useSceneStore } from "../stores/useSceneStore";
import { Editor, OnMount } from "@monaco-editor/react";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import ObjectManipulationControls from "./ObjectManipulationControls";
import UnifiedExportTools from "./UnifiedExportTools";

import { useSocketStore } from "../lib/socket";
import { preprocessCode } from "../lib/processors/codeProcessor";

interface SceneStateObject {
  id: string;
  type: string;
  name?: string;
  position?: number[];
  rotation?: number[];
  scale?: number[];
  [key: string]: unknown; // Replace any with unknown for better type safety
}

// 修复RequestPayload中的sceneState类型
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface RequestPayload {
  action: string;
  code: string;
  prompt: string;
  lintErrors: {
    ruleId: string | null;
    severity: number;
    message: string;
    line: number;
    column: number;
  }[];
  renderingComplete: boolean;
  screenshot?: string;
  sceneState?: SceneStateObject[];
}

export default function ThreeCodeEditor() {
  // Socket.IO 连接状态
  const [socketConnectionStatus, setSocketConnectionStatus] = useState<
    "connecting" | "open" | "closed" | "error"
  >("connecting");

  // 跟踪最后一次心跳时间
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 获取 Socket 存储方法
  const { setConnectionError, connect } = useSocketStore();

  // Function to reconnect manually
  const manualReconnect = () => {
    // Reset connection state
    setSocketConnectionStatus("connecting");
    setConnectionError(null);

    // Force reconnection by refreshing the page
    window.location.reload();
  };

  // Socket.IO 初始化
  useEffect(() => {
    // 初始化连接
    connect();

    // 设置Socket连接状态监听
    const { socket } = useSocketStore.getState();
    if (socket) {
      // 使用Socket.IO的内置事件监听连接状态
      const handleConnect = () => {
        console.log("[ThreeEditor] Socket.IO connected");
        setSocketConnectionStatus("open");
      };

      const handleDisconnect = () => {
        console.log("[ThreeEditor] Socket.IO disconnected");
        setSocketConnectionStatus("closed");
      };

      const handleError = (err: Error) => {
        console.error("[ThreeEditor] Socket.IO error:", err);
        setSocketConnectionStatus("error");
        setConnectionError(err.message);
      };

      // 立即检查当前连接状态
      if (socket.connected) {
        setSocketConnectionStatus("open");
      }

      // 添加事件监听器
      socket.on("connect", handleConnect);
      socket.on("disconnect", handleDisconnect);
      socket.on("error", handleError);

      // Socket.IO客户端特定的连接事件
      socket.on("connection_established", (data) => {
        console.log("[ThreeEditor] Server confirmed connection:", data);
        setSocketConnectionStatus("open");
      });

      // 监听服务器心跳响应，确保连接稳定
      socket.on("pong", () => {
        // 更新最后心跳时间
        setSocketConnectionStatus("open");
      });
    }

    // 设置心跳检测，确保连接稳定
    heartbeatIntervalRef.current = setInterval(() => {
      const { socket } = useSocketStore.getState();
      if (socket && socket.connected) {
        socket.emit("ping");
      }
    }, 60000); // 60秒一次心跳，减少不必要的网络通信

    // 清理函数
    return () => {
      const { disconnect, socket } = useSocketStore.getState();

      // 清理事件监听器
      if (socket) {
        socket.off("connect");
        socket.off("disconnect");
        socket.off("error");
        socket.off("connection_established");
        socket.off("pong");
      }

      disconnect();

      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
    };
  }, [connect, setConnectionError]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const threeRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls?: OrbitControls;
    gltfLoader?: GLTFLoader;
    dynamicGroup?: THREE.Group;
    animationId: number | null;
    objects: Record<string, THREE.Object3D>;
  } | null>(null);

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [prompt, setPrompt] = useState<string>("");
  const [code, setCode] =
    useState(`function setup(scene, camera, renderer, THREE, OrbitControls) {
  // Create OrbitControls
  const controls = OrbitControls.create(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.25;
  
  // 注意: 可以使用全局的 autoScaleModel 函数来调整加载的模型大小
  // 示例: 在模型加载后调用 autoScaleModel(model, desiredSize)
  // desiredSize 参数表示期望的模型最长边长度（默认为5个单位）
  
  // Return the scene so that all future objects added to it will be rendered
  return scene;
}`);
  // ... existing code ...
  const [previousCode] = useState("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState("");
  const [showDiff, setShowDiff] = useState(false);

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
    { id: string; url: string }[]
  >([]);
  const [isModelLoading, setIsModelLoading] = useState<boolean>(false);
  // 添加一个新的状态用于存储所有用过的模型URL，包括加载失败的
  const [allModelUrls, setAllModelUrls] = useState<
    { url: string; lastUsed: Date }[]
  >([]);

  const {
    addToHistory,
    setScene,
    setDynamicGroup,
    serializeSceneState,
    isDraggingOrSelecting,
    setIsDraggingOrSelecting,
  } = useSceneStore();

  // Add rendering complete flag
  const renderingCompleteRef = useRef<boolean>(false);

  // 添加success状态
  const [success, setSuccess] = useState("");

  // 定义diff变量
  const [diff] = useState("");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (threeRef.current) {
      threeRef.current.renderer.dispose();
      container.innerHTML = "";
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1e1e1e);

    const dynamicGroup = new THREE.Group();
    dynamicGroup.name = "dynamicObjects";
    scene.add(dynamicGroup);

    const camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    camera.position.set(5, 5, 5);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true, // Needed for screenshots
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(5, 5, 5);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    const gridHelper = new THREE.GridHelper(30, 30, 0x444444, 0x222222);
    gridHelper.position.y = -0.01; // Slightly below the origin to avoid z-fighting
    gridHelper.material.opacity = 0.5;
    gridHelper.material.transparent = true;
    scene.add(gridHelper);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.25;
    controls.screenSpacePanning = false;
    controls.maxPolarAngle = Math.PI / 2;

    // Store important references in scene.userData for access by manipulation controls
    scene.userData.camera = camera;
    scene.userData.renderer = renderer;
    scene.userData.orbitControls = controls;

    const gltfLoader = new GLTFLoader();

    const animate = () => {
      if (!threeRef.current) return;

      const { scene, camera, renderer, controls } = threeRef.current;
      if (!scene || !camera || !renderer || !controls) return;

      threeRef.current.animationId = requestAnimationFrame(animate);

      // Update controls
      controls.update();

      // Render the scene
      renderer.render(scene, camera);

      // Mark rendering as complete after the first few frames
      // This ensures all assets are loaded and visible
      if (!renderingCompleteRef.current) {
        // 检查场景中的模型是否都已加载完成
        let allModelsLoaded = true;
        let modelCount = 0;
        let loadedModelCount = 0;

        // 检查是否有正在加载的模型
        if (isModelLoading) {
          allModelsLoaded = false;
          console.log(
            "[Rendering] Model is still loading, waiting for completion"
          );
        } else {
          // 检查场景中的模型是否完整
          scene.traverse((child) => {
            // 检查GLTF模型的完整性
            if (child.userData && child.userData.modelId) {
              modelCount++;
              const model = child as THREE.Object3D;
              if (model.visible && model.children.length > 0) {
                loadedModelCount++;
              } else {
                allModelsLoaded = false;
              }
            }
          });

          if (modelCount > 0) {
            console.log(
              `[Rendering] Model load status: ${loadedModelCount}/${modelCount} models ready`
            );
          }
        }

        if (allModelsLoaded) {
          // 使用较长的延迟确保所有纹理和资源都已加载
          // 延长延迟时间以确保更可靠
          setTimeout(() => {
            renderingCompleteRef.current = true;
            console.log(
              "[Rendering] Scene rendering completed and ready for screenshot. All models loaded successfully."
            );
          }, 2000); // 延长至2秒以确保完全加载
        }
      }
    };
    animate();

    threeRef.current = {
      scene,
      camera,
      renderer,
      controls,
      gltfLoader,
      dynamicGroup,
      animationId: null,
      objects: {},
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setScene, setDynamicGroup]);

  const loadModel = async (modelUrl: string, modelSize?: number) => {
    if (!threeRef.current || !threeRef.current.gltfLoader) {
      setError("Three.js scene not initialized");
      return false;
    }

    try {
      // 无论加载成功与否，先将URL添加到allModelUrls中
      setAllModelUrls((prev) => {
        // 检查URL是否已存在
        const exists = prev.some((item) => item.url === modelUrl);
        if (!exists) {
          // 如果不存在则添加
          return [...prev, { url: modelUrl, lastUsed: new Date() }];
        } else {
          // 如果存在则更新使用时间
          return prev.map((item) =>
            item.url === modelUrl ? { ...item, lastUsed: new Date() } : item
          );
        }
      });

      setIsModelLoading(true);

      // 检查是否已经加载了这个URL的模型
      const existingModel = loadedModels.find(
        (model) => model.url === modelUrl
      );
      if (existingModel) {
        // 如果模型已存在，直接返回成功
        console.log("模型已加载，使用现有实例:", modelUrl);
        setIsModelLoading(false);

        // 确保模型在场景中可见
        threeRef.current.scene.traverse((obj) => {
          if (obj.userData && obj.userData.modelId === existingModel.id) {
            obj.visible = true;
            console.log("确保模型可见:", obj.name);
          }
        });

        return true;
      }

      // 确保模型URL经过代理
      let urlToLoad = modelUrl;

      // 如果是外部URL且还未通过代理，则转换为代理URL
      if (
        modelUrl.startsWith("http") &&
        !modelUrl.includes("/api/proxy-model")
      ) {
        console.log("[loadModel] 将外部URL转换为代理URL:", modelUrl);
        urlToLoad = `/api/proxy-model?url=${encodeURIComponent(modelUrl)}`;
      }

      console.log("Loading 3D model from URL:", urlToLoad);
      if (modelSize) {
        console.log(`将调整模型大小为: ${modelSize} 单位`);
      }

      const { scene, camera } = threeRef.current;
      const loader = threeRef.current.gltfLoader;

      loader.setCrossOrigin("anonymous");

      return new Promise<boolean>((resolve) => {
        fetch("/api/proxy-model", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url: urlToLoad }),
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

                  // 计算模型的包围盒以确定其大小
                  const boundingBox = new THREE.Box3().setFromObject(model);
                  const size = boundingBox.getSize(new THREE.Vector3());

                  // 计算模型的高度
                  const modelHeight = size.y;

                  // 如果指定了模型大小，则使用指定值，否则使用默认值(5)
                  autoScaleModel(model, modelSize || 5);

                  // 默认位置：保持垂直居中，将模型放在y=0平面上
                  const position = { x: 0, y: modelHeight / 2, z: 0 };

                  // 应用计算出的位置
                  model.position.set(position.x, position.y, position.z);

                  // 将模型注册到场景状态管理器中以确保持久化
                  const modelId = `model_${Date.now()}`;
                  model.userData.modelId = modelId;
                  model.userData.isModelObject = true; // 添加新标记
                  model.userData.originalModelUrl = modelUrl; // Store URL directly on the model
                  model.userData.originalUrl = modelUrl; // 为兼容性添加
                  model.name = `model_${Date.now()}`;

                  // 其余的模型加载和处理代码保持不变
                  // ... existing code ...

                  model.traverse((node: THREE.Object3D) => {
                    if ((node as THREE.Mesh).isMesh) {
                      console.log(
                        "Applied shadows to mesh:",
                        (node as THREE.Mesh).name || "unnamed mesh"
                      );
                      (node as THREE.Mesh).castShadow = true;
                      (node as THREE.Mesh).receiveShadow = true;

                      // Add modelId to all child meshes for better preservation
                      node.userData.modelId = modelId;
                      // Store original model URL in userData for better persistence
                      node.userData.originalModelUrl = modelUrl;
                    }
                  });

                  scene.add(model);
                  console.log(
                    "Model added to scene with position:",
                    model.position
                  );

                  fitCameraToModel(camera, model);

                  // 使用场景状态管理器注册模型 - 增强元数据以确保持久化
                  if (useSceneStore.getState().registerObject) {
                    const uuid = useSceneStore
                      .getState()
                      .registerObject(model, "GLTFModel", {
                        originalUrl: modelUrl,
                        loadTimestamp: Date.now(),
                        modelSize: modelSize || 5,
                        isLoadedModel: true, // 标记为已加载模型，便于识别
                        modelId: modelId, // 保存modelId到元数据中
                        originalModelUrl: modelUrl, // Add direct URL reference
                      });
                    console.log(`模型已注册到场景状态管理器，UUID: ${uuid}`);
                  }

                  setLoadedModels((prev) => [
                    ...prev,
                    { id: modelId, url: urlToLoad },
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

    // 使用更大的缩放因子，给模型更多空间
    cameraZ *= 2.0;

    // 添加一些随机偏移，使视角更自然
    const offsetAngle = Math.random() * Math.PI * 0.25; // 最多45度偏移
    const cameraX = Math.sin(offsetAngle) * cameraZ * 0.8;
    const adjustedCameraZ = Math.cos(offsetAngle) * cameraZ;

    const oldPosition = { ...camera.position };
    camera.position.set(
      center.x + cameraX,
      center.y + maxDim * 0.4, // 稍微抬高视角
      center.z + adjustedCameraZ
    );
    console.log("Camera position adjusted:", {
      from: oldPosition,
      to: { ...camera.position },
      lookAt: { ...center },
    });

    camera.lookAt(center);
    camera.updateProjectionMatrix();
  };

  // 自动缩放模型到期望大小
  const autoScaleModel = (model: THREE.Object3D, desiredSize: number = 5) => {
    // 计算模型的包围盒以确定当前大小
    const boundingBox = new THREE.Box3().setFromObject(model);
    const size = boundingBox.getSize(new THREE.Vector3());

    // 获取模型当前的最大尺寸
    const maxDimension = Math.max(size.x, size.y, size.z);

    // 如果最大尺寸为0，无法缩放
    if (maxDimension === 0) {
      console.warn("无法缩放模型：模型尺寸为0");
      return;
    }

    // 计算缩放比例
    const scale = desiredSize / maxDimension;

    // 应用缩放
    model.scale.set(scale, scale, scale);

    console.log(
      `模型已缩放: 原始尺寸=${maxDimension.toFixed(
        2
      )}, 目标尺寸=${desiredSize}, 缩放比例=${scale.toFixed(4)}`
    );

    // 返回最终缩放比例，以便于调用者记录或使用
    return scale;
  };

  // 验证代码的函数，检查代码是否包含setup函数、括号是否平衡、语法是否有效
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

  // 预处理代码中的外部URL，防止CORS问题
  const prepareCodeForExecution = (originalCode: string) => {
    // 使用URL处理器预处理代码
    const processedCode = preprocessCode(originalCode);

    // 如果代码被修改，记录日志
    if (originalCode !== processedCode) {
      console.log("[代码处理] 已替换外部URL为代理URL");
    }

    return processedCode;
  };

  // 添加全局窗口函数，使Agent生成的代码可以直接调用自动缩放功能
  useEffect(() => {
    if (typeof window !== "undefined") {
      // 为window添加autoScaleModel函数
      (
        window as Window &
          typeof globalThis & {
            autoScaleModel: (
              model: THREE.Object3D,
              desiredSize?: number
            ) => number | undefined;
          }
      ).autoScaleModel = (model: THREE.Object3D, desiredSize: number = 5) => {
        return autoScaleModel(model, desiredSize);
      };
    }

    return () => {
      // 组件卸载时清理
      if (typeof window !== "undefined") {
        delete (
          window as Window &
            typeof globalThis & {
              autoScaleModel?: (
                model: THREE.Object3D,
                desiredSize?: number
              ) => number | undefined;
            }
        ).autoScaleModel;
      }
    };
  }, []);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      // 清理场景中的所有对象
      const clearScene = () => {
        console.log("开始清理场景...");

        if (
          !threeRef.current ||
          !threeRef.current.scene ||
          !threeRef.current.dynamicGroup
        ) {
          console.warn("无法获取场景或动态组，跳过清理");
          return;
        }

        const { scene, dynamicGroup } = threeRef.current;

        // 收集要移除的对象
        const objectsToRemove: THREE.Object3D[] = [];

        // 遍历scene的直接子对象，排除基础组件如灯光、网格、dynamicGroup，以及已加载的模型
        scene.children.forEach((child) => {
          // 保留gridHelper, 灯光, dynamicGroup和已加载的3D模型
          if (
            child instanceof THREE.GridHelper ||
            child instanceof THREE.Light ||
            child === dynamicGroup ||
            (child.userData &&
              (child.userData.modelId || child.userData.isModelObject)) // 保留已加载的3D模型
          ) {
            console.log(
              `保留对象: ${child.name || "unnamed"} (${
                child.userData && child.userData.modelId
                  ? "modelId: " + child.userData.modelId
                  : "基础组件"
              })`
            );
            return;
          }

          // 如果不是保留的组件，则加入移除列表
          objectsToRemove.push(child);
        });

        // 移除收集的对象
        objectsToRemove.forEach((obj) => {
          scene.remove(obj);
          console.log(`从场景移除: ${obj.name || "unnamed object"}`);
        });

        // 只清除dynamicGroup中不是3D模型的对象
        const dynamicObjectsToRemove: THREE.Object3D[] = [];
        dynamicGroup.children.forEach((child) => {
          if (
            !(
              child.userData &&
              (child.userData.modelId || child.userData.isModelObject)
            )
          ) {
            dynamicObjectsToRemove.push(child);
          }
        });

        // 移除dynamicGroup中的非模型对象
        dynamicObjectsToRemove.forEach((obj) => {
          dynamicGroup.remove(obj);
          console.log(`从dynamicGroup移除: ${obj.name || "unnamed object"}`);
        });

        console.log(
          `场景清理完成，保留了${
            scene.children.length - objectsToRemove.length
          }个对象`
        );

        // 记录保留的模型数量
        const modelCount = scene.children.filter(
          (child) =>
            child.userData &&
            (child.userData.modelId || child.userData.isModelObject)
        ).length;

        console.log(`保留了${modelCount}个3D模型`);
        console.log(`系统中有${allModelUrls.length}个模型URL记录`);
      };

      // 执行场景清理
      clearScene();

      if (!validateCode(code)) {
        setError("代码不完整或包含语法错误，请检查代码");
        return;
      }

      try {
        // 预处理代码中的外部URL，防止CORS问题
        const sanitizedCode = prepareCodeForExecution(code.trim());

        const functionBody = `
          let setup;
          try {
            ${sanitizedCode}
            if (typeof setup !== 'function') {
              throw new Error('setup function not defined in code');
            }
            
            // 对于新的用法，我们要包装原始的setup函数，使其能访问setupContext
            const originalSetup = setup;
            setup = function(scene, camera, renderer, THREE, OrbitControls, GLTFLoader, context) {
              // 如果有上下文且包含已加载的模型，将其添加到全局scope
              if (context && context.loadedModels) {
                console.log('Setup函数接收到已加载的模型信息:', context.loadedModels.length + '个模型');
                // 可以在这里访问context.loadedModels和context.getModelById
              }
              
              // 调用原始setup函数
              return originalSetup(scene, camera, renderer, THREE, OrbitControls, GLTFLoader);
            };
            
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
            "setupContext", // 添加模型上下文参数
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
            GLTFLoader,
            null // 初始空值，稍后在调用setup时传入真实值
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
          // 添加日志说明清空了场景
          console.log(
            "已清空场景中的可更改对象，准备重新构建场景，但保留已加载的模型..."
          );

          // 获取已加载的模型列表，便于setupFn访问
          const loadedModelsData = loadedModels.map((model) => {
            // 找到对应的模型对象
            let modelObject: THREE.Object3D | null = null;
            scene.traverse((obj) => {
              if (obj.userData && obj.userData.modelId === model.id) {
                modelObject = obj;
              }
            });
            return {
              id: model.id,
              url: model.url,
              object: modelObject,
            };
          });

          // 向setupFn传递已加载的模型信息
          const setupContext = {
            loadedModels: loadedModelsData,
            // 提供获取模型的辅助函数
            getModelById: (id: string) => {
              let foundModel: THREE.Object3D | null = null;
              scene.traverse((obj) => {
                if (obj.userData && obj.userData.modelId === id) {
                  foundModel = obj;
                }
              });
              return foundModel;
            },
            // 新增：获取所有模型的辅助函数
            getAllModels: () => {
              const models: THREE.Object3D[] = [];
              scene.traverse((obj) => {
                if (obj.userData && obj.userData.modelId) {
                  models.push(obj);
                }
              });
              return models;
            },
            // 新增：提供模型信息
            modelCount: loadedModelsData.length,
          };

          // 仅在存在场景状态序列化函数时记录状态
          if (typeof serializeSceneState === "function") {
            // 在调用setup前，保存当前场景状态以便比较变化
            const sceneBefore = serializeSceneState();
            console.log(
              `Setup函数执行前场景包含 ${sceneBefore.length} 个对象，其中已加载模型 ${setupContext.modelCount} 个`
            );
          }

          // 执行setup函数，传入当前场景上下文，包括已加载的模型
          setupFn(
            dynamicGroup,
            camera,
            renderer,
            ExtendedTHREE,
            OrbitControlsWrapper,
            GLTFLoader,
            setupContext // 新增参数，传入模型上下文
          );

          // 记录场景状态变化但不保存到服务器
          try {
            // 仅在存在场景状态序列化函数时记录状态
            if (typeof serializeSceneState === "function") {
              const sceneAfter = serializeSceneState();
              console.log(
                `Setup函数执行后场景包含 ${sceneAfter.length} 个对象`
              );
            }
          } catch (err) {
            console.error("尝试序列化场景状态时出错:", err);
          }

          console.log("场景重建完成，渲染新场景，保留了已加载的模型");

          // This ensures we render whatever was added to the scene or dynamicGroup
          renderer.render(scene, camera);
          addToHistory(code);

          if (error) setError("");
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

  // 添加清除特定名称对象的函数
  const removeObjectsByName = (names: string[]) => {
    if (!threeRef.current) return;
    const { scene, dynamicGroup } = threeRef.current;

    if (!scene) return;

    // 查找并移除指定名称的对象的函数
    const findAndRemove = (parent: THREE.Object3D) => {
      const objectsToRemove: THREE.Object3D[] = [];

      // 先收集需要移除的对象
      parent.children.forEach((child) => {
        if (names.includes(child.name)) {
          objectsToRemove.push(child);
        } else {
          // 递归检查子对象
          findAndRemove(child);
        }
      });

      // 移除收集到的对象
      objectsToRemove.forEach((obj) => {
        parent.remove(obj);
        console.log(`已移除对象: ${obj.name}`);

        // 释放资源
        if (obj instanceof THREE.Mesh) {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) {
              obj.material.forEach((m: THREE.Material) => m.dispose());
            } else {
              obj.material.dispose();
            }
          }
        }
      });
    };

    // 在场景中查找并移除
    findAndRemove(scene);

    // 如果dynamicGroup存在，也在其中查找并移除
    if (dynamicGroup) {
      findAndRemove(dynamicGroup);
    }

    console.log(`已尝试移除指定名称的对象: ${names.join(", ")}`);

    // 触发渲染以更新场景
    if (threeRef.current.renderer) {
      threeRef.current.renderer.render(scene, threeRef.current.camera);
    }
  };

  // 添加为全局函数，便于控制台调试
  useEffect(() => {
    // @ts-expect-error - 添加到window对象上供调试使用
    window.removeObjectsByName = (names: string[]) => {
      removeObjectsByName(Array.isArray(names) ? names : [names]);
      return "移除对象操作已执行";
    };

    // @ts-expect-error - 添加场景重置函数
    window.resetScene = () => {
      if (!threeRef.current) return "场景未初始化";

      const { scene, dynamicGroup, camera, renderer } = threeRef.current;
      if (!scene || !dynamicGroup || !camera || !renderer) {
        return "场景组件未完全初始化";
      }

      // 清空dynamicGroup
      while (dynamicGroup.children.length > 0) {
        const obj = dynamicGroup.children[0];
        dynamicGroup.remove(obj);
      }

      // 重置摄像机位置
      camera.position.set(5, 5, 10);
      camera.lookAt(0, 0, 0);

      // 渲染更新后的场景
      renderer.render(scene, camera);

      return "场景已重置";
    };

    return () => {
      // @ts-expect-error - 从window对象上删除
      delete window.removeObjectsByName;
      // @ts-expect-error - 从window对象上删除
      delete window.resetScene;
    };
  }, []);

  // 使用原生Three.js渲染器和备用html2canvas结合的截图方法
  const captureScreenshot = async () => {
    console.log("[Screenshot] Starting screenshot capture process...");
    if (!threeRef.current) {
      console.warn("[Screenshot] Failed: Three.js scene not initialized");
      return null;
    }

    try {
      // 直接从Three.js渲染器获取截图
      const { renderer, scene, camera } = threeRef.current;
      if (!renderer || !scene || !camera) {
        console.warn("[Screenshot] Three.js components incomplete");
        return null;
      }

      // Force multiple renders to ensure complete rendering
      renderer.render(scene, camera);

      // Wait for any pending animations/processes to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Render again to ensure the scene is fully updated
      renderer.render(scene, camera);

      // Get the canvas element
      const threeCanvas = renderer.domElement;
      if (!threeCanvas) {
        console.warn("[Screenshot] Canvas element not found");
        return null;
      }

      // One final render before capturing
      renderer.render(scene, camera);

      try {
        // Set a lower quality value (0.5-0.7 instead of 1.0)
        const imageBase64 = threeCanvas.toDataURL("image/jpeg", 0.5);

        console.log(
          "[Screenshot] Base64 data captured, length:",
          imageBase64.length,
          "bytes"
        );

        // Validate data quality and format
        if (
          !imageBase64 ||
          imageBase64 === "data:," ||
          !imageBase64.startsWith("data:image/jpeg;base64,") ||
          imageBase64.length < 1000
        ) {
          console.error(
            "[Screenshot] Invalid or too small base64 data from direct capture"
          );
          return null;
        }

        console.log(
          "[Screenshot] Successfully captured scene from Three.js canvas"
        );
        return imageBase64;
      } catch (canvasError) {
        console.error("[Screenshot] Canvas capture error:", canvasError);
        return null;
      }
    } catch (err) {
      console.error("[Screenshot] Capture failed with error:", err);
      setError(
        "Cannot capture scene screenshot: " +
          (err instanceof Error ? err.message : String(err))
      );
      return null;
    }
  };

  // 简化的应用代码到场景函数
  const applySafelyToScene = async (codeToApply: string): Promise<boolean> => {
    try {
      console.log("[Rendering] Applying code to scene before screenshot");

      // 确保代码经过URL处理
      const processedCode = preprocessCode(codeToApply);
      if (processedCode !== codeToApply) {
        console.log("[Rendering] 处理了代码中的外部URL引用");
      }

      if (!validateCode(processedCode) || !threeRef.current) {
        return false;
      }

      // 重置渲染完成标志
      renderingCompleteRef.current = false;

      // 清除错误
      setError("");

      // 执行代码逻辑保持不变
      const { scene, camera, renderer } = threeRef.current;
      if (!scene || !camera || !renderer) {
        return false;
      }

      try {
        // 强制执行几帧渲染确保场景更新
        renderer.render(scene, camera);

        // 简单延时确保渲染
        await new Promise((resolve) => setTimeout(resolve, 500));

        // 标记渲染完成
        renderingCompleteRef.current = true;
        return true;
      } catch (execError) {
        console.error("[Rendering] Error executing code:", execError);
        return false;
      }
    } catch (error) {
      console.error("[Rendering] Error applying code to scene:", error);
      return false;
    }
  };

  // 移除对 lastMessage 和 sendMessage 的依赖，使用 Socket.IO 客户端
  useEffect(() => {
    try {
      // 检查 socket 是否已连接
      const { socket } = useSocketStore.getState();
      if (!socket || !socket.connected) {
        console.log("[Socket.IO] Not connected, cannot process messages");
        return;
      }

      // 设置用于接收代码/分析结果的事件监听器
      const handleAgentResult = (data: {
        directCode?: string;
        status?: string;
        timestamp?: number;
      }) => {
        console.log("[Socket.IO] Received agent result:", data);
        if (data.directCode) {
          setCode(data.directCode);
        }
      };

      // #region 自动化代理截图流程
      /**
       * 截图流程说明:
       * 1. 用户发起截图分析（点击"生成"按钮）- handleGenerate函数中直接捕获并发送截图
       * 2. Agent驱动的截图请求 - 通过Socket.IO从后端发起，由下面的handleScreenshotRequest处理
       */
      // 设置用于处理截图请求的事件监听器（Agent主动请求截图的情况）
      const handleScreenshotRequest = async (data: {
        requestId: string;
        timestamp: number;
        fromAgent?: boolean;
      }) => {
        console.log(
          `[Socket.IO] Received screenshot request: ${data.requestId} ${
            data.fromAgent ? "(from Agent)" : ""
          }`
        );

        try {
          // 确保场景已完全渲染
          await applySafelyToScene(code);

          // 捕获截图
          const screenshotData = await captureScreenshot();

          if (!screenshotData) {
            throw new Error("Failed to capture scene screenshot");
          }

          console.log(
            `[Socket.IO] Screenshot captured, size: ${Math.round(
              screenshotData.length / 1024
            )} KB`
          );

          // 发送截图回Socket.IO服务器
          socket.emit("provide_screenshot", {
            requestId: data.requestId,
            screenshot: screenshotData,
            userRequirement: prompt, // 添加当前用户提示以便分析
            returnAnalysis: true, // 请求分析结果
            timestamp: Date.now(),
          });

          console.log(
            `[Socket.IO] Screenshot sent, request ID: ${data.requestId}`
          );
        } catch (error) {
          console.error(
            `[Socket.IO] Screenshot request processing failed:`,
            error
          );

          // 发送错误响应
          socket.emit("provide_screenshot_error", {
            requestId: data.requestId,
            error: error instanceof Error ? error.message : String(error),
            timestamp: Date.now(),
          });
        }
      };
      // #endregion

      // 添加事件监听器 - 简化和优化
      socket.on("agent_result", handleAgentResult);
      socket.on("request_screenshot", handleScreenshotRequest);

      // 移除不必要的分析结果处理，仅保留日志记录
      socket.on("screenshot_analysis", (data) => {
        // 简化为仅记录日志，不执行其他操作
        console.log(
          "[Socket.IO] Received analysis info for request:",
          data.requestId
        );
      });

      // 清理函数
      return () => {
        socket.off("agent_result", handleAgentResult);
        socket.off("request_screenshot", handleScreenshotRequest);
        socket.off("screenshot_analysis");
      };
    } catch (error) {
      console.error("[Socket.IO] Message processing error:", error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, prompt]);

  // Add a function to capture the scene state after rendering
  const captureSceneStateForChromaDB = async () => {
    console.log(
      "[SceneCapture] Capturing scene state for ChromaDB persistence..."
    );
    if (!threeRef.current) {
      console.warn("[SceneCapture] Failed: Three.js scene not initialized");
      return null;
    }

    try {
      const { scene, renderer, camera } = threeRef.current;
      if (!scene || !renderer || !camera) {
        console.warn("[SceneCapture] Three.js components incomplete");
        return null;
      }

      // Force a render to ensure the scene is up-to-date
      renderer.render(scene, camera);

      // Get the serialized scene state - this will now include full object data
      // thanks to our updated serializeSceneState function in useSceneStore
      const sceneState = serializeSceneState();

      if (sceneState.length === 0) {
        console.log("[SceneCapture] No objects found in scene");
        return null;
      }

      console.log(
        `[SceneCapture] Successfully captured ${sceneState.length} objects from the scene`
      );
      return sceneState;
    } catch (err) {
      console.error("[SceneCapture] Error capturing scene state:", err);
      setError(
        "Cannot capture scene state: " +
          (err instanceof Error ? err.message : String(err))
      );
      return null;
    }
  };

  // Function to generate Three.js code from the current scene state
  const generateCodeFromSceneState = () => {
    if (!threeRef.current) return null;

    const { scene, dynamicGroup } = threeRef.current;
    if (!scene || !dynamicGroup) return null;

    // Retrieve the original code structure
    const originalCode = code;

    // Try to get manipulated objects data from window object
    let manipulatedObjects: {
      name: string;
      uuid: string;
      position: number[];
      rotation: number[];
      scale: number[];
    }[] = [];

    try {
      // @ts-expect-error - accessing custom property set in ObjectManipulationControls
      const lastManipulatedData = window._lastManipulatedObjects;
      if (lastManipulatedData) {
        manipulatedObjects = JSON.parse(lastManipulatedData);
      }
    } catch (err) {
      console.warn("Could not parse manipulated objects data:", err);
    }

    // If no manipulated objects found, return original code
    if (!manipulatedObjects.length) {
      console.log(
        "[CodeGen] No manipulated objects data found, using original code"
      );
      return null;
    }

    console.log("[CodeGen] Generating code with updated object positions...");

    // Create a modified version of the code with updated positions
    let newCode = originalCode;

    // Create position update code for each manipulated object
    const positionUpdateCode = manipulatedObjects
      .map((obj) => {
        const safeObjName = obj.name.replace(/[^a-zA-Z0-9_]/g, "_");
        // Format position values with 3 decimal places
        const position = obj.position
          .map((v) => parseFloat(v.toFixed(3)))
          .join(", ");
        const rotation = obj.rotation
          .map((v) => parseFloat(v.toFixed(3)))
          .join(", ");
        const scale = obj.scale.map((v) => parseFloat(v.toFixed(3))).join(", ");

        return `  // Update position for ${obj.name}
  const ${safeObjName} = scene.getObjectByName("${obj.name}");
  if (${safeObjName}) {
    ${safeObjName}.position.set(${position});
    ${safeObjName}.rotation.set(${rotation});
    ${safeObjName}.scale.set(${scale});
  }`;
      })
      .join("\n\n");

    // Insert position update code into the current code
    if (newCode.includes("return scene;")) {
      // Insert before the return statement
      newCode = newCode.replace(
        "return scene;",
        `${positionUpdateCode}\n\n  return scene;`
      );
    } else {
      // Append at the end of the function
      newCode = newCode.replace(/}(?=[^}]*$)/, `\n${positionUpdateCode}\n\n}`);
    }

    console.log("[CodeGen] Generated code with updated object positions");
    return newCode;
  };

  // Modify the handleGenerate function to include current scene code
  const handleGenerate = async () => {
    if (isLoading || isModelLoading) return;

    setIsLoading(true);
    setError("");
    setSuccess("");

    try {
      // 更新allModelUrls中的最后使用时间
      setAllModelUrls((prev) =>
        prev.map((item) => ({ ...item, lastUsed: new Date() }))
      );

      // Generate code from current scene state after manual object manipulation
      const currentSceneCode = generateCodeFromSceneState();

      // If we successfully generated code from the scene, use it for the request
      if (currentSceneCode) {
        console.log(
          "[Generate] Using code with updated object positions from manual manipulation"
        );
      }

      // 捕获当前场景状态
      const currentSceneState = await captureSceneStateForChromaDB();
      console.log(`当前场景有 ${currentSceneState?.length || 0} 个对象`);

      // 确保场景已完全渲染好
      if (!renderingCompleteRef.current && threeRef.current) {
        try {
          console.log("[Generate] 等待场景渲染完成...");
          // 强制渲染几帧以确保场景更新
          for (let i = 0; i < 3; i++) {
            threeRef.current.renderer.render(
              threeRef.current.scene,
              threeRef.current.camera
            );
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          renderingCompleteRef.current = true;
        } catch (renderError) {
          console.warn("[Generate] 渲染场景时出错:", renderError);
        }
      }

      // 获取截图以帮助AI理解场景
      let screenshotDataUrl = null;
      try {
        console.log("[Generate] 生成场景截图...");
        screenshotDataUrl = await captureScreenshot();
      } catch (screenError) {
        console.warn("[Generate] 生成截图失败:", screenError);
      }

      // 创建请求负载
      const payload: RequestPayload = {
        action: "analyze-screenshot",
        // Use the code generated from scene state if available, otherwise use editor code
        code: currentSceneCode || code,
        prompt: prompt,
        lintErrors: lintErrors,
        renderingComplete: renderingCompleteRef.current,
        sceneState: currentSceneState
          ? (currentSceneState as unknown as SceneStateObject[])
          : [],
      };

      // 如果有截图，添加到请求中
      if (screenshotDataUrl) {
        payload.screenshot = screenshotDataUrl;
      }

      console.log("[Generate] 发送请求到后端...", {
        prompt,
        codeLength: payload.code.length,
        hasScreenshot: !!screenshotDataUrl,
        sceneStateSize: currentSceneState?.length || 0,
        usingManuallyCorrectedCode: !!currentSceneCode,
      });

      // 发送请求到后端
      const response = await fetch("/api/agentHandler", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`服务器返回错误: ${response.status}`);
      }

      const data = await response.json();
      console.log("[Generate] 收到后端响应:", data);

      // 处理响应
      if (data.directCode) {
        // 如果有直接代码，应用到编辑器
        const code = data.directCode.trim();
        setCode(code);
        setSuccess("已生成代码");
        console.log("[Generate] 设置新代码至编辑器");
      } else if (data.modelUrls && data.modelUrls.length > 0) {
        // 处理生成的模型URL
        setSuccess(`已生成${data.modelUrls.length}个模型！正在加载...`);

        try {
          // 处理并记录所有模型URL
          console.log("[Generate] 处理模型URL:", data.modelUrls);

          // 检查是否模型URL已经存在于allModelUrls中
          const firstModelUrl = data.modelUrls[0];
          const existingModelUrl = allModelUrls.find(
            (item) => item.url === firstModelUrl
          );

          if (existingModelUrl) {
            console.log(
              "[Generate] 使用已存储的模型URL:",
              existingModelUrl.url
            );
          }

          // 无论是否存在，都尝试加载第一个模型
          const modelLoaded = await loadModel(data.modelUrls[0]);

          if (modelLoaded) {
            setSuccess("模型已成功加载！");

            // 确保模型加载后更新场景状态
            const updatedSceneState = await captureSceneStateForChromaDB();
            console.log(
              `[Generate] 更新的场景状态包含 ${
                updatedSceneState?.length || 0
              } 个对象`
            );

            // 强制渲染一次确保模型可见
            if (
              threeRef.current &&
              threeRef.current.renderer &&
              threeRef.current.scene &&
              threeRef.current.camera
            ) {
              threeRef.current.renderer.render(
                threeRef.current.scene,
                threeRef.current.camera
              );
            }

            // 传回更新的场景状态到后端，确保状态持久化
            if (updatedSceneState && updatedSceneState.length > 0) {
              console.log(
                `[Generate] 场景状态已更新，包含 ${updatedSceneState.length} 个对象`
              );
            }
          } else {
            throw new Error("模型加载失败");
          }
        } catch (loadError) {
          console.error("[Generate] 加载模型失败:", loadError);
          setError(
            `加载模型失败: ${
              loadError instanceof Error ? loadError.message : String(loadError)
            }`
          );
        }
      } else {
        setSuccess("已处理请求，但没有代码或模型更新");
      }
    } catch (error) {
      console.error("[Generate] 处理请求错误:", error);
      setError(
        `处理请求失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditorDidMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  // Reset rendering complete flag when code changes
  useEffect(() => {
    if (code) {
      renderingCompleteRef.current = false;
      console.log(
        "[Rendering] Code changed, resetting rendering complete flag"
      );
    }
  }, [code]);

  // Adding resize functionality for the sidebar
  useEffect(() => {
    const container = document.querySelector(".editor-container");
    const sidebar = document.querySelector(".sidebar");
    const resizeHandle = document.querySelector(".resize-handle");

    if (!container || !sidebar || !resizeHandle) return;

    // Set initial position based on sidebar width or default to 30%
    const setInitialPosition = () => {
      const sidebarWidth = sidebar.getBoundingClientRect().width;
      (resizeHandle as HTMLElement).style.left = `${sidebarWidth}px`;
    };

    // Run once after render
    setTimeout(setInitialPosition, 0);

    let isResizing = false;

    const startResize = (e: MouseEvent) => {
      isResizing = true;
      document.body.style.cursor = "col-resize";
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", stopResize);
      e.preventDefault();
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const containerRect = container.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;

      // Set min and max widths
      const minWidth = 350;
      const maxWidth = containerRect.width * 0.45;

      const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

      // Update sidebar width and resize handle position
      (sidebar as HTMLElement).style.width = `${clampedWidth}px`;
      (resizeHandle as HTMLElement).style.left = `${clampedWidth}px`;
    };

    const stopResize = () => {
      isResizing = false;
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", stopResize);
    };

    resizeHandle.addEventListener("mousedown", startResize as EventListener);

    return () => {
      resizeHandle.removeEventListener(
        "mousedown",
        startResize as EventListener
      );
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", stopResize);
    };
  }, []);

  // During initialization, override the GLTFLoader's load method to use the proxy
  useEffect(() => {
    if (threeRef.current && threeRef.current.gltfLoader) {
      const originalLoad = threeRef.current.gltfLoader.load;

      // Override the load method to use our proxy
      threeRef.current.gltfLoader.load = function (
        url,
        onLoad,
        onProgress,
        onError
      ) {
        console.log("Intercepting GLTFLoader.load for URL:", url);

        // Check if this is an external URL that needs proxying
        if (url.startsWith("http") && !url.includes("/api/proxy-model")) {
          console.log("Using proxy for external URL:", url);

          // Use the proxy endpoint
          fetch("/api/proxy-model", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ url }),
          })
            .then((response) => {
              if (!response.ok) {
                throw new Error(
                  `Proxy returned HTTP error! status: ${response.status}`
                );
              }
              return response.arrayBuffer();
            })
            .then((buffer) => {
              console.log(
                "Successfully fetched model via proxy, size:",
                buffer.byteLength
              );
              // Parse the model from the buffer
              threeRef.current?.gltfLoader?.parse(
                buffer,
                "",
                (gltf) => onLoad(gltf),
                (error) => {
                  console.error("Error parsing model:", error);
                  if (onError) onError(error);
                }
              );
            })
            .catch((error) => {
              console.error("Error fetching model via proxy:", error);
              if (onError) onError(error);
            });

          return null; // The real loading happens asynchronously
        } else {
          // For local URLs or those already using the proxy, use the original method
          return originalLoad.call(this, url, onLoad, onProgress, onError);
        }
      };
    }
  }, []);

  // Clean up manipulated objects data when component unmounts
  useEffect(() => {
    return () => {
      try {
        // @ts-expect-error - accessing custom property set in ObjectManipulationControls
        delete window._lastManipulatedObjects;
      } catch (err) {
        console.error("Failed to clean up manipulated objects data:", err);
      }
    };
  }, []);

  // Add listener for manipulated objects to show notification
  useEffect(() => {
    const handleManipulationEvent = () => {
      // Check if manipulated objects data exists
      try {
        // @ts-expect-error - accessing custom property set in ObjectManipulationControls
        const lastManipulatedData = window._lastManipulatedObjects;
        if (lastManipulatedData) {
          // Show a temporary success message
          setSuccess("物体位置已更新 - 点击生成按钮将使用新位置");
          // Clear the message after 3 seconds
          setTimeout(() => {
            setSuccess("");
          }, 3000);
        }
      } catch (err) {
        console.warn("Could not check for manipulated objects:", err);
      }
    };

    // Add a custom event listener for object manipulation completed
    window.addEventListener("object-manipulated", handleManipulationEvent);

    return () => {
      window.removeEventListener("object-manipulated", handleManipulationEvent);
    };
  }, []);

  // 在组件初始化时将操作模式设置为永久启用
  useEffect(() => {
    // 确保操作模式始终为启用状态
    if (!isDraggingOrSelecting) {
      setIsDraggingOrSelecting(true);
      console.log("操作模式已自动启用");
    }
  }, [isDraggingOrSelecting, setIsDraggingOrSelecting]);

  return (
    <div className="editor-container">
      <div className="sidebar">
        <div className="sidebar-header">
          <h2>Three.js AI 编辑器</h2>
          {/* WebSocket connection status indicator */}
          <div className={`ws-status ${socketConnectionStatus}`}>
            <span className="status-dot"></span>
            {socketConnectionStatus === "open"
              ? "已连接"
              : socketConnectionStatus === "connecting"
              ? "连接中..."
              : socketConnectionStatus === "closed"
              ? "已断开"
              : "连接错误"}
            {socketConnectionStatus !== "open" && (
              <button onClick={manualReconnect} className="reconnect-button">
                重连
              </button>
            )}
          </div>
        </div>

        <div className="prompt-section">
          <label htmlFor="prompt-input" className="prompt-label">
            输入你想要创建的场景描述:
          </label>
          <textarea
            id="prompt-input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例如: 添加一个旋转的红色球体 或 生成一只红色的猫"
            rows={4}
            className="prompt-input"
            disabled={socketConnectionStatus !== "open"}
          />
          <div className="button-group">
            <button
              onClick={handleGenerate}
              disabled={
                isLoading || isModelLoading || socketConnectionStatus !== "open"
              }
              className="generate-button"
            >
              {isLoading
                ? "生成中..."
                : socketConnectionStatus !== "open"
                ? "等待连接..."
                : renderingCompleteRef.current
                ? "生成并分析场景"
                : "生成场景代码"}
              <div
                className={`button-background ${isLoading ? "loading" : ""}`}
              ></div>
            </button>
          </div>
        </div>

        {socketConnectionStatus !== "open" && (
          <div className="connection-message">
            <p>正在建立 Socket.IO 连接，请稍候...</p>
          </div>
        )}

        <div className="status-section">
          {error && <div className="error">{error}</div>}
          {success && <div className="success">{success}</div>}
          {isModelLoading && (
            <div className="loading-model">
              <span className="loading-spinner"></span>
              <span>加载3D模型中...</span>
            </div>
          )}
        </div>

        {previousCode && code !== previousCode && (
          <div className="diff-toggle">
            <button onClick={() => setShowDiff(!showDiff)}>
              {showDiff ? "隐藏代码差异" : "显示代码差异"}
            </button>
          </div>
        )}

        <div className="code-section">
          <h3 className="code-header">Three.js 场景代码</h3>
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
              tabSize: 2,
              lineNumbers: "on",
              glyphMargin: true,
              folding: true,
              contextmenu: true,
              quickSuggestions: true,
              suggestOnTriggerCharacters: true,
            }}
          />
        </div>
      </div>

      <div className="resize-handle"></div>
      <div className="preview" ref={containerRef}></div>

      {/* Scene Exporter component for image export */}
      {threeRef.current?.renderer && (
        <div className="scene-exporter-container">
          <UnifiedExportTools renderer={threeRef.current.renderer} />
        </div>
      )}

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

      {/* 始终显示操作控制面板 */}
      <div className="ui-controls-container">
        <ObjectManipulationControls />
      </div>

      <style jsx>{`
        .editor-container {
          display: flex;
          height: 100vh;
          width: 100%;
          overflow: hidden;
          position: relative;
          background-color: #0f0f0f;
          color: #e0e0e0;
        }

        .sidebar {
          display: flex;
          flex-direction: column;
          width: 30%;
          min-width: 350px;
          max-width: 45%;
          padding: 15px;
          background-color: #121212;
          border-right: 1px solid #333;
          overflow-y: auto;
          resize: horizontal;
          position: relative;
          transition: background-color 0.3s ease;
        }

        .resize-handle {
          width: 4px;
          height: 100%;
          background-color: #333;
          cursor: col-resize;
          position: absolute;
          top: 0;
          left: 30%; /* Match initial sidebar width */
          z-index: 10;
          transition: background-color 0.2s ease;
        }

        .resize-handle:hover {
          background-color: #555;
        }

        .sidebar-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
          padding-bottom: 8px;
          border-bottom: 1px solid #333;
        }

        .sidebar-header h2 {
          margin: 0;
          color: #e0e0e0;
          font-size: 16px;
          font-weight: 400;
          letter-spacing: 0.5px;
        }

        .prompt-section {
          margin-bottom: 8px;
        }

        .prompt-label {
          display: block;
          margin-bottom: 4px;
          font-weight: normal;
          color: #aaa;
          font-size: 13px;
          letter-spacing: 0.5px;
        }

        .status-section {
          margin-bottom: 8px;
        }

        .preview {
          flex-grow: 1;
          height: 100%;
          position: relative;
          background-color: #0a0a0a;
        }

        .scene-exporter-container {
          position: absolute;
          top: 20px;
          right: 20px;
          width: 300px;
          z-index: 100;
          transition: all 0.3s ease;
          filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.3));
        }

        .ui-controls-container {
          position: absolute;
          top: 50%;
          right: 20px;
          transform: translateY(-50%);
          z-index: 90;
        }

        .button-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-top: 8px;
        }

        .ws-status {
          padding: 4px 8px;
          margin: 4px 0;
          border-radius: 3px;
          font-size: 12px;
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .status-dot {
          display: inline-block;
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }

        .ws-status.open {
          background-color: rgba(35, 35, 35, 0.8);
          color: #aaa;
        }

        .ws-status.open .status-dot {
          background-color: #5f5;
        }

        .ws-status.connecting {
          background-color: rgba(35, 35, 35, 0.8);
          color: #aaa;
        }

        .ws-status.connecting .status-dot {
          background-color: #fa3;
        }

        .ws-status.closed,
        .ws-status.error {
          background-color: rgba(35, 35, 35, 0.8);
          color: #aaa;
        }

        .ws-status.closed .status-dot,
        .ws-status.error .status-dot {
          background-color: #f55;
        }

        .success {
          background-color: rgba(35, 35, 35, 0.8);
          color: #aaa;
          padding: 6px 10px;
          margin: 6px 0;
          border-radius: 3px;
          border-left: 3px solid #5f5;
          animation: fadeIn 0.3s ease;
          font-size: 12px;
        }

        .error {
          background-color: rgba(35, 35, 35, 0.8);
          color: #aaa;
          padding: 6px 10px;
          margin: 6px 0;
          border-radius: 3px;
          border-left: 3px solid #f55;
          animation: fadeIn 0.3s ease;
          font-size: 12px;
        }

        .reconnect-button {
          margin-left: 8px;
          font-size: 12px;
          padding: 2px 6px;
          background: #333;
          color: #ddd;
          border: none;
          border-radius: 2px;
          cursor: pointer;
        }

        .reconnect-button:hover {
          background: #444;
        }

        .connection-message {
          background-color: rgba(35, 35, 35, 0.8);
          border: 1px solid #333;
          color: #aaa;
          padding: 12px;
          margin: 10px 0;
          border-radius: 3px;
          text-align: center;
        }

        .connection-message p {
          margin: 5px 0;
        }

        .prompt-input {
          width: 100%;
          padding: 8px;
          margin-bottom: 8px;
          border: 1px solid #333;
          background-color: #1a1a1a;
          color: #e0e0e0;
          border-radius: 3px;
          resize: vertical;
          font-family: "Inter", "Arial", sans-serif;
          transition: all 0.2s ease;
          min-height: 80px;
          max-height: 120px;
        }

        .prompt-input:focus {
          border-color: #555;
          box-shadow: 0 0 0 1px rgba(100, 100, 100, 0.3);
          outline: none;
        }

        .prompt-input::placeholder {
          color: #666;
        }

        .prompt-input:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .generate-button {
          position: relative;
          background-color: transparent;
          color: #e0e0e0;
          border: none;
          padding: 10px 16px;
          border-radius: 3px;
          cursor: pointer;
          font-weight: 500;
          font-size: 13px;
          letter-spacing: 0.5px;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          text-transform: uppercase;
          overflow: hidden;
        }

        .generate-button .button-background {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: -1;
          border-radius: 3px;
          background-color: #333;
          opacity: 1;
          transition: all 0.3s ease;
        }

        .generate-button .button-background.loading {
          background-size: 200% 200%;
          animation: loading-gradient 1.5s linear infinite;
        }

        .generate-button:hover:not(:disabled) .button-background {
          background-color: #444;
        }

        .generate-button:active:not(:disabled) .button-background {
          background-color: #222;
          transform: scale(0.98);
        }

        .generate-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        @keyframes loading-gradient {
          0% {
            background-position: 0% 50%;
            background-image: linear-gradient(
              90deg,
              #333 0%,
              #444 50%,
              #333 100%
            );
          }
          100% {
            background-position: 100% 50%;
            background-image: linear-gradient(
              90deg,
              #333 0%,
              #444 50%,
              #333 100%
            );
          }
        }

        .code-section {
          display: flex;
          flex-direction: column;
          flex-grow: 1;
          height: calc(100% - 180px);
          margin-top: 8px;
          border: 1px solid #333;
          border-radius: 3px;
          overflow: hidden;
        }

        .code-header {
          background-color: #1a1a1a;
          color: #aaa;
          margin: 0;
          padding: 6px 10px;
          font-size: 13px;
          border-bottom: 1px solid #333;
          font-weight: normal;
          letter-spacing: 0.5px;
        }

        .loading-model {
          display: flex;
          align-items: center;
          gap: 6px;
          background-color: rgba(35, 35, 35, 0.8);
          border: 1px solid #333;
          border-radius: 3px;
          padding: 6px 8px;
          margin: 6px 0;
          color: #aaa;
          font-size: 12px;
        }

        .loading-spinner {
          display: inline-block;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          border: 2px solid #aaa;
          border-top-color: transparent;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        .diff-toggle {
          margin: 6px 0;
        }

        .diff-toggle button {
          background: #333;
          color: #ddd;
          border: none;
          padding: 4px 8px;
          border-radius: 3px;
          cursor: pointer;
          font-size: 12px;
        }

        .diff-toggle button:hover {
          background: #444;
        }

        .lint-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: rgba(0, 0, 0, 0.7);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 1000;
        }

        .lint-overlay-content {
          background-color: #1a1a1a;
          border-radius: 3px;
          padding: 20px;
          width: 80%;
          max-width: 800px;
          max-height: 80vh;
          overflow-y: auto;
          position: relative;
          color: #ddd;
          border: 1px solid #333;
        }

        .close-button {
          position: absolute;
          top: 10px;
          right: 10px;
          background: none;
          border: none;
          font-size: 20px;
          cursor: pointer;
          color: #ddd;
        }

        .lint-errors-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .lint-error-item {
          padding: 8px;
          border-bottom: 1px solid #333;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .lint-error-location {
          font-weight: bold;
          color: #aaa;
          min-width: 80px;
        }

        .lint-error-message {
          flex-grow: 1;
          color: #ddd;
        }

        .lint-error-rule {
          color: #888;
          font-size: 12px;
        }

        .screenshot-hint {
          margin-top: 8px;
          font-size: 12px;
          color: #888;
          padding: 6px 10px;
          background-color: rgba(35, 35, 35, 0.8);
          border-radius: 3px;
          letter-spacing: 0.3px;
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(-5px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        /* 删除状态栏样式 */

        @media (max-width: 768px) {
          .editor-container {
            flex-direction: column;
          }

          .sidebar {
            width: 100%;
            min-width: 0;
            height: 50%;
            max-width: 100%;
            resize: vertical;
          }

          .resize-handle {
            display: none;
          }

          .preview {
            height: 50%;
          }

          .code-section {
            height: calc(100% - 160px);
          }
        }

        @media (max-height: 800px) {
          .scene-exporter-container {
            top: 10px;
          }

          .ui-controls-container {
            top: 50%;
            right: 20px;
            transform: translateY(-50%);
          }
        }
      `}</style>
    </div>
  );
}
