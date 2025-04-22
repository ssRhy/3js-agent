// 分析/提取当前代码中已存在的物体（如通过 name 匹配）
import { Scene, Object3D } from "three";

/**
 * 解析场景中的命名对象
 * @param scene Three.js 场景对象
 * @returns 场景中所有具有名称的对象数组
 */
export function parseSceneObjects(scene: Scene): Object3D[] {
  if (!scene) return [];
  return scene.children.filter((child: Object3D): child is Object3D =>
    Boolean(child.name)
  );
}

/**
 * 根据名称查找场景中的对象
 * @param scene Three.js 场景对象
 * @param name 要查找的对象名称
 * @returns 找到的对象或undefined
 */
export function findObjectByName(
  scene: Scene,
  name: string
): Object3D | undefined {
  if (!scene) return undefined;
  return scene.getObjectByName(name) || undefined;
}
