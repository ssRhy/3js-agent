import React, { useEffect, useRef, useState } from "react";
import { useSceneStore } from "../stores/useSceneStore";
import { useSocketStore } from "../lib/socket";
import { preprocessCode } from "../lib/processors/codeProcessor";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import * as THREE from "three";

// Hooks
import { useSocketConnection } from "../hooks/socket/useSocketConnection";
import { useThreeScene } from "../hooks/three/useThreeScene";
import { useModelLoader } from "../hooks/model/useModelLoader";
import { useScreenshot } from "../hooks/screenshot/useScreenshot";
import { usePageStatePreservation } from "../hooks/usePageStatePreservation";

// Components
import Sidebar from "./ui/Sidebar";
import ThreePreview from "./preview/ThreePreview";
import EditorStyles from "./ui/EditorStyles";

// Types
interface SceneStateObject {
  id: string;
  type: string;
  name?: string;
  position?: number[];
  rotation?: number[];
  scale?: number[];
  [key: string]: unknown;
}

// OrbitControls兼容接口
interface OrbitControlsLike {
  object?: THREE.Camera;
  domElement?: HTMLElement;
  enabled: boolean;
  enableDamping: boolean;
  dampingFactor: number;
  screenSpacePanning: boolean;
  maxPolarAngle: number;
  update: () => void;
  addEventListener: (type: string, listener: (event?: unknown) => void) => void;
  removeEventListener: (
    type: string,
    listener: (event?: unknown) => void
  ) => void;
  reset?: () => void;
  saveState?: () => void;
  dispose?: () => void;
}

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
  // Container ref for Three.js scene
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 使用页面状态保留hook
  const { syncCodeToStore, syncPromptToStore, isInitialized } =
    usePageStatePreservation();

  // State - 从store中获取初始值
  const { currentCode, currentPrompt, setIsGenerating, setRenderingComplete } =
    useSceneStore();
  const [prompt, setPrompt] = useState<string>(currentPrompt || "");
  const [code, setCode] = useState<string>(
    currentCode ||
      `function setup(scene, camera, renderer, THREE, OrbitControls) {
  // Create OrbitControls
  const controls = OrbitControls.create(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.25;
  
  // Note: You can use the global autoScaleModel function to adjust the size of loaded models
  // Example: Call autoScaleModel(model, desiredSize) after loading the model
  // desiredSize parameter represents the desired longest edge length of the model (default is 5 units)
  
  // Return the scene so that all future objects added to it will be rendered
  return scene;
}`
  );
  const [previousCode] = useState("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [showDiff, setShowDiff] = useState(false);
  const [diff] = useState("");
  const [lastAgentResponse, setLastAgentResponse] = useState<string>("");

  // Lint state
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

  // Rendering state
  const renderingCompleteRef = useRef<boolean>(false);

  // Store hooks
  const {
    addToHistory,
    serializeSceneState,
    isDraggingOrSelecting,
    setIsDraggingOrSelecting,
    registerObject,
    unregisterObject,
    saveSceneToStorage,
    loadSceneFromStorage,
    hasStoredScene,
  } = useSceneStore();

  // Custom hooks
  const { socketConnectionStatus, manualReconnect } = useSocketConnection();
  const threeRef = useThreeScene(containerRef);
  const {
    loadedModels,
    isModelLoading: modelLoaderIsModelLoading,
    allModelUrls,
    setAllModelUrls,
    loadModel,
    autoScaleModel,
  } = useModelLoader(threeRef);
  const { captureScreenshot } = useScreenshot(threeRef);

  // 同步代码变化到store
  useEffect(() => {
    if (isInitialized) {
      syncCodeToStore(code);
    }
  }, [code, isInitialized, syncCodeToStore]);

  // 同步提示变化到store
  useEffect(() => {
    if (isInitialized) {
      syncPromptToStore(prompt);
    }
  }, [prompt, isInitialized, syncPromptToStore]);

  // 生成状态管理
  useEffect(() => {
    setIsGenerating(isLoading);
  }, [isLoading, setIsGenerating]);

  // 渲染完成状态管理
  useEffect(() => {
    if (renderingCompleteRef.current) {
      setRenderingComplete(true);
    } else {
      setRenderingComplete(false);
    }
  }, [setRenderingComplete]);

  // Page load/unload effects
  useEffect(() => {
    const handleBeforeUnload = () => {
      saveSceneToStorage();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [saveSceneToStorage]);

  useEffect(() => {
    const restoreScene = async () => {
      if (hasStoredScene()) {
        const persistedData = loadSceneFromStorage();
        if (persistedData) {
          console.log("页面加载时发现保存的场景状态，准备恢复");
          if (persistedData.modelUrls.length > 0) {
            console.log("检测到保存的模型URL:", persistedData.modelUrls);
          }
          console.log("场景状态恢复完成");
        }
      }
    };

    const timer = setTimeout(restoreScene, 1000);
    return () => clearTimeout(timer);
  }, [hasStoredScene, loadSceneFromStorage]);

  // Auto-scale model global function
  useEffect(() => {
    if (typeof window !== "undefined") {
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
  }, [autoScaleModel]);

  // Lint code effect
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

  // Reset rendering complete flag when code changes
  useEffect(() => {
    if (code) {
      renderingCompleteRef.current = false;
      console.log(
        "[Rendering] Code changed, resetting rendering complete flag"
      );
    }
  }, [code]);

  // Scene manipulation effects
  useEffect(() => {
    if (!isDraggingOrSelecting) {
      setIsDraggingOrSelecting(true);
      console.log("操作模式已自动启用");
    }
  }, [isDraggingOrSelecting, setIsDraggingOrSelecting]);

  // Socket message handling
  useEffect(() => {
    try {
      const { socket } = useSocketStore.getState();
      if (!socket || !socket.connected) {
        console.log("[Socket.IO] Not connected, cannot process messages");
        return;
      }

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

      const handleScreenshotRequest = async (data: {
        requestId: string;
        timestamp: number;
        fromAgent?: boolean;
      }) => {
        try {
          await applySafelyToScene(code);
          const screenshotData = await captureScreenshot();

          if (!screenshotData) {
            throw new Error("Failed to capture scene screenshot");
          }

          socket.emit("provide_screenshot", {
            requestId: data.requestId,
            screenshot: screenshotData,
            userRequirement: prompt,
            returnAnalysis: true,
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

          socket.emit("provide_screenshot_error", {
            requestId: data.requestId,
            error: error instanceof Error ? error.message : String(error),
            timestamp: Date.now(),
          });
        }
      };

      socket.on("agent_result", handleAgentResult);
      socket.on("request_screenshot", handleScreenshotRequest);
      socket.on("screenshot_analysis", (data) => {
        console.log(
          "[Socket.IO] Received analysis info for request:",
          data.requestId
        );
      });

      return () => {
        socket.off("agent_result", handleAgentResult);
        socket.off("request_screenshot", handleScreenshotRequest);
        socket.off("screenshot_analysis");
      };
    } catch (error) {
      console.error("[Socket.IO] Message processing error:", error);
    }
  }, [code, prompt, captureScreenshot]);

  // Code execution effect
  useEffect(() => {
    if (!threeRef.current || !code) return;
    if (code === "") return;

    try {
      const { scene, camera, renderer, dynamicGroup } = threeRef.current;
      if (!scene || !camera || !renderer || !dynamicGroup) {
        console.warn("Scene, camera, renderer or dynamicGroup not available");
        return;
      }

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
        const objectsToRemove: THREE.Object3D[] = [];

        scene.children.forEach((child) => {
          if (
            child instanceof THREE.GridHelper ||
            child instanceof THREE.Light ||
            child === dynamicGroup ||
            (child.userData &&
              (child.userData.modelId || child.userData.isModelObject))
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

          objectsToRemove.push(child);
        });

        objectsToRemove.forEach((obj) => {
          unregisterObject(obj.uuid);
          scene.remove(obj);
          console.log(`从场景移除并取消注册: ${obj.name || "unnamed object"}`);
        });

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

        dynamicObjectsToRemove.forEach((obj) => {
          dynamicGroup.remove(obj);
          console.log(`从dynamicGroup移除: ${obj.name || "unnamed object"}`);
        });

        console.log(
          `场景清理完成，保留了${
            scene.children.length - objectsToRemove.length
          }个对象`
        );
      };

      clearScene();

      if (!validateCode(code)) {
        setError("代码不完整或包含语法错误，请检查代码");
        return;
      }

      try {
        const sanitizedCode = prepareCodeForExecution(code.trim());

        const functionBody = `
          let setup;
          try {
            ${sanitizedCode}
            if (typeof setup !== 'function') {
              throw new Error('setup function not defined in code');
            }
            
            const originalSetup = setup;
            setup = function(scene, camera, renderer, THREE, OrbitControls, GLTFLoader, context) {
              if (context && context.loadedModels) {
                console.log('Setup函数接收到已加载的模型信息:', context.loadedModels.length + '个模型');
              }
              
              return originalSetup(scene, camera, renderer, THREE, OrbitControls, GLTFLoader);
            };
            
            return setup;
          } catch(e) {
            console.error("Setup function parsing error:", e);
            throw e;
          }
        `;

        const OrbitControlsWrapper = {
          create: function (
            cam: THREE.Camera,
            domElement: HTMLElement
          ): OrbitControlsLike | OrbitControls {
            // 检查是否已有controls且工作正常
            if (
              threeRef.current?.controls &&
              (threeRef.current.controls as unknown as { object: THREE.Camera })
                .object === cam
            ) {
              console.log("[OrbitControlsWrapper] Reusing existing controls");
              return threeRef.current.controls;
            }

            // 确保DOM元素已准备好
            if (
              !domElement ||
              !domElement.parentElement ||
              !document.contains(domElement)
            ) {
              console.warn(
                "[OrbitControlsWrapper] DOM element not ready, creating placeholder"
              );
              // 返回一个安全的占位符对象，避免后续代码出错
              return {
                object: cam,
                domElement: domElement,
                enabled: true,
                enableDamping: true,
                dampingFactor: 0.25,
                screenSpacePanning: false,
                maxPolarAngle: Math.PI / 2,
                update: () => {},
                addEventListener: () => {},
                removeEventListener: () => {},
                reset: () => {},
                saveState: () => {},
                dispose: () => {},
              };
            }

            // 如果没有有效的controls，创建新的
            try {
              console.log("[OrbitControlsWrapper] Creating new OrbitControls");
              const controls = new OrbitControls(cam, domElement);
              controls.enableDamping = true;
              controls.dampingFactor = 0.25;
              controls.screenSpacePanning = false;
              controls.maxPolarAngle = Math.PI / 2;

              // 更新threeRef中的controls引用（如果可能）
              if (threeRef.current) {
                threeRef.current.controls = controls;
              }

              console.log(
                "[OrbitControlsWrapper] OrbitControls created successfully"
              );
              return controls;
            } catch (error) {
              console.error(
                "[OrbitControlsWrapper] Failed to create OrbitControls:",
                error
              );
              // 返回一个安全的占位符对象，避免后续代码出错
              return {
                object: cam,
                domElement: domElement,
                enabled: true,
                enableDamping: true,
                dampingFactor: 0.25,
                screenSpacePanning: false,
                maxPolarAngle: Math.PI / 2,
                update: () => {},
                addEventListener: () => {},
                removeEventListener: () => {},
                reset: () => {},
                saveState: () => {},
                dispose: () => {},
              };
            }
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
            "setupContext",
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
            null
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
          console.log(
            "Cleared the scene of objects that can be changed, preparing to rebuild the scene, but retaining loaded models..."
          );

          const loadedModelsData = loadedModels.map((model) => {
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

          const setupContext = {
            loadedModels: loadedModelsData,
            getModelById: (id: string) => {
              let foundModel: THREE.Object3D | null = null;
              scene.traverse((obj) => {
                if (obj.userData && obj.userData.modelId === id) {
                  foundModel = obj;
                }
              });
              return foundModel;
            },
            getAllModels: () => {
              const models: THREE.Object3D[] = [];
              scene.traverse((obj) => {
                if (obj.userData && obj.userData.modelId) {
                  models.push(obj);
                }
              });
              return models;
            },
            modelCount: loadedModelsData.length,
          };

          if (typeof serializeSceneState === "function") {
            const sceneBefore = serializeSceneState();
            console.log(
              `Setup函数执行前场景包含 ${sceneBefore.length} 个对象，其中已加载模型 ${setupContext.modelCount} 个`
            );
          }

          setupFn(
            dynamicGroup,
            camera,
            renderer,
            ExtendedTHREE,
            OrbitControlsWrapper,
            GLTFLoader,
            setupContext
          );

          if (dynamicGroup) {
            console.log(
              "[RegisterObjects] Registering objects in dynamicGroup"
            );
            dynamicGroup.traverse((object) => {
              if (object === dynamicGroup) return;

              const objectUuid = registerObject(object, object.type || "mesh");
              console.log(
                `[RegisterObjects] Registered: ${
                  object.name || "unnamed"
                } (${objectUuid})`
              );
            });
          }

          try {
            if (typeof serializeSceneState === "function") {
              const sceneAfter = serializeSceneState();
              console.log(
                `Setup函数执行后场景包含 ${sceneAfter.length} 个对象`
              );
            }
          } catch (err) {
            console.error("尝试序列化场景状态时出错:", err);
          }

          console.log(
            "Scene reconstruction complete, rendering new scene, retaining loaded models"
          );

          renderer.render(scene, camera);
          addToHistory(code);

          if (error) setError("");
        } catch (e) {
          console.error("代码执行错误:", e);
          setError(
            "Code execution error: " +
              (e instanceof Error ? e.message : String(e))
          );
        }
      } catch (e) {
        console.error("代码评估错误:", e);
        setError(
          "Code evaluation error: " +
            (e instanceof Error ? e.message : String(e))
        );
      }
    } catch (e) {
      console.error("场景处理错误:", e);
      setError("场景处理错误: " + (e instanceof Error ? e.message : String(e)));
    }
  }, [code]);

  // GLTFLoader proxy override
  useEffect(() => {
    if (threeRef.current && threeRef.current.gltfLoader) {
      const originalLoad = threeRef.current.gltfLoader.load;

      threeRef.current.gltfLoader.load = function (
        url,
        onLoad,
        onProgress,
        onError
      ) {
        console.log("Intercepting GLTFLoader.load for URL:", url);

        if (url.startsWith("http") && !url.includes("/api/proxy-model")) {
          console.log("Using proxy for external URL:", url);

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

          return null;
        } else {
          return originalLoad.call(this, url, onLoad, onProgress, onError);
        }
      };
    }
  }, []);

  // Utility functions
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

  const prepareCodeForExecution = (originalCode: string) => {
    const processedCode = preprocessCode(originalCode);

    if (originalCode !== processedCode) {
      console.log("[代码处理] 已替换外部URL为代理URL");
    }

    return processedCode;
  };

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

  const applySafelyToScene = async (codeToApply: string): Promise<boolean> => {
    try {
      console.log("[Rendering] Applying code to scene before screenshot");

      const processedCode = preprocessCode(codeToApply);
      if (processedCode !== codeToApply) {
        console.log("[Rendering] 处理了代码中的外部URL引用");
      }

      if (!validateCode(processedCode) || !threeRef.current) {
        return false;
      }

      renderingCompleteRef.current = false;
      setError("");

      const { scene, camera, renderer } = threeRef.current;
      if (!scene || !camera || !renderer) {
        return false;
      }

      try {
        renderer.render(scene, camera);
        await new Promise((resolve) => setTimeout(resolve, 500));
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

  const captureSceneStateForChromaDB = async () => {
    try {
      if (!threeRef.current || !threeRef.current.dynamicGroup) {
        console.log("[SceneCapture] No dynamic group found");
        return null;
      }

      if (typeof registerObject === "function") {
        let registeredCount = 0;

        threeRef.current.dynamicGroup.traverse((object) => {
          if (object === threeRef.current?.dynamicGroup) return;

          const { objectRegistry } = useSceneStore.getState();
          if (!objectRegistry.has(object.uuid)) {
            registerObject(object, object.type || "mesh");
            registeredCount++;
          }
        });

        if (registeredCount > 0) {
          console.log(
            `[SceneCapture] Registered ${registeredCount} previously unregistered objects`
          );
        }
      }

      const sceneState = serializeSceneState();

      if (sceneState.length === 0) {
        console.log("[SceneCapture] No objects found in scene");
        return null;
      }

      type TypeCountMap = { [key: string]: number };
      const typeCount = sceneState.reduce<TypeCountMap>((acc, obj) => {
        const type = typeof obj.type === "string" ? obj.type : "unknown";
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {});

      console.log(
        `[SceneCapture] Captured ${sceneState.length} objects from the scene:`,
        typeCount
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

  const handleGenerate = async () => {
    if (isLoading || modelLoaderIsModelLoading) return;

    setIsLoading(true);
    setError("");

    try {
      setAllModelUrls((prev) =>
        prev.map((item) => ({ ...item, lastUsed: new Date() }))
      );

      const currentSceneState = await captureSceneStateForChromaDB();
      console.log(
        `The current scene has ${currentSceneState?.length || 0} objects`
      );

      if (!renderingCompleteRef.current && threeRef.current) {
        try {
          console.log("[Generate] Waiting for scene rendering to complete...");
          for (let i = 0; i < 3; i++) {
            threeRef.current.renderer.render(
              threeRef.current.scene,
              threeRef.current.camera
            );
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          renderingCompleteRef.current = true;
        } catch (renderError) {
          console.warn("[Generate] Error rendering scene:", renderError);
        }
      }

      let screenshotDataUrl = null;
      try {
        console.log("[Generate] Generating scene screenshot...");
        screenshotDataUrl = await captureScreenshot();
      } catch (screenError) {
        console.warn("[Generate] Failed to generate screenshot:", screenError);
      }

      const payload: RequestPayload = {
        action: "analyze-screenshot",
        code: code,
        prompt: prompt,
        lintErrors: lintErrors,
        renderingComplete: renderingCompleteRef.current,
        sceneState: currentSceneState
          ? (currentSceneState as unknown as SceneStateObject[])
          : [],
      };

      if (screenshotDataUrl) {
        payload.screenshot = screenshotDataUrl;
      }

      console.log("[Generate] Sending request to backend...", {
        prompt,
        codeLength: code.length,
        hasScreenshot: !!screenshotDataUrl,
        sceneStateSize: currentSceneState?.length || 0,
      });

      const response = await fetch("/api/agentHandler", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Server returned error: ${response.status}`);
      }

      const data = await response.json();
      console.log("[Generate] Received response from backend:", data);

      // Store the conversational response from the agent
      if (data.chatResponse) {
        setLastAgentResponse(data.chatResponse);
        console.log("[Generate] Agent chat response:", data.chatResponse);
      }

      if (data.directCode) {
        const newCode = data.directCode.trim();

        // 添加历史记录
        const addHistoryEntry = useSceneStore.getState().addHistoryEntry;
        addHistoryEntry(newCode, undefined, prompt);

        setCode(newCode);
        console.log("[Generate] Set new code to editor");
      } else if (data.modelUrls && data.modelUrls.length > 0) {
        console.log("[Generate] Processing model URLs:", data.modelUrls);

        const firstModelUrl = data.modelUrls[0];
        const existingModelUrl = allModelUrls.find(
          (item) => item.url === firstModelUrl
        );

        if (existingModelUrl) {
          console.log(
            "[Generate] Using stored model URL:",
            existingModelUrl.url
          );
        }

        const modelLoaded = await loadModel(data.modelUrls[0]);

        if (modelLoaded) {
          const updatedSceneState = await captureSceneStateForChromaDB();
          console.log(
            `[Generate] The updated scene state contains ${
              updatedSceneState?.length || 0
            } objects`
          );

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

          if (updatedSceneState && updatedSceneState.length > 0) {
            console.log(
              `[Generate] The scene state has been updated, containing ${updatedSceneState.length} objects`
            );
          }
        } else {
          throw new Error("Failed to load model");
        }
      } else {
        console.log(
          "[Generate] Request processed, but no code or model updates"
        );
      }
    } catch (error) {
      console.error("[Generate] Failed to process request:", error);
      setError(
        `Failed to process request: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      setIsLoading(false);
    }
  };

  // 版本回溯处理函数
  const handleVersionRevert = async (
    index: number,
    entry: { code: string; modelUrls?: string[] }
  ) => {
    try {
      console.log(`开始恢复到版本 ${index + 1}`);

      // 更新代码编辑器
      setCode(entry.code);

      // 如果有模型URL，需要重新加载模型
      if (entry.modelUrls && entry.modelUrls.length > 0) {
        try {
          // 重新加载第一个模型（简化处理）
          const modelLoaded = await loadModel(entry.modelUrls[0]);
          if (!modelLoaded) {
            setError("模型加载失败，但场景状态已恢复");
          }
        } catch (modelError) {
          console.error("恢复版本时模型加载失败:", modelError);
          setError("模型加载失败，但场景状态已恢复");
        }
      }

      // 清空当前的错误
      setError("");
      console.log(`版本 ${index + 1} 恢复完成`);
    } catch (error) {
      console.error("版本恢复失败:", error);
      setError(
        `版本恢复失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };

  return (
    <div className="editor-container">
      <Sidebar
        socketConnectionStatus={socketConnectionStatus}
        manualReconnect={manualReconnect}
        prompt={prompt}
        setPrompt={setPrompt}
        handleGenerate={handleGenerate}
        isLoading={isLoading}
        isModelLoading={modelLoaderIsModelLoading}
        error={error}
        code={code}
        setCode={setCode}
        lintErrors={lintErrors}
        showDiff={showDiff}
        setShowDiff={setShowDiff}
        diff={diff}
        previousCode={previousCode}
        onVersionRevert={handleVersionRevert}
        lastAgentResponse={lastAgentResponse}
      />

      <ThreePreview
        containerRef={containerRef}
        threeRef={threeRef}
        lintErrors={lintErrors}
        lintOverlayVisible={lintOverlayVisible}
        setLintOverlayVisible={setLintOverlayVisible}
      />

      <EditorStyles />
    </div>
  );
}
