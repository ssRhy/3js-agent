import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls";
import { DragControls } from "three/examples/jsm/controls/DragControls";
import { useSceneStore } from "../stores/useSceneStore";

type TransformMode = "translate" | "rotate" | "scale";

/**
 * ObjectManipulationControls - 重构版本
 *
 * 修复的问题：
 * 1. 拆分useEffect，职责分离
 * 2. 完善React Hooks依赖数组
 * 3. 添加SSR安全检查
 * 4. 优化事件监听器绑定/解绑
 * 5. 避免重复创建Three.js控件
 * 6. 优化性能，缓存可选对象列表
 * 7. 修复物体移动时屏幕视角跟随问题
 */
export default function ObjectManipulationControls() {
  const {
    scene,
    dynamicGroup,
    selectObject,
    selectedObject,
    updateObjectState,
    createGroup,
    ungroupObjects,
  } = useSceneStore();

  const [transformMode, setTransformMode] =
    useState<TransformMode>("translate");
  const [isDragging, setIsDragging] = useState(false);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedObjects, setSelectedObjects] = useState<THREE.Object3D[]>([]);

  const transformControlsRef = useRef<TransformControls | null>(null);
  const dragControlsRef = useRef<DragControls | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());

  // SSR安全检查
  const isClient =
    typeof window !== "undefined" && typeof document !== "undefined";

  // 强化的OrbitControls禁用函数
  const disableOrbitControls = useCallback(() => {
    if (scene?.userData?.orbitControls) {
      scene.userData.orbitControls.enabled = false;
      console.log("[ObjectControls] OrbitControls disabled");
    }
  }, [scene]);

  // 强化的OrbitControls启用函数
  const enableOrbitControls = useCallback(() => {
    if (scene?.userData?.orbitControls) {
      scene.userData.orbitControls.enabled = true;
      console.log("[ObjectControls] OrbitControls enabled");
    }
  }, [scene]);

  // 缓存可选对象列表，避免每次都深度遍历
  const selectableObjects = useMemo(() => {
    if (!dynamicGroup || !isClient) return [];

    const objects: THREE.Object3D[] = [];

    const traverse = (root: THREE.Object3D) => {
      if (
        !root.userData?.isTransformControl &&
        !root.userData?.isOutline &&
        !root.userData?.isHelper
      ) {
        objects.push(root);

        if (root.children && Array.isArray(root.children)) {
          root.children.forEach((child) => {
            if (!child.userData?.isHelper && !child.userData?.isOutline) {
              traverse(child);
            }
          });
        }
      }
    };

    try {
      traverse(dynamicGroup);
    } catch (error) {
      console.error("Error getting selectable objects:", error);
    }

    return objects;
  }, [dynamicGroup, isClient]);

  // Find the parent object that should be selected
  const findSelectableParent = useCallback(
    (object: THREE.Object3D): THREE.Object3D => {
      let current = object;
      let parent = object.parent;

      while (parent && parent !== scene && parent !== dynamicGroup) {
        if (parent.userData && parent.userData.selectable !== false) {
          current = parent;
        }
        parent = parent.parent;
      }

      return current;
    },
    [scene, dynamicGroup]
  );

  // Add visual highlight to selected object
  const addHighlight = useCallback(
    (object: THREE.Object3D) => {
      if (!object || !object.parent || !isClient) return;

      try {
        if (object instanceof THREE.Mesh) {
          if (!object.userData.isHighlighted && !object.userData.isOutline) {
            const material = Array.isArray(object.material)
              ? object.material[0]
              : (object.material as THREE.Material);

            if (!material) return;

            if ("emissive" in material && material.emissive) {
              object.userData.originalEmissive = material.emissive.clone();
              material.emissive.set(0x333333);
            } else if ("color" in material && material.color) {
              object.userData.originalColor = material.color.clone();
              const color = material.color.clone();
              color.r = Math.min(color.r + 0.2, 1.0);
              color.g = Math.min(color.g + 0.2, 1.0);
              color.b = Math.min(color.b + 0.2, 1.0);
              material.color.copy(color);
            }

            // 清理旧的outline效果
            if (object.userData.outlineEffect) {
              try {
                if (object.userData.outlineEffect.parent === object) {
                  object.remove(object.userData.outlineEffect);
                }
              } catch (e) {
                console.warn("Could not remove old outline effect:", e);
              }
              delete object.userData.outlineEffect;
            }

            // 添加新的outline效果
            try {
              if (object.geometry) {
                const outlineMaterial = new THREE.MeshBasicMaterial({
                  color: 0x00ffff,
                  wireframe: true,
                  transparent: true,
                  opacity: 0.5,
                });

                const outlineMesh = new THREE.Mesh(
                  object.geometry,
                  outlineMaterial
                );
                outlineMesh.scale.multiplyScalar(1.03);
                outlineMesh.userData.isHelper = true;
                outlineMesh.userData.isOutline = true;

                object.add(outlineMesh);
                object.userData.outlineEffect = outlineMesh;
              }
            } catch (outlineError) {
              console.warn("Could not create outline effect:", outlineError);
            }

            object.userData.isHighlighted = true;
          }
        } else if (object instanceof THREE.Group) {
          object.traverse((child) => {
            if (
              child instanceof THREE.Mesh &&
              !child.userData.isOutline &&
              !child.userData.isHelper &&
              child.parent
            ) {
              addHighlight(child);
            }
          });
          object.userData.isHighlighted = true;
        }
      } catch (error) {
        console.error("Error adding highlight:", error);
      }
    },
    [isClient]
  );

  // Remove highlight from object
  const removeHighlight = useCallback(
    (object: THREE.Object3D) => {
      if (!object || !object.parent || !isClient) return;

      try {
        if (object instanceof THREE.Mesh) {
          const material = Array.isArray(object.material)
            ? object.material[0]
            : (object.material as THREE.Material);

          if (!material) return;

          if (
            object.userData.originalEmissive &&
            "emissive" in material &&
            material.emissive
          ) {
            material.emissive.copy(object.userData.originalEmissive);
            delete object.userData.originalEmissive;
          } else if (
            object.userData.originalColor &&
            "color" in material &&
            material.color
          ) {
            material.color.copy(object.userData.originalColor);
            delete object.userData.originalColor;
          }

          if (object.userData.outlineEffect) {
            try {
              if (object.userData.outlineEffect.parent === object) {
                object.remove(object.userData.outlineEffect);
              }
            } catch (e) {
              console.warn("Could not remove outline effect:", e);
            }
            delete object.userData.outlineEffect;
          }

          object.userData.isHighlighted = false;
        } else if (object instanceof THREE.Group) {
          object.traverse((child) => {
            if (
              child instanceof THREE.Mesh &&
              !child.userData.isOutline &&
              !child.userData.isHelper &&
              child.parent
            ) {
              removeHighlight(child);
            }
          });
          object.userData.isHighlighted = false;
        }
      } catch (error) {
        console.error("Error removing highlight:", error);
      }
    },
    [isClient]
  );

  // Handle object selection with enhanced orbit controls management
  const handleObjectSelection = useCallback(
    (object: THREE.Object3D | null, event: MouseEvent) => {
      try {
        if (multiSelectMode && event.shiftKey && object) {
          const alreadySelected = selectedObjects.includes(object);
          if (alreadySelected) {
            removeHighlight(object);
            setSelectedObjects((prev) => prev.filter((obj) => obj !== object));
          } else {
            addHighlight(object);
            setSelectedObjects((prev) => [...prev, object]);
          }
        } else {
          // 清除之前的选择
          selectedObjects.forEach((obj) => {
            if (obj && obj.parent) removeHighlight(obj);
          });
          if (selectedObject && !selectedObjects.includes(selectedObject)) {
            removeHighlight(selectedObject);
          }

          if (object) {
            // 选择新对象时禁用OrbitControls
            disableOrbitControls();
            addHighlight(object);
            selectObject(object);
            setSelectedObjects([]);

            if (transformControlsRef.current) {
              transformControlsRef.current.attach(object);
            }
          } else {
            // 取消选择时启用OrbitControls
            enableOrbitControls();
            selectObject(null);
            setSelectedObjects([]);

            if (transformControlsRef.current) {
              transformControlsRef.current.detach();
            }
          }
        }
      } catch (error) {
        console.error("Error in object selection:", error);
      }
    },
    [
      multiSelectMode,
      selectedObjects,
      selectedObject,
      removeHighlight,
      addHighlight,
      selectObject,
      disableOrbitControls,
      enableOrbitControls,
    ]
  );

  // 1. 创建TransformControls - 职责分离，增强OrbitControls管理
  useEffect(() => {
    if (
      !isClient ||
      !scene ||
      !scene.userData.camera ||
      !scene.userData.renderer
    ) {
      return;
    }

    const camera = scene.userData.camera as THREE.Camera;
    const renderer = scene.userData.renderer as THREE.WebGLRenderer;
    const canvas = renderer.domElement;

    if (!camera || !canvas || !document.contains(canvas)) {
      return;
    }

    console.log("[ObjectControls] Creating TransformControls...");

    const controls = new TransformControls(camera, canvas);
    controls.setSize(1.2);
    controls.userData.isTransformControl = true;
    controls.setMode(transformMode);

    // 强化的拖拽状态监听
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onDraggingChanged = (event: any) => {
      const isDraggingNow = Boolean(event.value);
      setIsDragging(isDraggingNow);

      if (isDraggingNow) {
        // 开始拖拽时强制禁用OrbitControls
        disableOrbitControls();
        console.log(
          "[ObjectControls] Dragging started - OrbitControls disabled"
        );
      } else {
        // 拖拽结束时，只有在没有选中对象时才启用OrbitControls
        if (!selectedObject && selectedObjects.length === 0) {
          enableOrbitControls();
          console.log(
            "[ObjectControls] Dragging ended - OrbitControls enabled"
          );
        }
      }
    };

    // 对象变换监听
    const onObjectChange = () => {
      if (selectedObject && selectedObject.parent) {
        try {
          updateObjectState(selectedObject.uuid);
        } catch (error) {
          console.error("Error updating object state:", error);
        }
      }
    };

    // 鼠标按下时禁用OrbitControls
    const onMouseDown = () => {
      disableOrbitControls();
    };

    // 鼠标释放时的处理
    const onMouseUp = () => {
      // 只有在没有拖拽且没有选中对象时才启用OrbitControls
      setTimeout(() => {
        if (!isDragging && !selectedObject && selectedObjects.length === 0) {
          enableOrbitControls();
        }
      }, 100);
    };

    controls.addEventListener("dragging-changed", onDraggingChanged);
    controls.addEventListener("objectChange", onObjectChange);
    controls.addEventListener("mouseDown", onMouseDown);
    controls.addEventListener("mouseUp", onMouseUp);

    scene.add(controls);
    transformControlsRef.current = controls;

    return () => {
      console.log("[ObjectControls] Disposing TransformControls...");
      controls.removeEventListener("dragging-changed", onDraggingChanged);
      controls.removeEventListener("objectChange", onObjectChange);
      controls.removeEventListener("mouseDown", onMouseDown);
      controls.removeEventListener("mouseUp", onMouseUp);
      controls.detach();
      controls.enabled = false;
      if (controls.parent) {
        controls.removeFromParent();
      }
      controls.dispose();
      transformControlsRef.current = null;
    };
  }, [
    scene,
    transformMode,
    updateObjectState,
    selectedObject,
    isClient,
    disableOrbitControls,
    enableOrbitControls,
    isDragging,
    selectedObjects,
  ]);

  // 2. 创建DragControls - 职责分离
  useEffect(() => {
    if (
      !isClient ||
      !scene ||
      !scene.userData.camera ||
      !scene.userData.renderer ||
      selectableObjects.length === 0
    ) {
      return;
    }

    const camera = scene.userData.camera as THREE.Camera;
    const renderer = scene.userData.renderer as THREE.WebGLRenderer;
    const canvas = renderer.domElement;

    if (!camera || !canvas || !document.contains(canvas)) {
      return;
    }

    console.log("[ObjectControls] Creating DragControls...");

    const dragControls = new DragControls(selectableObjects, camera, canvas);
    dragControls.enabled = false; // 仅用于选择，不用于拖拽
    dragControlsRef.current = dragControls;

    return () => {
      console.log("[ObjectControls] Disposing DragControls...");
      dragControls.dispose();
      dragControlsRef.current = null;
    };
  }, [scene, selectableObjects, isClient]);

  // 3. 事件监听器绑定 - 职责分离，增强OrbitControls管理
  useEffect(() => {
    if (!isClient || !scene || !scene.userData.renderer) {
      return;
    }

    const renderer = scene.userData.renderer as THREE.WebGLRenderer;
    const canvas = renderer.domElement;
    const camera = scene.userData.camera as THREE.Camera;

    if (!canvas || !camera || !document.contains(canvas)) {
      return;
    }

    console.log("[ObjectControls] Binding event listeners...");

    // 配置raycaster
    const raycaster = raycasterRef.current;
    raycaster.params.Line = { threshold: 0.2 };
    raycaster.params.Points = { threshold: 0.2 };
    raycaster.layers.set(0);

    // 增强的点击事件处理
    const handleClick = (event: MouseEvent) => {
      if (isDragging) return;

      // 点击时先禁用OrbitControls，防止误触发
      disableOrbitControls();

      if (event.button === 2) {
        // 右键清除选择
        if (selectedObjects.length > 0) {
          selectedObjects.forEach((obj) => {
            if (obj && obj.parent) removeHighlight(obj);
          });
        }
        if (selectedObject && !selectedObjects.includes(selectedObject)) {
          removeHighlight(selectedObject);
        }
        selectObject(null);
        setSelectedObjects([]);
        // 清除选择后启用OrbitControls
        enableOrbitControls();
        return;
      }

      const mouse = new THREE.Vector2();
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(selectableObjects, true);

      if (intersects.length > 0) {
        const clickedObject = intersects[0].object;
        if (!clickedObject || !clickedObject.parent) return;

        const targetObject = findSelectableParent(clickedObject);
        const isValidForSelection =
          targetObject &&
          targetObject.parent &&
          typeof targetObject.updateMatrixWorld === "function" &&
          !targetObject.userData?.isHelper &&
          !targetObject.userData?.isOutline &&
          !targetObject.userData?.isTransformControl;

        if (!isValidForSelection) {
          // 无效选择时启用OrbitControls
          enableOrbitControls();
          return;
        }

        if (selectedObject === targetObject && !event.shiftKey) {
          return;
        }

        handleObjectSelection(targetObject, event);
      } else if (!event.shiftKey) {
        handleObjectSelection(null, event);
      }
    };

    // 鼠标移动事件处理
    const handleMouseMove = (event: MouseEvent) => {
      if (isDragging) return;

      const mouse = new THREE.Vector2();
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(selectableObjects, true);

      if (intersects.length > 0) {
        document.body.style.cursor = multiSelectMode ? "copy" : "pointer";
      } else {
        document.body.style.cursor = multiSelectMode ? "copy" : "auto";
      }
    };

    // 右键菜单事件处理
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      if (!isDragging) {
        if (selectedObjects.length > 0) {
          selectedObjects.forEach((obj) => {
            if (obj && obj.parent) removeHighlight(obj);
          });
        }
        if (selectedObject && !selectedObjects.includes(selectedObject)) {
          removeHighlight(selectedObject);
        }
        selectObject(null);
        setSelectedObjects([]);
        // 右键清除选择后启用OrbitControls
        enableOrbitControls();
      }
    };

    // 键盘事件处理
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        setMultiSelectMode(true);
        document.body.style.cursor = "copy";
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        setMultiSelectMode(false);
        document.body.style.cursor = selectedObject ? "pointer" : "auto";
      }
    };

    // 鼠标离开canvas时的处理
    const handleMouseLeave = () => {
      // 如果没有选中对象且没有在拖拽，则启用OrbitControls
      if (!selectedObject && selectedObjects.length === 0 && !isDragging) {
        enableOrbitControls();
      }
    };

    canvas.addEventListener("click", handleClick);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("contextmenu", handleContextMenu);
    canvas.addEventListener("mouseleave", handleMouseLeave);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);

    return () => {
      canvas.removeEventListener("click", handleClick);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("contextmenu", handleContextMenu);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keyup", handleKeyUp);
    };
  }, [
    isClient,
    scene,
    selectableObjects,
    isDragging,
    selectedObject,
    selectedObjects,
    multiSelectMode,
    findSelectableParent,
    handleObjectSelection,
    removeHighlight,
    selectObject,
    disableOrbitControls,
    enableOrbitControls,
  ]);

  // 4. 同步选中对象到TransformControls - 职责分离
  useEffect(() => {
    if (!isClient || !transformControlsRef.current) return;

    const controls = transformControlsRef.current;

    try {
      if (selectedObject && selectedObject.parent) {
        controls.attach(selectedObject);
        addHighlight(selectedObject);
        console.log(
          `[ObjectControls] TransformControls attached to ${
            selectedObject.name || "object"
          }`
        );
      } else {
        controls.detach();
        console.log("[ObjectControls] TransformControls detached");
      }
    } catch (error) {
      console.error("Error syncing TransformControls:", error);
    }
  }, [selectedObject, isClient, addHighlight]);

  // 5. 同步变换模式到TransformControls - 职责分离
  useEffect(() => {
    if (!isClient || !transformControlsRef.current) return;

    try {
      transformControlsRef.current.setMode(transformMode);
      console.log(`[ObjectControls] Transform mode set to ${transformMode}`);
    } catch (error) {
      console.error("Error setting transform mode:", error);
    }
  }, [transformMode, isClient]);

  // 组合选中的对象
  const handleGroupSelected = useCallback(() => {
    if (selectedObjects.length < 2) return;

    try {
      selectedObjects.forEach((obj) => {
        if (obj && obj.parent) removeHighlight(obj);
      });

      const group = createGroup(selectedObjects);
      if (group) {
        selectObject(group);
        setSelectedObjects([]);
        addHighlight(group);

        if (transformControlsRef.current) {
          transformControlsRef.current.attach(group);
        }
      }
    } catch (error) {
      console.error("Error grouping objects:", error);
    }
  }, [
    selectedObjects,
    removeHighlight,
    createGroup,
    selectObject,
    addHighlight,
  ]);

  // 取消组合
  const handleUngroup = useCallback(() => {
    if (!selectedObject || selectedObject.children.length === 0) return;

    try {
      removeHighlight(selectedObject);
      selectedObjects.forEach((obj) => {
        if (obj && obj.parent) {
          removeHighlight(obj);
        }
      });

      if (transformControlsRef.current) {
        transformControlsRef.current.detach();
      }

      ungroupObjects(selectedObject as THREE.Group);
      selectObject(null);
      setSelectedObjects([]);
    } catch (error) {
      console.error("Error ungrouping objects:", error);
    }
  }, [
    selectedObject,
    selectedObjects,
    removeHighlight,
    ungroupObjects,
    selectObject,
  ]);

  // 清理选择
  const handleClearSelection = useCallback(() => {
    if (selectedObjects.length > 0) {
      selectedObjects.forEach((obj) => {
        if (obj && obj.parent) removeHighlight(obj);
      });
    }
    if (selectedObject && !selectedObjects.includes(selectedObject)) {
      removeHighlight(selectedObject);
    }
    selectObject(null);
    setSelectedObjects([]);
    // 清除选择后启用OrbitControls
    enableOrbitControls();
  }, [
    selectedObjects,
    selectedObject,
    removeHighlight,
    selectObject,
    enableOrbitControls,
  ]);

  // 组件卸载时的清理
  useEffect(() => {
    return () => {
      if (isClient && transformControlsRef.current) {
        try {
          transformControlsRef.current.detach();
        } catch (error) {
          console.error(
            "Error detaching transform controls on unmount:",
            error
          );
        }
      }
      // 卸载时恢复OrbitControls
      enableOrbitControls();
    };
  }, [isClient, enableOrbitControls]);

  return (
    <div className="controls-container">
      <div className="controls-header">Object Control</div>

      <div className="control-buttons">
        <button
          className={`control-button ${
            transformMode === "translate" ? "active" : ""
          }`}
          onClick={() => setTransformMode("translate")}
        >
          <span>↔ MOVE</span>
        </button>

        <button
          className={`control-button ${
            transformMode === "rotate" ? "active" : ""
          }`}
          onClick={() => setTransformMode("rotate")}
        >
          <span>⟳ ROTATE</span>
        </button>

        <button
          className={`control-button ${
            transformMode === "scale" ? "active" : ""
          }`}
          onClick={() => setTransformMode("scale")}
        >
          <span>⤧ SCALE</span>
        </button>

        <div className="group-buttons">
          <button
            className="control-button"
            onClick={handleGroupSelected}
            disabled={selectedObjects.length < 2}
          >
            <span>GROUP</span>
          </button>

          <button
            className="control-button"
            onClick={handleUngroup}
            disabled={!selectedObject || selectedObject.children.length === 0}
          >
            <span>UNGROUP</span>
          </button>
        </div>
      </div>

      <div className="footer">
        <button className="deselect-button" onClick={handleClearSelection}>
          Unselect
        </button>
      </div>

      <div className="info-text">Click on objects in the scene to select</div>

      {selectedObjects.length > 0 && (
        <div className="selection-info">
          Selected {selectedObjects.length} objects
        </div>
      )}

      <div className="info-text">Hold Shift to select multiple objects</div>

      <style jsx>{`
        .controls-container {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 5px;
          padding: 10px;
          background-color: rgba(30, 30, 30, 0.85);
          border-radius: 10px;
          backdrop-filter: blur(10px);
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
          border: 1px solid rgba(255, 255, 255, 0.1);
          width: 200px;
        }

        .controls-header {
          color: white;
          font-size: 14px;
          font-weight: 600;
          text-align: center;
          margin-bottom: 5px;
          padding-bottom: 5px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          user-select: none;
        }

        .control-buttons {
          display: grid;
          grid-template-columns: 1fr;
          gap: 5px;
        }

        .control-button {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 8px;
          border: none;
          border-radius: 6px;
          background-color: rgba(255, 255, 255, 0.1);
          color: white;
          cursor: pointer;
          transition: all 0.2s;
        }

        .control-button.active {
          background-color: rgb(22, 94, 152);
        }

        .control-button:hover:not(.active) {
          background-color: rgba(255, 255, 255, 0.15);
        }

        .control-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .group-buttons {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 5px;
          margin-top: 5px;
        }

        .footer {
          display: flex;
          justify-content: center;
          margin-top: 8px;
        }

        .deselect-button {
          width: 100%;
          padding: 6px 10px;
          border: none;
          border-radius: 6px;
          background-color: rgba(244, 67, 54, 0.2);
          color: white;
          cursor: pointer;
          transition: all 0.2s;
        }

        .deselect-button:hover {
          background-color: rgba(244, 67, 54, 0.4);
        }

        .info-text {
          color: rgba(255, 255, 255, 0.7);
          font-size: 11px;
          text-align: center;
          margin-top: 5px;
          line-height: 1.3;
        }

        .selection-info {
          color: #4fc3f7;
          font-size: 12px;
          text-align: center;
          margin-top: 5px;
          padding: 4px 8px;
          background-color: rgba(79, 195, 247, 0.1);
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
}
