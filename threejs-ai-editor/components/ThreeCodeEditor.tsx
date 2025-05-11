import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useSceneStore } from "../stores/useSceneStore";
import { Editor, OnMount } from "@monaco-editor/react";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import ObjectManipulationControls from "./ObjectManipulationControls";

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
  const [prompt, setPrompt] = useState("添加一个旋转的红色立方体");
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
  const [isLoading, setIsLoading] = useState(false);
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
    Array<{ id: string; url: string }>
  >([]);
  const [isModelLoading, setIsModelLoading] = useState(false);

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
      setIsModelLoading(true);

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

      if (loadedModels.some((model) => model.url === urlToLoad)) {
        console.log("Model already loaded:", urlToLoad);
        setIsModelLoading(false);
        return true;
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

                  // 为每个新模型计算唯一位置
                  const existingModels = scene.children.filter(
                    (child) => child.userData.modelId
                  );

                  // 如果指定了模型大小，则使用指定值，否则使用默认值(5)
                  autoScaleModel(model, modelSize || 5);

                  // 计算模型的包围盒以确定其大小
                  const boundingBox = new THREE.Box3().setFromObject(model);
                  const size = boundingBox.getSize(new THREE.Vector3());

                  // 计算模型的高度和最大维度
                  const modelHeight = size.y;
                  const modelMaxDim = Math.max(size.x, size.y, size.z);

                  // 默认位置：保持垂直居中，将模型放在y=0平面上
                  let position = { x: 0, y: modelHeight / 2, z: 0 };

                  // 如果已有模型，计算新位置
                  if (existingModels.length > 0) {
                    // 根据模型大小动态确定放置半径
                    // 对于较大的模型使用更大的间距，避免模型重叠
                    const modelScale = Math.max(1, modelMaxDim / 2);

                    // 使用更大更自由的范围，不再局限于固定半径的圆
                    let angle = Math.random() * Math.PI * 2;
                    const minRadius = modelMaxDim * 2.0; // 增加最小距离为模型最大尺寸的2.0倍
                    const maxRadius =
                      minRadius + 12 + existingModels.length * 1.5; // 更大的扩展范围

                    let radius =
                      minRadius + Math.random() * (maxRadius - minRadius);

                    // 初始计算在xz平面上的位置
                    position = {
                      x:
                        Math.cos(angle) * radius +
                        (Math.random() - 0.5) * modelScale,
                      y: modelHeight / 2, // 保持垂直居中
                      z:
                        Math.sin(angle) * radius +
                        (Math.random() - 0.5) * modelScale,
                    };

                    // 添加一些随机性到y坐标，不再总是对齐到地面
                    if (Math.random() > 0.7) {
                      // 30%的概率
                      position.y += (Math.random() - 0.5) * modelScale * 0.5;
                    }

                    // 检查并避免与现有模型重叠
                    const maxAttempts = 30; // 增加尝试次数
                    let attempts = 0;
                    let overlapping = true;

                    // 用于存储避开方向的映射
                    const avoidDirections: Record<
                      string,
                      { dx: number; dz: number }
                    > = {};

                    while (overlapping && attempts < maxAttempts) {
                      overlapping = false;

                      // 为当前位置计算潜在的边界盒
                      const tempModel = model.clone();
                      tempModel.position.set(
                        position.x,
                        position.y,
                        position.z
                      );
                      const tempBox = new THREE.Box3().setFromObject(tempModel);

                      // 检查与现有模型的碰撞
                      for (const existingModel of existingModels) {
                        if (
                          existingModel.userData &&
                          existingModel.userData.modelId
                        ) {
                          const existingBox = new THREE.Box3().setFromObject(
                            existingModel
                          );

                          // 获取现有模型的中心点
                          const existingCenter = existingBox.getCenter(
                            new THREE.Vector3()
                          );

                          // 如果边界盒相交，则表示有重叠
                          if (tempBox.intersectsBox(existingBox)) {
                            overlapping = true;

                            // 计算当前位置到碰撞物体的方向向量
                            const avoidDirection = {
                              dx: position.x - existingCenter.x,
                              dz: position.z - existingCenter.z,
                            };

                            // 规范化方向向量
                            const length = Math.sqrt(
                              avoidDirection.dx * avoidDirection.dx +
                                avoidDirection.dz * avoidDirection.dz
                            );
                            if (length > 0) {
                              avoidDirection.dx /= length;
                              avoidDirection.dz /= length;
                            }

                            // 记录这个物体的避开方向
                            const objId = existingModel.userData.modelId;
                            avoidDirections[objId] = avoidDirection;

                            // 尝试新位置 - 增加半径并使用智能避开方向
                            radius += modelMaxDim * 1.0; // 更积极地增加半径

                            // 根据已有的避开方向计算综合方向
                            let sumDx = 0,
                              sumDz = 0;
                            let count = 0;

                            for (const dir of Object.values(avoidDirections)) {
                              sumDx += dir.dx;
                              sumDz += dir.dz;
                              count++;
                            }

                            if (count > 0) {
                              // 使用综合避开方向计算新角度
                              angle = Math.atan2(sumDz, sumDx);
                              // 添加一些随机性避免卡在困难位置
                              angle += ((Math.random() - 0.5) * Math.PI) / 8;
                            } else {
                              // 如果没有避开方向，随机尝试新方向
                              angle +=
                                (Math.PI / 4) * (Math.random() * 0.5 + 0.75);
                            }

                            position = {
                              x:
                                Math.cos(angle) * radius +
                                (Math.random() - 0.5) * modelScale * 0.5, // 减小随机性
                              y: position.y, // 保持相同的y坐标
                              z:
                                Math.sin(angle) * radius +
                                (Math.random() - 0.5) * modelScale * 0.5, // 减小随机性
                            };

                            break;
                          }
                        }
                      }

                      attempts++;

                      // 释放临时对象
                      tempModel.clear(); // 只需要清除子对象

                      // 如果尝试次数过多但仍然重叠，增加y轴高度尝试避开
                      if (attempts > maxAttempts * 0.7 && overlapping) {
                        position.y += modelHeight * 0.5;
                        console.log(
                          "Increasing height to avoid overlap:",
                          position.y
                        );
                      }
                    }

                    // 如果仍然重叠，则选择一个安全距离远的位置
                    if (overlapping) {
                      console.log(
                        "Could not find non-overlapping position, using fallback positioning"
                      );
                      // 计算场景中所有模型的最远距离
                      let maxDistanceX = 0;
                      let maxDistanceZ = 0;

                      existingModels.forEach((existingModel) => {
                        const pos = existingModel.position;
                        maxDistanceX = Math.max(maxDistanceX, Math.abs(pos.x));
                        maxDistanceZ = Math.max(maxDistanceZ, Math.abs(pos.z));
                      });

                      // 放置在最远距离外加上模型尺寸的2倍
                      const safeDistance =
                        Math.max(maxDistanceX, maxDistanceZ) + modelMaxDim * 2;
                      const safeAngle = Math.random() * Math.PI * 2;

                      position = {
                        x: Math.cos(safeAngle) * safeDistance,
                        y: modelHeight / 2 + Math.random() * modelHeight, // 稍微抬高
                        z: Math.sin(safeAngle) * safeDistance,
                      };
                    }

                    console.log(
                      `Position found after ${attempts}/${maxAttempts} attempts, overlapping: ${overlapping}`
                    );
                  }

                  // 应用计算出的位置
                  model.position.set(position.x, position.y, position.z);

                  // 随机旋转，使场景更自然
                  if (Math.random() > 0.5) {
                    // 50%的概率
                    model.rotation.y = Math.random() * Math.PI * 2;
                  }

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

                  fitCameraToModel(camera, model);

                  const modelId = `model_${Date.now()}`;
                  model.userData.modelId = modelId;
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

        // 收集要移除的对象
        const objectsToRemove: THREE.Object3D[] = [];

        // 遍历scene的直接子对象，排除基础组件如灯光、网格和dynamicGroup
        scene.children.forEach((child) => {
          // 保留gridHelper, 灯光和dynamicGroup
          if (
            child instanceof THREE.GridHelper ||
            child instanceof THREE.Light ||
            child === dynamicGroup
          ) {
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

        // 清空dynamicGroup
        while (dynamicGroup.children.length > 0) {
          const obj = dynamicGroup.children[0];
          dynamicGroup.remove(obj);
          console.log(`从dynamicGroup移除: ${obj.name || "unnamed object"}`);
        }

        console.log("场景清理完成");
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
          // 添加日志说明清空了场景
          console.log("已清空场景中的所有对象，准备重新构建场景...");

          // Note: We execute the setup function but we ignore its return value
          // Instead, we will continue to use the existing scene/dynamicGroup which is already part of the render loop
          setupFn(
            dynamicGroup,
            camera,
            renderer,
            ExtendedTHREE,
            OrbitControlsWrapper,
            GLTFLoader
          );

          console.log("场景重建完成，渲染新场景");

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

  // Modify the handleGenerate function to include scene capture
  const handleGenerate = async () => {
    try {
      // 清除错误状态
      setError("");
      setSuccess("");
      setIsLoading(true);

      // 确保场景已完全渲染好
      const isThreeJSReady = await applySafelyToScene(code);
      if (!isThreeJSReady) {
        throw new Error("Three.js场景无法正确渲染，请检查代码");
      }

      // 等待一小段时间确保渲染完成
      await new Promise((resolve) => setTimeout(resolve, 200));

      // 先清空服务器端缓存
      await fetch("/api/clearCache", { method: "POST" });

      // 捕获截图
      const screenshotData = await captureScreenshot();

      // Capture full scene state with serialized objects
      const sceneState = await captureSceneStateForChromaDB();

      if (!screenshotData) {
        console.warn("[Generate] No screenshot data available");
      }

      // 更新渲染完成标志
      renderingCompleteRef.current = true;

      // 准备发送到API的数据
      const requestBody: {
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
      } = {
        action: "analyze-screenshot",
        code,
        prompt,
        lintErrors,
        renderingComplete: isThreeJSReady,
      };

      // 如果有截图数据，添加到请求中
      if (screenshotData) {
        requestBody.screenshot = screenshotData;
      }

      // 如果有场景对象，添加到请求中 - 使用我们新捕获的完整对象数据
      if (sceneState && sceneState.length > 0) {
        requestBody.sceneState = sceneState as unknown as SceneStateObject[];
      }

      console.log(
        `[Generate] 发送请求到API，${
          screenshotData ? "包含" : "不包含"
        }截图数据，包含${sceneState?.length || 0}个场景对象`
      );

      // 发送请求到API
      const response = await fetch("/api/agentHandler", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(
          `API请求失败: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();

      // 处理API响应
      if (data.error) {
        throw new Error(`API错误: ${data.error}`);
      }

      if (data.directCode) {
        // 使用URL处理器处理代码
        const processedCode = preprocessCode(data.directCode);
        if (processedCode !== data.directCode) {
          console.log("[Generate] 已处理代码中的外部模型URL");
        }

        // 更新代码并安全应用到场景
        setCode(processedCode);
        setSuccess("代码已更新，正在应用到场景...");

        try {
          await applySafelyToScene(processedCode);
          setSuccess("代码已成功应用到场景！");
        } catch (applyError) {
          console.error("[Generate] 应用代码到场景失败:", applyError);
          setError(
            `应用代码失败: ${
              applyError instanceof Error
                ? applyError.message
                : String(applyError)
            }`
          );
        }
      } else if (data.modelUrls && data.modelUrls.length > 0) {
        // 处理生成的模型URL
        setSuccess(`已生成${data.modelUrls.length}个模型！正在加载...`);

        try {
          // 处理并记录所有模型URL
          console.log("[Generate] 处理模型URL:", data.modelUrls);

          // 加载第一个模型 (loadModel函数已经内置了URL处理逻辑)
          await loadModel(data.modelUrls[0]);
          setSuccess("模型已成功加载！");
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
                ? "生成并分析场景" // 当场景渲染完成时，明确显示将分析场景
                : "生成场景代码"}
            </button>
            {renderingCompleteRef.current && (
              <div className="screenshot-hint">
                <span className="camera-icon">📷</span>
                点击生成时将自动分析当前场景
              </div>
            )}
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

      {/* 状态显示区域 - 移除操作模式切换按钮 */}
      <div className="status-bar">
        {/* 显示Socket.IO连接状态 */}
        <div className="connection-status">
          <span className={`status-indicator ${socketConnectionStatus}`}></span>
          <span>{socketConnectionStatus === "open" ? "已连接" : "未连接"}</span>
          {socketConnectionStatus === "error" && (
            <button className="reconnect-button" onClick={manualReconnect}>
              重连
            </button>
          )}
        </div>

        {/* 信息提示部分 */}
        <div className="mode-info">
          <span className="info-text">对象操作模式已启用</span>
        </div>
      </div>

      {/* 始终显示操作控制面板 */}
      <ObjectManipulationControls />

      <style jsx>{`
        .editor-container {
          display: flex;
          height: 100vh;
          width: 100%;
          overflow: hidden;
        }

        .sidebar {
          display: flex;
          flex-direction: column;
          width: 40%;
          min-width: 400px;
          padding: 15px;
          background-color: #f5f5f5;
          border-right: 1px solid #ddd;
          overflow-y: auto;
        }

        .sidebar-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 15px;
        }

        .sidebar-header h2 {
          margin: 0;
          color: #333;
          font-size: 20px;
        }

        .prompt-section {
          margin-bottom: 15px;
        }

        .prompt-label {
          display: block;
          margin-bottom: 5px;
          font-weight: bold;
          color: #555;
        }

        .status-section {
          margin-bottom: 15px;
        }

        .preview {
          flex-grow: 1;
          height: 100%;
          position: relative;
          background-color: #f0f0f0;
        }

        .button-group {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 10px;
        }

        .ws-status {
          padding: 4px 8px;
          margin: 4px 0;
          border-radius: 4px;
          font-size: 12px;
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .status-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .ws-status.open {
          background-color: #d4edda;
          color: #155724;
        }

        .ws-status.open .status-dot {
          background-color: #28a745;
        }

        .ws-status.connecting {
          background-color: #fff3cd;
          color: #856404;
        }

        .ws-status.connecting .status-dot {
          background-color: #ffc107;
        }

        .ws-status.closed,
        .ws-status.error {
          background-color: #f8d7da;
          color: #721c24;
        }

        .ws-status.closed .status-dot,
        .ws-status.error .status-dot {
          background-color: #dc3545;
        }

        .success {
          background-color: #d4edda;
          color: #155724;
          padding: 8px;
          margin: 8px 0;
          border-radius: 4px;
          border-left: 4px solid #28a745;
        }

        .error {
          background-color: #f8d7da;
          color: #721c24;
          padding: 8px;
          margin: 8px 0;
          border-radius: 4px;
          border-left: 4px solid #dc3545;
        }

        .reconnect-button {
          margin-left: 8px;
          font-size: 12px;
          padding: 2px 6px;
          background: #007bff;
          color: white;
          border: none;
          border-radius: 3px;
          cursor: pointer;
        }

        .reconnect-button:hover {
          background: #0069d9;
        }

        .connection-message {
          background-color: #fff3cd;
          border: 1px solid #ffeeba;
          color: #856404;
          padding: 12px;
          margin: 10px 0;
          border-radius: 4px;
          text-align: center;
        }

        .connection-message p {
          margin: 5px 0;
        }

        .prompt-input {
          width: 100%;
          padding: 10px;
          margin-bottom: 10px;
          border: 1px solid #ccc;
          border-radius: 4px;
          resize: vertical;
          font-family: "Arial", sans-serif;
        }

        .generate-button {
          background-color: #4a90e2;
          color: white;
          border: none;
          padding: 10px 15px;
          border-radius: 4px;
          cursor: pointer;
          font-weight: bold;
          transition: background-color 0.3s;
        }

        .generate-button:hover:not(:disabled) {
          background-color: #357ab8;
        }

        .generate-button:disabled {
          background-color: #a0a0a0;
          cursor: not-allowed;
        }

        .code-section {
          display: flex;
          flex-direction: column;
          flex-grow: 1;
          height: calc(100% - 240px);
          margin-top: 10px;
          border: 1px solid #ccc;
          border-radius: 4px;
          overflow: hidden;
        }

        .code-header {
          background-color: #2d2d2d;
          color: #ddd;
          margin: 0;
          padding: 8px 12px;
          font-size: 14px;
          border-bottom: 1px solid #444;
        }

        .loading-model {
          display: flex;
          align-items: center;
          gap: 8px;
          background-color: #e6f7ff;
          border: 1px solid #91d5ff;
          border-radius: 4px;
          padding: 8px;
          margin: 8px 0;
        }

        .loading-spinner {
          display: inline-block;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          border: 2px solid #1890ff;
          border-top-color: transparent;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        .diff-toggle {
          margin: 8px 0;
        }

        .diff-toggle button {
          background: #6c757d;
          color: white;
          border: none;
          padding: 5px 10px;
          border-radius: 4px;
          cursor: pointer;
        }

        .diff-toggle button:hover {
          background: #5a6268;
        }

        .lint-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: rgba(0, 0, 0, 0.5);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 1000;
        }

        .lint-overlay-content {
          background-color: white;
          border-radius: 4px;
          padding: 20px;
          width: 80%;
          max-width: 800px;
          max-height: 80vh;
          overflow-y: auto;
          position: relative;
        }

        .close-button {
          position: absolute;
          top: 10px;
          right: 10px;
          background: none;
          border: none;
          font-size: 20px;
          cursor: pointer;
        }

        .lint-errors-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .lint-error-item {
          padding: 8px;
          border-bottom: 1px solid #eee;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .lint-error-location {
          font-weight: bold;
          color: #6200ee;
          min-width: 80px;
        }

        .lint-error-message {
          flex-grow: 1;
          color: #333;
        }

        .lint-error-rule {
          color: #718096;
          font-size: 12px;
        }

        .screenshot-hint {
          margin-top: 8px;
          font-size: 12px;
          color: #666;
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .camera-icon {
          font-size: 14px;
        }

        /* 状态栏样式优化 */
        .status-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 5px 10px;
          background-color: #252525;
          color: #ccc;
          font-size: 0.8rem;
          border-top: 1px solid #333;
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          z-index: 90;
        }

        .connection-status {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .status-indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          display: inline-block;
        }

        .status-indicator.open {
          background-color: #4caf50;
        }

        .status-indicator.closed,
        .status-indicator.connecting {
          background-color: #ff9800;
        }

        .status-indicator.error {
          background-color: #f44336;
        }

        .reconnect-button {
          background-color: #3d5afe;
          color: white;
          border: none;
          border-radius: 4px;
          padding: 3px 8px;
          margin-left: 5px;
          cursor: pointer;
          font-size: 0.7rem;
        }

        .mode-info {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .info-text {
          color: #ccc;
          font-size: 0.8rem;
        }

        @media (max-width: 768px) {
          .editor-container {
            flex-direction: column;
          }

          .sidebar {
            width: 100%;
            min-width: 0;
            height: 50%;
          }

          .preview {
            height: 50%;
          }

          .code-section {
            height: 200px;
          }
        }
      `}</style>
    </div>
  );
}
