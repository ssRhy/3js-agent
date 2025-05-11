import { useEffect, useState, useRef, useCallback } from "react";
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls";
import { DragControls } from "three/examples/jsm/controls/DragControls";
import { useSceneStore } from "../stores/useSceneStore";

type TransformMode = "translate" | "rotate" | "scale";

/**
 * ObjectManipulationControls - A component for direct manipulation of 3D objects in Three.js
 *
 * This component provides a UI for selecting and manipulating 3D objects directly in the scene
 * using Three.js TransformControls and DragControls.
 *
 * Features:
 * - Translation (moving objects)
 * - Rotation
 * - Scaling
 * - Selection control with Shift key for multi-selection
 * - Multi-selection for grouping objects
 * - Creating and manipulating object groups
 *
 * The component integrates with the scene store to track object state changes.
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

  // Find the parent object that should be selected (usually a model or group)
  const findSelectableParent = useCallback(
    (object: THREE.Object3D): THREE.Object3D => {
      let current = object;
      let parent = object.parent;

      // Traverse up the hierarchy to find a suitable parent, but don't go beyond dynamicGroup
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

  // Handle object selection, including multi-select with Shift key
  const handleObjectSelection = useCallback(
    (object: THREE.Object3D | null, event?: MouseEvent) => {
      // If clearing selection and not in multi-select mode, remove all highlights
      if (!object && (!event || !event.shiftKey)) {
        selectedObjects.forEach((obj) => {
          removeHighlight(obj);
        });
        selectObject(null);
        setSelectedObjects([]);
        return;
      }

      // Skip if object is null (should only happen in multi-select mode)
      if (!object) return;

      const isShiftPressed = event && event.shiftKey;

      // Find if the object is already selected
      const objectIndex = selectedObjects.findIndex(
        (obj) => obj.uuid === object.uuid
      );

      if (isShiftPressed) {
        // Multi-select mode with Shift key
        if (objectIndex !== -1) {
          // Object is already selected, deselect it
          const newSelectedObjects = [...selectedObjects];
          newSelectedObjects.splice(objectIndex, 1);

          // Remove highlight from deselected object
          removeHighlight(object);

          setSelectedObjects(newSelectedObjects);

          // Update current selected object to the last one in list, or null
          const newSelected =
            newSelectedObjects.length > 0
              ? newSelectedObjects[newSelectedObjects.length - 1]
              : null;

          selectObject(newSelected);
        } else {
          // Object is not selected, add it to selection
          const newSelectedObjects = [...selectedObjects, object];
          setSelectedObjects(newSelectedObjects);

          // Add highlight to newly selected object
          addHighlight(object);

          // Make this the current selected object for transform controls
          selectObject(object);
        }
      } else {
        // Single select mode (no Shift key)
        // Remove highlights from all previously selected objects
        selectedObjects.forEach((obj) => {
          removeHighlight(obj);
        });

        // Select only this object
        setSelectedObjects([object]);
        selectObject(object);

        // Add highlight to the selected object
        addHighlight(object);
      }
    },
    [selectObject, selectedObjects]
  );

  // Add visual highlight to selected object
  const addHighlight = useCallback((object: THREE.Object3D) => {
    if (!object) return;

    try {
      if (object instanceof THREE.Mesh) {
        // Only add highlight if not already highlighted
        if (!object.userData.isHighlighted) {
          const material = Array.isArray(object.material)
            ? object.material[0]
            : (object.material as THREE.Material);

          // Store original material properties
          if ("emissive" in material && material.emissive) {
            object.userData.originalEmissive = material.emissive.clone();
            material.emissive.set(0x333333);
          } else if ("color" in material) {
            object.userData.originalColor = material.color.clone();
            const color = material.color.clone();
            color.r = Math.min(color.r + 0.2, 1.0);
            color.g = Math.min(color.g + 0.2, 1.0);
            color.b = Math.min(color.b + 0.2, 1.0);
            material.color.copy(color);
          }

          // Add outline effect
          if (!object.userData.outlineEffect) {
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

          object.userData.isHighlighted = true;
        }
      } else if (object instanceof THREE.Group) {
        // Apply highlight to all meshes in the group
        object.traverse((child) => {
          if (child instanceof THREE.Mesh && !child.userData.isOutline) {
            addHighlight(child);
          }
        });

        object.userData.isHighlighted = true;
      }
    } catch (error) {
      console.error("Error adding highlight:", error);
    }
  }, []);

  // Remove highlight from object
  const removeHighlight = useCallback((object: THREE.Object3D) => {
    if (!object) return;

    try {
      if (object instanceof THREE.Mesh) {
        // Restore original material properties
        const material = Array.isArray(object.material)
          ? object.material[0]
          : (object.material as THREE.Material);

        if (object.userData.originalEmissive && "emissive" in material) {
          material.emissive.copy(object.userData.originalEmissive);
          delete object.userData.originalEmissive;
        }

        if (object.userData.originalColor && "color" in material) {
          material.color.copy(object.userData.originalColor);
          delete object.userData.originalColor;
        }

        // Remove outline mesh if it exists
        if (object.userData.outlineEffect) {
          object.remove(object.userData.outlineEffect);
          delete object.userData.outlineEffect;
        }

        object.userData.isHighlighted = false;
      } else if (object instanceof THREE.Group) {
        // Remove highlight from all meshes in the group
        object.traverse((child) => {
          if (child instanceof THREE.Mesh && !child.userData.isOutline) {
            removeHighlight(child);
          }
        });

        object.userData.isHighlighted = false;
      }
    } catch (error) {
      console.error("Error removing highlight:", error);
    }
  }, []);

  // Initialize manipulation controls
  useEffect(() => {
    if (
      !scene ||
      !dynamicGroup ||
      !scene.userData.camera ||
      !scene.userData.renderer
    )
      return;

    // Initialize transform controls and raycaster
    const camera = scene.userData.camera as THREE.Camera;
    const renderer = scene.userData.renderer as THREE.WebGLRenderer;
    const canvas = renderer.domElement;

    // Configure raycaster
    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: 0.2 };
    raycaster.params.Points = { threshold: 0.2 };
    raycaster.layers.set(0);
    raycasterRef.current = raycaster;

    // Create transform controls
    const transformControls = new TransformControls(camera, canvas);
    transformControls.setSize(1.2);
    transformControls.userData.isTransformControl = true;

    // Handle dragging state to toggle orbit controls
    transformControls.addEventListener("dragging-changed", (event) => {
      if (scene.userData.orbitControls) {
        scene.userData.orbitControls.enabled = !event.value;
      }
      setIsDragging(Boolean(event.value));
    });

    // Update object state when transformed
    transformControls.addEventListener("objectChange", () => {
      if (selectedObject) {
        updateObjectState(selectedObject.uuid);
      }
    });

    transformControls.setMode(transformMode);
    scene.add(transformControls);
    transformControlsRef.current = transformControls;

    // Attach to selected object if one exists
    if (selectedObject) {
      transformControls.attach(selectedObject);
    }

    // Create drag controls (used only for object selection, not actual dragging)
    const objects = dynamicGroup.children;
    const dragControls = new DragControls(objects, camera, canvas);
    dragControls.enabled = false; // Disable default behavior, we handle selection manually
    dragControlsRef.current = dragControls;

    // Handle object selection via clicking
    const handleClick = (event: MouseEvent) => {
      if (isDragging) return;

      // Create normalized mouse coordinates
      const mouse = new THREE.Vector2();
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      // Update raycaster
      raycaster.setFromCamera(mouse, camera);

      // Get all selectable objects in scene
      const allObjects = getAllObjectsInScene(dynamicGroup);
      const intersects = raycaster.intersectObjects(allObjects, true);

      if (intersects.length > 0) {
        // Get clicked object
        const clickedObject = intersects[0].object;

        // Find appropriate parent object to select
        const targetObject = findSelectableParent(clickedObject);

        // Select the object
        handleObjectSelection(targetObject, event);
      } else if (!event.shiftKey) {
        // When clicking empty space without Shift, clear selection
        handleObjectSelection(null, event);
      }
    };

    // Handle object hover feedback
    const handleMouseMove = (event: MouseEvent) => {
      if (isDragging) return;

      const mouse = new THREE.Vector2();
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);

      const allObjects = getAllObjectsInScene(dynamicGroup);
      const intersects = raycaster.intersectObjects(allObjects, true);

      if (intersects.length > 0) {
        // Hovering over an object - change cursor accordingly
        document.body.style.cursor = multiSelectMode ? "copy" : "pointer";
      } else {
        // Not hovering over any object
        document.body.style.cursor = multiSelectMode ? "copy" : "auto";
      }
    };

    // Get all selectable objects from the scene
    function getAllObjectsInScene(root: THREE.Object3D): THREE.Object3D[] {
      if (!root) return [];

      const objects: THREE.Object3D[] = [];

      try {
        // Skip transform controls
        if (!root.userData?.isTransformControl) {
          objects.push(root);

          // Add all children recursively
          if (root.children && Array.isArray(root.children)) {
            root.children.forEach((child) => {
              // Skip helper objects
              if (child.userData && child.userData.isHelper) return;
              objects.push(...getAllObjectsInScene(child));
            });
          }
        }
      } catch (error) {
        console.error("Error getting scene objects:", error);
      }

      return objects;
    }

    // Setup event listeners
    canvas.addEventListener("click", handleClick);
    canvas.addEventListener("mousemove", handleMouseMove);

    // Set up keyboard listeners for Shift key (multi-select mode)
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

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    // Cleanup function
    return () => {
      // Remove event listeners
      canvas.removeEventListener("click", handleClick);
      canvas.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);

      // Dispose controls
      if (transformControlsRef.current) {
        transformControlsRef.current.removeEventListener(
          "dragging-changed",
          () => {}
        );
        transformControlsRef.current.removeEventListener(
          "objectChange",
          () => {}
        );
        transformControlsRef.current.detach();
        transformControlsRef.current.dispose();
        transformControlsRef.current.removeFromParent();
        transformControlsRef.current = null;
      }

      if (dragControlsRef.current) {
        dragControlsRef.current.dispose();
        dragControlsRef.current = null;
      }

      document.body.style.cursor = "auto";

      // Re-enable orbit controls
      if (scene.userData.orbitControls) {
        scene.userData.orbitControls.enabled = true;
      }
    };
  }, [
    scene,
    dynamicGroup,
    transformMode,
    selectedObject,
    updateObjectState,
    multiSelectMode,
    isDragging,
    handleObjectSelection,
    findSelectableParent,
  ]);

  // Update transform controls when selected object changes
  useEffect(() => {
    if (!transformControlsRef.current) return;

    if (selectedObject) {
      transformControlsRef.current.attach(selectedObject);
    } else {
      transformControlsRef.current.detach();
    }
  }, [selectedObject]);

  // Update transform mode
  useEffect(() => {
    if (!transformControlsRef.current) return;
    transformControlsRef.current.setMode(transformMode);
  }, [transformMode]);

  // Handle cursor style based on selection mode
  useEffect(() => {
    const cursor = multiSelectMode
      ? "copy"
      : selectedObject
      ? "pointer"
      : "auto";
    document.body.style.cursor = cursor;
  }, [multiSelectMode, selectedObject]);

  // Group selected objects
  const handleGroupSelected = () => {
    if (selectedObjects.length > 1) {
      const group = createGroup(selectedObjects, `Group_${Date.now()}`);
      selectObject(group);
      setSelectedObjects([group]);
    }
  };

  // Ungroup a selected group
  const handleUngroup = () => {
    if (
      selectedObject &&
      selectedObject instanceof THREE.Group &&
      selectedObject.children.length > 0
    ) {
      if (selectedObject === dynamicGroup) {
        console.warn("Cannot ungroup system group");
        return;
      }

      ungroupObjects(selectedObject as THREE.Group);
      selectObject(null);
      setSelectedObjects([]);
    }
  };

  return (
    <div className="object-manipulation-controls">
      <div className="control-panel">
        <div className="title">物体操作控制</div>

        <div className="control-buttons">
          <button
            className={`control-button ${
              transformMode === "translate" ? "active" : ""
            }`}
            onClick={() => setTransformMode("translate")}
            disabled={isDragging}
            title="移动物体"
          >
            <span className="icon">↔</span> 移动
          </button>
          <button
            className={`control-button ${
              transformMode === "rotate" ? "active" : ""
            }`}
            onClick={() => setTransformMode("rotate")}
            disabled={isDragging}
            title="旋转物体"
          >
            <span className="icon">⟳</span> 旋转
          </button>
          <button
            className={`control-button ${
              transformMode === "scale" ? "active" : ""
            }`}
            onClick={() => setTransformMode("scale")}
            disabled={isDragging}
            title="缩放物体"
          >
            <span className="icon">⤧</span> 缩放
          </button>

          <div className="control-group-buttons">
            <button
              className="control-button group"
              onClick={handleGroupSelected}
              disabled={isDragging || selectedObjects.length < 2}
              title="将选中的多个对象组合成一个整体"
            >
              <span className="icon">⊕</span> 组合
            </button>
            <button
              className="control-button ungroup"
              onClick={handleUngroup}
              disabled={
                isDragging ||
                !selectedObject ||
                !(selectedObject instanceof THREE.Group) ||
                selectedObject === dynamicGroup ||
                selectedObject.children.length === 0
              }
              title="将选中的组拆分为单独的对象"
            >
              <span className="icon">⊖</span> 解组
            </button>
          </div>

          <button
            className="control-button cancel"
            onClick={() => {
              selectObject(null);
              setSelectedObjects([]);
            }}
            disabled={
              isDragging || (!selectedObject && selectedObjects.length === 0)
            }
            title="取消当前选择"
          >
            <span className="icon">✕</span> 取消选择
          </button>
        </div>

        {selectedObject && (
          <div className="selected-object-info">
            <span className="info-label">当前选中: </span>
            <span className="info-value">
              {selectedObject.name || selectedObject.type || "未命名物体"}
            </span>
          </div>
        )}

        {(multiSelectMode || selectedObjects.length > 1) && (
          <div
            className={`multi-select-info ${multiSelectMode ? "active" : ""}`}
          >
            <span className="info-count">
              已选择 {selectedObjects.length} 个对象
            </span>
            <span className="info-hint">
              {multiSelectMode
                ? "多选模式已启用 (Shift键按下)"
                : "按住Shift键可选择更多对象"}
            </span>
          </div>
        )}

        {!selectedObject && selectedObjects.length === 0 && (
          <div className="instruction">点击场景中的物体进行选择</div>
        )}

        <div className="controls-guide">
          <div className="guide-item">
            按住 <kbd>Shift</kbd> 可选择多个对象
          </div>
          <div className="guide-item">选择多个对象后可以将它们组合在一起</div>
          <div className="guide-item">选择一个组后可以将它解组为单个对象</div>
        </div>
      </div>

      <style jsx>{`
        .object-manipulation-controls {
          position: absolute;
          right: 15px;
          top: 50%;
          transform: translateY(-50%);
          z-index: 100;
        }

        .control-panel {
          background: rgba(0, 0, 0, 0.8);
          padding: 12px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          backdrop-filter: blur(8px);
          width: 180px;
        }

        .title {
          color: white;
          font-size: 14px;
          font-weight: bold;
          margin-bottom: 12px;
          text-align: center;
          padding-bottom: 8px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.2);
        }

        .control-buttons {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .control-button {
          background: #444;
          color: white;
          border: none;
          padding: 8px 12px;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .icon {
          font-size: 16px;
          width: 20px;
          text-align: center;
        }

        .control-button:hover {
          background: #555;
          transform: translateX(-2px);
        }

        .control-button.active {
          background: #4a8fee;
          box-shadow: 0 0 8px rgba(74, 143, 238, 0.6);
        }

        .control-button.cancel {
          background: #444;
          margin-top: 4px;
        }

        .control-button.cancel:hover {
          background: #e74c3c;
        }

        .control-button:disabled {
          background: #333;
          color: #777;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }

        .control-group-buttons {
          display: flex;
          gap: 8px;
          margin-top: 10px;
          margin-bottom: 5px;
        }

        .control-group-buttons .control-button {
          flex: 1;
          justify-content: center;
          font-size: 13px;
          padding: 6px 8px;
        }

        .control-button.group {
          background: #28a745;
        }

        .control-button.group:hover:not(:disabled) {
          background: #218838;
        }

        .control-button.ungroup {
          background: #ffc107;
          color: #212529;
        }

        .control-button.ungroup:hover:not(:disabled) {
          background: #e0a800;
        }

        .selected-object-info {
          margin-top: 10px;
          font-size: 12px;
          color: #fff;
          text-align: center;
          padding: 6px;
          background: rgba(74, 143, 238, 0.2);
          border-radius: 4px;
        }

        .info-label {
          font-weight: bold;
          color: rgba(255, 255, 255, 0.8);
        }

        .info-value {
          color: #fff;
        }

        .multi-select-info {
          margin-top: 10px;
          font-size: 12px;
          color: #fff;
          text-align: center;
          padding: 6px;
          background: rgba(255, 193, 7, 0.2);
          border-radius: 4px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .multi-select-info.active {
          background: rgba(255, 193, 7, 0.4);
        }

        .info-count {
          font-weight: bold;
        }

        .info-hint {
          font-size: 11px;
          opacity: 0.9;
        }

        .instruction {
          margin-top: 10px;
          font-size: 12px;
          color: #aaa;
          text-align: center;
          font-style: italic;
        }

        .controls-guide {
          margin-top: 15px;
          font-size: 11px;
          color: #aaa;
          padding-top: 10px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }

        .guide-item {
          margin-bottom: 5px;
          line-height: 1.3;
        }

        kbd {
          background: #555;
          padding: 1px 4px;
          border-radius: 3px;
          font-family: monospace;
          font-size: 10px;
        }
      `}</style>
    </div>
  );
}
