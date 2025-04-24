// Add React Three Fiber JSX types
import { ReactThreeFiber } from "@react-three/fiber";
import * as THREE from "three";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      group: ReactThreeFiber.Object3DNode<THREE.Group, typeof THREE.Group>;
      mesh: ReactThreeFiber.Object3DNode<THREE.Mesh, typeof THREE.Mesh>;
      boxGeometry: ReactThreeFiber.BufferGeometryNode<
        THREE.BoxGeometry,
        typeof THREE.BoxGeometry
      >;
      meshStandardMaterial: ReactThreeFiber.MaterialNode<
        THREE.MeshStandardMaterial,
        typeof THREE.MeshStandardMaterial
      >;
      ambientLight: ReactThreeFiber.LightNode<
        THREE.AmbientLight,
        typeof THREE.AmbientLight
      >;
      directionalLight: ReactThreeFiber.LightNode<
        THREE.DirectionalLight,
        typeof THREE.DirectionalLight
      >;
      gridHelper: ReactThreeFiber.Object3DNode<
        THREE.GridHelper,
        typeof THREE.GridHelper
      >;
    }
  }
}
