// @ts-nocheck
import React, { useState, useEffect, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useSceneStore } from "../stores/useSceneStore";

// Add pragmatic inline JSX declarations
declare global {
  namespace JSX {
    interface IntrinsicElements {
      group: any;
      mesh: any;
      boxGeometry: any;
      meshStandardMaterial: any;
      ambientLight: any;
      directionalLight: any;
      gridHelper: any;
    }
  }
}

// Define a proper type for our scene objects
interface SceneObject extends THREE.Object3D {
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
}

// 解析和执行setup函数的组件
const DynamicScene = ({ code }: { code: string }) => {
  const [error, setError] = useState<string | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);

  // 保存创建的对象引用 with proper typing
  const sceneObjectRef = useRef<SceneObject | null>(null);

  useEffect(() => {
    if (!code || !groupRef.current) return;

    try {
      // 清理现有对象
      if (sceneObjectRef.current && groupRef.current) {
        groupRef.current.remove(sceneObjectRef.current);
        if (sceneObjectRef.current.geometry) {
          sceneObjectRef.current.geometry.dispose();
        }
        if (sceneObjectRef.current.material) {
          if (Array.isArray(sceneObjectRef.current.material)) {
            sceneObjectRef.current.material.forEach((m: THREE.Material) =>
              m.dispose()
            );
          } else {
            sceneObjectRef.current.material.dispose();
          }
        }
      }

      // 执行代码
      const setupFunction = createSetupFunction(code);

      // 创建一个模拟的scene对象
      const mockScene = {
        add: (obj: THREE.Object3D) => {
          if (groupRef.current) {
            groupRef.current.add(obj);
          }
          return obj;
        },
        children: groupRef.current?.children || [],
      };

      // 创建模拟的renderer和camera
      const mockRenderer = {
        domElement: document.createElement("div"),
        render: () => {},
      };

      const mockCamera = {
        position: new THREE.Vector3(0, 0, 5),
        lookAt: () => {},
      };

      // 执行setup函数
      const result = setupFunction(mockScene, mockCamera, mockRenderer, THREE, {
        create: () => {
          // 由于我们使用R3F的OrbitControls，这里只需返回一个空对象
          return {
            enableDamping: false,
            update: () => {},
          };
        },
      });

      // 保存返回的对象引用
      sceneObjectRef.current = result;

      setError(null);
    } catch (err) {
      console.error("Code execution error:", err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [code]);

  // 动画帧更新
  useFrame(() => {
    if (groupRef.current) {
      // 更新具有autoRotate属性的对象
      groupRef.current.traverse((child) => {
        if (child.userData && child.userData.autoRotate) {
          child.rotation.x += 0.01;
          child.rotation.y += 0.01;
        }
      });
    }
  });

  return (
    <>
      {/* @ts-expect-error */}
      <group ref={groupRef}>
        {/* 所有动态创建的对象将被添加到这个group中 */}
      </group>

      {/* 如果有错误，显示一个红色立方体 */}
      {error && (
        // @ts-expect-error
        <mesh position={[0, 0, 0]}>
          {/* @ts-expect-error */}
          <boxGeometry args={[1, 1, 1]} />
          {/* @ts-expect-error */}
          <meshStandardMaterial color="red" />
        </mesh>
      )}
    </>
  );
};

// 创建setup函数
function createSetupFunction(code: string) {
  try {
    // 清理代码，处理各种情况
    let cleanCode = code;

    // 移除HTML文档结构
    if (cleanCode.includes("<!DOCTYPE html>") || cleanCode.includes("<html>")) {
      const scriptMatch = cleanCode.match(/<script>([\s\S]*?)<\/script>/);
      if (scriptMatch && scriptMatch[1]) {
        cleanCode = scriptMatch[1].trim();
      }
    }

    // 移除Markdown代码块标记
    if (cleanCode.includes("```")) {
      const codeBlockMatch = cleanCode.match(
        /```(?:js|javascript)?([\s\S]*?)```/
      );
      if (codeBlockMatch && codeBlockMatch[1]) {
        cleanCode = codeBlockMatch[1].trim();
      }
    }

    // 移除import语句
    cleanCode = cleanCode.replace(
      /import\s+.*?from\s+['"].*?['"];?/g,
      "// import removed"
    );
    cleanCode = cleanCode.replace(
      /import\s+{.*?}\s+from\s+['"].*?['"];?/g,
      "// import removed"
    );
    cleanCode = cleanCode.replace(
      /import\s+['"].*?['"];?/g,
      "// import removed"
    );

    // 确保代码是setup函数
    if (!cleanCode.includes("function setup")) {
      cleanCode = `function setup(scene, camera, renderer, THREE, OrbitControls) {
        ${cleanCode}
        return scene.children.find(child => child instanceof THREE.Mesh) || scene;
      }`;
    }

    // 使用Function构造函数创建setup函数
    const functionBody = `
      let setup;
      ${cleanCode}
      if (typeof setup !== 'function') {
        throw new Error('setup function not defined in code');
      }
      return setup;
    `;

    return Function(
      "scene",
      "camera",
      "renderer",
      "THREE",
      "OrbitControls",
      functionBody
    )();
  } catch (err) {
    console.error("Error creating setup function:", err);
    // 返回一个默认函数，创建一个错误指示器（红色立方体）
    return (scene: THREE.Scene) => {
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
      const cube = new THREE.Mesh(geometry, material);
      scene.add(cube);
      return cube;
    };
  }
}

// 主要的ThreeScene组件
export default function ThreeScene({ code }: { code: string }) {
  const { addToHistory } = useSceneStore();

  useEffect(() => {
    if (code) {
      addToHistory(code);
    }
  }, [code, addToHistory]);

  return (
    <div className="preview" style={{ width: "100%", height: "100%" }}>
      <Canvas camera={{ position: [0, 2, 5], fov: 75 }}>
        {/* 基础灯光 */}
        {/* @ts-expect-error */}
        <ambientLight intensity={0.5} />
        {/* @ts-expect-error */}
        <directionalLight position={[5, 5, 5]} intensity={1} />

        {/* 网格参考 */}
        {/* @ts-expect-error */}
        <gridHelper args={[10, 10]} />

        {/* 动态场景 */}
        <DynamicScene code={code} />

        {/* 轨道控制器 */}
        <OrbitControls enableDamping dampingFactor={0.25} />
      </Canvas>
    </div>
  );
}
