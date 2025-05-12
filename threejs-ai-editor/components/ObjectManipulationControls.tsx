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
          if (obj) removeHighlight(obj);
        });
        selectObject(null);
        setSelectedObjects([]);
        return;
      }

      // Skip if object is null (should only happen in multi-select mode)
      if (!object) return;

      // Skip helper objects, outlines, and transform controls
      if (
        object.userData?.isHelper ||
        object.userData?.isOutline ||
        object.userData?.isTransformControl
      ) {
        return;
      }

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
        // Only add highlight if not already highlighted and not an outline itself
        if (!object.userData.isHighlighted && !object.userData.isOutline) {
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

          // Remove any old outline effect if it exists (cleanup)
          if (object.userData.outlineEffect) {
            try {
              object.remove(object.userData.outlineEffect);
            } catch (e) {
              console.warn("Could not remove old outline effect:", e);
            }
            delete object.userData.outlineEffect;
          }

          // Add new outline effect
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
        // Apply highlight to all meshes in the group
        object.traverse((child) => {
          if (
            child instanceof THREE.Mesh &&
            !child.userData.isOutline &&
            !child.userData.isHelper
          ) {
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
          try {
            const outlineEffect = object.userData.outlineEffect;
            if (outlineEffect && outlineEffect.parent === object) {
              object.remove(outlineEffect);
            }
          } catch (e) {
            console.warn("Error removing outline:", e);
          }
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

    // Get all selectable objects from the scene, filtering out controls and helpers
    const selectableObjects = getAllObjectsInScene(dynamicGroup).filter(
      (obj) =>
        !obj.userData?.isHelper &&
        !obj.userData?.isOutline &&
        !obj.userData?.isTransformControl
    );

    // Create drag controls (used only for object selection, not actual dragging)
    const dragControls = new DragControls(selectableObjects, camera, canvas);
    dragControls.enabled = false; // Disable default behavior, we handle selection manually
    dragControlsRef.current = dragControls;

    // Function to update the list of objects the DragControls tracks
    // Note: DragControls doesn't have a direct setObjects method, so we create a new instance
    const updateSelectableObjects = () => {
      if (dragControlsRef.current) {
        // Dispose of the current controls
        dragControlsRef.current.dispose();

        // Create a new instance with updated objects
        const updatedObjects = getAllObjectsInScene(dynamicGroup).filter(
          (obj) =>
            !obj.userData?.isHelper &&
            !obj.userData?.isOutline &&
            !obj.userData?.isTransformControl
        );

        dragControlsRef.current = new DragControls(
          updatedObjects,
          camera,
          canvas
        );
        dragControlsRef.current.enabled = false; // Keep the same setting
      }
    };

    // Handle object selection via clicking
    const handleClick = (event: MouseEvent) => {
      if (isDragging) return;

      // If right-click, cancel selection and return
      if (event.button === 2) {
        // Use explicit highlight removal method
        if (selectedObjects.length > 0) {
          selectedObjects.forEach((obj) => {
            if (obj) removeHighlight(obj);
          });
        }

        // Also remove highlight from the currently selected object if it exists
        if (selectedObject && !selectedObjects.includes(selectedObject)) {
          removeHighlight(selectedObject);
        }

        // Clear selection state
        selectObject(null);
        setSelectedObjects([]);
        return;
      }

      // Create normalized mouse coordinates
      const mouse = new THREE.Vector2();
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      // Update raycaster
      raycasterRef.current.setFromCamera(mouse, camera);

      // Get all selectable objects in scene
      const allObjects = getAllObjectsInScene(dynamicGroup);
      const intersects = raycasterRef.current.intersectObjects(
        allObjects,
        true
      );

      if (intersects.length > 0) {
        // Get clicked object
        const clickedObject = intersects[0].object;

        // Find appropriate parent object to select
        const targetObject = findSelectableParent(clickedObject);

        // Don't reselect the same object if already selected and not in multi-select mode
        if (selectedObject === targetObject && !event.shiftKey) {
          return;
        }

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

      raycasterRef.current.setFromCamera(mouse, camera);

      const allObjects = getAllObjectsInScene(dynamicGroup);
      const intersects = raycasterRef.current.intersectObjects(
        allObjects,
        true
      );

      if (intersects.length > 0) {
        // Hovering over an object - change cursor accordingly
        document.body.style.cursor = multiSelectMode ? "copy" : "pointer";
      } else {
        // Not hovering over any object
        document.body.style.cursor = multiSelectMode ? "copy" : "auto";
      }
    };

    // Setup event listeners
    canvas.addEventListener("click", handleClick);

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault(); // Prevent default context menu
      if (!isDragging) {
        // Explicitly remove highlights from all selected objects
        if (selectedObjects.length > 0) {
          selectedObjects.forEach((obj) => {
            if (obj) removeHighlight(obj);
          });
        }

        // Also remove highlight from the currently selected object if it exists
        if (selectedObject && !selectedObjects.includes(selectedObject)) {
          removeHighlight(selectedObject);
        }

        // Clear selection state
        selectObject(null);
        setSelectedObjects([]);
      }
    };

    canvas.addEventListener("contextmenu", handleContextMenu);
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

    // Add scene change event listener to update objects
    if (scene) {
      // Update selectable objects periodically
      const updateInterval = setInterval(updateSelectableObjects, 2000);

      return () => {
        // Cleanup
        clearInterval(updateInterval);
        // Remove event listeners
        canvas.removeEventListener("click", handleClick);
        canvas.removeEventListener("contextmenu", handleContextMenu);
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
    }

    return undefined;
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
    selectedObjects,
    removeHighlight,
    selectObject,
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

  // Get all selectable objects from the scene
  function getAllObjectsInScene(root: THREE.Object3D): THREE.Object3D[] {
    if (!root) return [];

    const objects: THREE.Object3D[] = [];

    try {
      // Skip transform controls and outline meshes
      if (
        !root.userData?.isTransformControl &&
        !root.userData?.isOutline &&
        !root.userData?.isHelper
      ) {
        objects.push(root);

        // Add all children recursively
        if (root.children && Array.isArray(root.children)) {
          root.children.forEach((child) => {
            // Skip helper objects and outlines
            if (
              (child.userData &&
                (child.userData.isHelper || child.userData.isOutline)) ||
              (child.type === "LineSegments" && child.userData.isHelper)
            ) {
              return;
            }

            // Recursively add non-helper objects
            objects.push(...getAllObjectsInScene(child));
          });
        }
      }
    } catch (error) {
      console.error("Error getting scene objects:", error);
    }

    return objects;
  }

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
        <button
          className="deselect-button"
          onClick={() => handleObjectSelection(null)}
        >
          取消选择
        </button>
      </div>

      <div className="info-text">点击场景中的物体进行选择</div>

      {selectedObjects.length > 0 && (
        <div className="selection-info">
          已选择 {selectedObjects.length} 个对象
        </div>
      )}

      <div className="info-text">按住 Shift 可选择多个对象</div>

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
          background-color: #2196f3;
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
          color: #ff7961;
          cursor: pointer;
          transition: all 0.2s;
        }

        .deselect-button:hover {
          background-color: rgba(244, 67, 54, 0.3);
        }

        .info-text {
          color: rgba(255, 255, 255, 0.6);
          font-size: 11px;
          text-align: center;
          margin-top: 8px;
          user-select: none;
        }

        .selection-info {
          margin-top: 5px;
          color: white;
          font-size: 12px;
          text-align: center;
          padding: 5px;
          border-radius: 4px;
          background-color: rgba(255, 255, 255, 0.05);
          user-select: none;
        }
      `}</style>
    </div>
  );
}
