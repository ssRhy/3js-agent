import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useSceneStore } from "../stores/useSceneStore";
import { Editor, OnMount } from "@monaco-editor/react";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { applyPatch } from "diff";

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

  // Add rendering complete flag
  const renderingCompleteRef = useRef<boolean>(false);

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
    camera.position.z = 10;
    camera.position.y = 5;
    camera.position.x = 5;
    camera.lookAt(0, 0, 0);

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
  }, [setScene, setDynamicGroup]);

  const loadModel = async (modelUrl: string, modelSize?: number) => {
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

          // This ensures we render whatever was added to the scene or dynamicGroup
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

      // 强制重新渲染场景以确保获取最新状态
      renderer.render(scene, camera);

      // 直接从Three.js canvas获取图像数据
      const threeCanvas = renderer.domElement;
      if (!threeCanvas) {
        console.warn("[Screenshot] Canvas element not found");
        return null;
      }

      // 等待一帧以确保渲染完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 再次渲染确保最新状态
      renderer.render(scene, camera);

      // 直接从canvas获取base64数据
      const imageBase64 = threeCanvas.toDataURL("image/png");
      console.log(
        "[Screenshot] Base64 data generated directly from Three.js, length:",
        imageBase64.length,
        "bytes"
      );

      // 验证数据有效性
      if (
        imageBase64 === "data:," ||
        !imageBase64.startsWith("data:image/png;base64,") ||
        imageBase64.length < 1000 // 增加最小长度要求以确保质量
      ) {
        console.error(
          "[Screenshot] Invalid or too small base64 data from direct capture"
        );
        return null;
      }

      console.log(
        "[Screenshot] Successfully captured scene directly from Three.js"
      );
      return imageBase64;
    } catch (err) {
      console.error("[Screenshot] Capture failed with error:", err);
      setError(
        "无法捕获场景截图: " +
          (err instanceof Error ? err.message : String(err))
      );
      return null;
    }
  };

  // 简化的应用代码到场景函数
  const applySafelyToScene = async (codeToApply: string): Promise<boolean> => {
    try {
      console.log("[Rendering] Applying code to scene before screenshot");
      if (!validateCode(codeToApply) || !threeRef.current) {
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

  // 简化的生成处理函数
  const handleGenerate = async () => {
    if (!prompt) {
      setError("请输入指令");
      return;
    }

    try {
      setIsLoading(true);
      setError("");

      console.log("[Generate] Starting generation process with prompt");

      // 应用当前代码到场景
      await applySafelyToScene(code);

      // 捕获屏幕截图
      const imageBase64 = await captureScreenshot();
      if (!imageBase64) {
        throw new Error("无法捕获场景截图");
      }

      console.log(
        `[Generate] Screenshot captured successfully (${Math.round(
          imageBase64.length / 1024
        )} KB)`
      );

      // 设置渲染完成标志
      renderingCompleteRef.current = true;

      // 获取场景状态
      const sceneState = serializeSceneState();

      // 获取场景历史
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
        console.warn("[Generate] Failed to fetch scene history:", historyError);
      }

      // 检查提示中是否包含模型大小信息
      const sizeRegex = /大小\s*[:：]\s*(\d+(\.\d+)?)/i;
      const sizePrefRegex = /(\d+(\.\d+)?)\s*(尺寸|大小|单位)/i;
      const sizeMatch = prompt.match(sizeRegex) || prompt.match(sizePrefRegex);

      let modelSize: number | undefined = undefined;
      if (sizeMatch && sizeMatch[1]) {
        modelSize = parseFloat(sizeMatch[1]);
      }

      // ===== 新增: 先调用独立的截图分析API =====
      let screenshotAnalysis = null;
      try {
        console.log("[Generate] Calling direct screenshot analysis API");

        const analysisResponse = await fetch("/api/screenshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            screenshot: imageBase64,
            userRequirement: prompt,
          }),
        });

        if (analysisResponse.ok) {
          screenshotAnalysis = await analysisResponse.json();
          console.log("[Generate] Screenshot analysis completed:", {
            status: screenshotAnalysis.status,
            matches_requirements: screenshotAnalysis.matches_requirements,
            needs_improvements: screenshotAnalysis.needs_improvements,
          });
        } else {
          console.warn(
            "[Generate] Screenshot analysis failed with status:",
            analysisResponse.status
          );
          // 创建一个默认分析结果，避免后续处理出错
          screenshotAnalysis = {
            status: "error",
            message: "无法分析截图，将继续生成代码",
            needs_improvements: true,
            recommendation: "截图分析失败，但仍会尝试生成代码",
          };
        }
      } catch (analysisError) {
        console.error(
          "[Generate] Error during screenshot analysis:",
          analysisError
        );
        // 创建一个默认分析结果，避免后续处理出错
        screenshotAnalysis = {
          status: "error",
          message: `分析截图时遇到错误: ${
            analysisError instanceof Error
              ? analysisError.message
              : String(analysisError)
          }`,
          needs_improvements: true,
          recommendation: "截图分析出错，将继续尝试生成代码",
        };
      }
      // ===== 截图分析结束 =====

      // 发送API请求
      console.log(
        "[Generate] Sending request to agent API with analysis result"
      );
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "analyze-screenshot",
          code,
          prompt,
          // 不再发送完整的截图数据，只发送分析结果
          // screenshot: imageBase64,
          screenshotAnalysis, // 发送分析结果而不是原始截图数据
          sceneState,
          sceneHistory,
          lintErrors: lintErrors.length > 0 ? lintErrors : undefined,
          modelSize,
          renderingComplete: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`API responded with status: ${response.status}`);
      }

      // 处理响应
      const data: ApiResponse = await response.json();

      // 处理模型URL
      const modelUrls: string[] = [];
      if (data.modelUrl) {
        setIsModelLoading(true);
        const modelLoaded = await loadModel(data.modelUrl, modelSize);
        setIsModelLoading(false);
        if (modelLoaded) modelUrls.push(data.modelUrl);
      }

      // 处理代码更新
      if (data.directCode) {
        setPreviousCode(code);
        let newCode;

        if (data.patch) {
          try {
            // @ts-expect-error - applyPatch function accepts string but type definition requires ParsedDiff
            const result = applyPatch(code, data.patch);
            if (typeof result === "boolean") {
              newCode = data.directCode;
            } else {
              newCode = result as string;
            }
            setDiff(data.patch);
          } catch (error) {
            console.error("Failed to apply patch:", error);
            newCode = data.directCode;
          }
        } else {
          newCode = data.directCode;
          const diffLines = data.directCode
            .split("\n")
            .filter((line, i) => {
              const oldLines = code.split("\n");
              return i >= oldLines.length || line !== oldLines[i];
            })
            .join("\n");
          setDiff(diffLines);
        }

        setCode(newCode);
        addHistoryEntry(newCode, modelUrls);
      } else if (data.error) {
        throw new Error(data.error);
      }

      // 检查代码中是否包含额外的模型URL
      if (data.directCode && !data.modelUrl) {
        const hyper3dMatches = data.directCode.match(
          /['"]https:\/\/hyperhuman-file\.deemos\.com\/[^'"]+\.glb[^'"]*['"]/g
        );

        if (hyper3dMatches && hyper3dMatches.length > 0) {
          const modelUrl = hyper3dMatches[0].replace(/^['"]|['"]$/g, "");

          setIsModelLoading(true);
          const modelLoaded = await loadModel(modelUrl, modelSize);
          setIsModelLoading(false);

          if (modelLoaded) {
            modelUrls.push(modelUrl);
            addHistoryEntry(code, modelUrls);
          }
        }
      }
    } catch (error) {
      console.error("[Generate] Error:", error);
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
