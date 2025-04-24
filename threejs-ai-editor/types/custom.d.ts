import { ReactThreeFiber } from "@react-three/fiber";
import { JSX as ThreeJSX } from "react/jsx-runtime";

declare global {
  namespace JSX {
    interface IntrinsicElements
      extends ReactThreeFiber.Object3DNode<ReactThreeFiber.TObject3D, ReactThreeFiber.TEvent>,
        ThreeJSX.IntrinsicElements {}
  }
}
