import { OrbitControls as ThreeOrbitControls } from "three/examples/jsm/controls/OrbitControls";

declare module "three/examples/jsm/controls/OrbitControls" {
  interface OrbitControls extends ThreeOrbitControls {
    enableDamping: boolean;
    dampingFactor: number;
    screenSpacePanning: boolean;
    maxPolarAngle: number;
  }
}
