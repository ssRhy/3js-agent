import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { useSceneStore } from "../../stores/useSceneStore";

export interface ThreeSceneRef {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls?: OrbitControls;
  gltfLoader?: GLTFLoader;
  dynamicGroup?: THREE.Group;
  animationId: number | null;
  objects: Record<string, THREE.Object3D>;
}

export const useThreeScene = (
  containerRef: React.RefObject<HTMLDivElement | null>
) => {
  const threeRef = useRef<ThreeSceneRef | null>(null);
  const { setScene, setDynamicGroup } = useSceneStore();
  const controlsInitializationRef = useRef<boolean>(false);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // 添加客户端环境检查，避免SSR问题
    if (typeof window === "undefined" || typeof document === "undefined") {
      console.log(
        "[Scene] Server-side environment detected, skipping initialization"
      );
      return;
    }

    const container = containerRef.current;
    if (!container) {
      console.log("[Scene] Container ref not available");
      return;
    }

    if (!container.offsetWidth || !container.offsetHeight) {
      console.log("[Scene] Container not ready, dimensions:", {
        width: container.offsetWidth,
        height: container.offsetHeight,
      });
      return;
    }

    // 清理现有场景
    if (threeRef.current) {
      console.log("[Scene] Cleaning up existing scene");
      if (threeRef.current.controls) {
        threeRef.current.controls = undefined;
      }
      threeRef.current.renderer.dispose();
      container.innerHTML = "";
    }

    // 清理任何未完成的重试定时器
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    // 重置控件初始化标志
    controlsInitializationRef.current = false;

    console.log("[Scene] Initializing Three.js scene...");

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
      preserveDrawingBuffer: true,
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
    gridHelper.position.y = -0.01;
    gridHelper.material.opacity = 0.5;
    gridHelper.material.transparent = true;
    scene.add(gridHelper);

    const gltfLoader = new GLTFLoader();

    scene.userData.camera = camera;
    scene.userData.renderer = renderer;

    // 初始化Three.js场景引用
    threeRef.current = {
      scene,
      camera,
      renderer,
      controls: undefined,
      gltfLoader,
      dynamicGroup,
      animationId: null,
      objects: {},
    };

    setScene(scene);
    setDynamicGroup(dynamicGroup);

    // 更可靠的OrbitControls初始化方法
    const initializeControls = (): boolean => {
      if (controlsInitializationRef.current) {
        return true;
      }

      const canvas = renderer.domElement;

      // 详细检查canvas状态
      if (!canvas) {
        console.log("[Controls] Canvas not available");
        return false;
      }

      if (!canvas.parentElement) {
        console.log("[Controls] Canvas parent not available");
        return false;
      }

      if (!document.contains(canvas)) {
        console.log("[Controls] Canvas not in DOM");
        return false;
      }

      // 确保canvas有实际尺寸
      if (canvas.offsetWidth === 0 || canvas.offsetHeight === 0) {
        console.log("[Controls] Canvas has no dimensions:", {
          width: canvas.offsetWidth,
          height: canvas.offsetHeight,
        });
        return false;
      }

      try {
        console.log("[Controls] Creating OrbitControls...");
        const controls = new OrbitControls(camera, canvas);

        // 配置控件
        controls.enableDamping = true;
        controls.dampingFactor = 0.25;
        controls.screenSpacePanning = false;
        controls.maxPolarAngle = Math.PI / 2;

        // 存储控件引用
        scene.userData.orbitControls = controls;

        if (threeRef.current) {
          threeRef.current.controls = controls;
        }

        controlsInitializationRef.current = true;
        console.log("[Controls] OrbitControls initialized successfully");

        // 添加事件监听器来响应物体操作时的控件切换
        const handleToggleControls = (event: CustomEvent) => {
          const { enabled } = event.detail;
          if (controls && "enabled" in controls) {
            (controls as any).enabled = enabled;
            console.log(
              `[Controls] OrbitControls ${
                enabled ? "enabled" : "disabled"
              } via event`
            );
          }
        };

        window.addEventListener(
          "toggleOrbitControls",
          handleToggleControls as EventListener
        );

        // 存储清理函数的引用
        const cleanup = () => {
          window.removeEventListener(
            "toggleOrbitControls",
            handleToggleControls as EventListener
          );
        };

        // 将清理函数存储在controls上，以便在销毁时调用
        (controls as any)._cleanup = cleanup;

        // 发送自定义事件通知控件已就绪
        try {
          window.dispatchEvent(
            new CustomEvent("canvasReady", {
              detail: { canvas, controls },
            })
          );
        } catch (eventError) {
          console.warn(
            "[Controls] Failed to dispatch canvasReady event:",
            eventError
          );
        }

        return true;
      } catch (error) {
        console.error("[Controls] Failed to initialize OrbitControls:", error);
        return false;
      }
    };

    // 使用更好的初始化策略
    const tryInitializeControls = () => {
      if (controlsInitializationRef.current) return;

      if (initializeControls()) {
        return; // 初始化成功，不需要重试
      }

      // 只在真正需要时重试，且有最大重试次数
      let retryCount = 0;
      const maxRetries = 20; // 增加重试次数以应对生产环境的延迟

      const scheduleRetry = () => {
        if (retryCount >= maxRetries || controlsInitializationRef.current) {
          if (retryCount >= maxRetries) {
            console.warn(
              "[Controls] Max retries reached, OrbitControls initialization failed"
            );
          }
          return;
        }

        retryCount++;
        console.log(`[Controls] Retry attempt ${retryCount}/${maxRetries}`);

        retryTimeoutRef.current = setTimeout(() => {
          if (initializeControls()) {
            return; // 成功，停止重试
          }
          scheduleRetry(); // 继续重试
        }, 100 + retryCount * 50); // 递增延迟
      };

      // 开始重试
      scheduleRetry();
    };

    // 确保在多个时机尝试初始化
    // 1. 立即尝试
    setTimeout(tryInitializeControls, 0);

    // 2. 在下一个事件循环中尝试
    setTimeout(tryInitializeControls, 50);

    // 3. 在稍后的时机尝试（应对生产环境的延迟）
    setTimeout(tryInitializeControls, 200);

    const animate = () => {
      if (!threeRef.current) return;

      const { scene, camera, renderer, controls } = threeRef.current;
      if (!scene || !camera || !renderer) return;

      threeRef.current.animationId = requestAnimationFrame(animate);

      if (controls && controls.update) {
        try {
          controls.update();
        } catch (controlsError) {
          console.warn("[Controls] Error updating controls:", controlsError);
        }
      }

      try {
        renderer.render(scene, camera);
      } catch (renderError) {
        console.warn("[Scene] Render error:", renderError);
      }
    };
    animate();

    const handleResize = () => {
      if (!threeRef.current || !container) return;

      try {
        const { camera, renderer } = threeRef.current;
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
        console.log(
          "[Scene] Resized to:",
          container.clientWidth,
          "x",
          container.clientHeight
        );
      } catch (resizeError) {
        console.warn("[Scene] Resize error:", resizeError);
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      console.log("[Scene] Cleaning up scene");

      // 清理重试定时器
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }

      // 清理事件监听器
      window.removeEventListener("resize", handleResize);

      // 重置控件初始化标志
      controlsInitializationRef.current = false;

      // 清理控件
      if (threeRef.current?.controls) {
        try {
          // 调用清理函数来移除事件监听器
          if ((threeRef.current.controls as any)._cleanup) {
            (threeRef.current.controls as any)._cleanup();
          }
          threeRef.current.controls = undefined;
        } catch (controlsDisposeError) {
          console.warn(
            "[Controls] Error cleaning controls:",
            controlsDisposeError
          );
        }
      }

      // 清理渲染器
      if (threeRef.current?.renderer) {
        try {
          threeRef.current.renderer.dispose();
        } catch (rendererDisposeError) {
          console.warn(
            "[Scene] Error disposing renderer:",
            rendererDisposeError
          );
        }
      }
    };
  }, [containerRef, setScene, setDynamicGroup]);

  return threeRef;
};
