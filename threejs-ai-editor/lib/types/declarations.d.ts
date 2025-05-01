// This file contains type declarations for external modules
// that don't have their own type definitions or are missing some.

declare module "diff" {
  interface ParsedDiff {
    hunks: Array<{
      oldStart: number;
      oldLines: number;
      newStart: number;
      newLines: number;
      lines: string[];
    }>;
  }

  export function parsePatch(patch: string): ParsedDiff[];
  export function applyPatch(
    originalText: string,
    patch: ParsedDiff
  ): string | [string, boolean];

  export function diffLines(
    originalCode: string,
    newCode: string
  ): Array<{
    value: string;
    added?: boolean;
    removed?: boolean;
  }>;

  export function createPatch(
    filename: string,
    original: string,
    updated: string
  ): string;
}

// 添加monaco命名空间声明
declare namespace monaco {
  namespace editor {
    interface IStandaloneCodeEditor {
      getValue(): string;
      getModel(): monaco.editor.ITextModel;
      getSelection(): monaco.Selection;
      setSelection(selection: monaco.Selection): void;
    }
  }
}

// 如果@types/three仍然有问题，取消注释
declare module "three/examples/jsm/controls/OrbitControls" {
  import { Camera, Object3D } from "three";
  export class OrbitControls extends Object3D {
    constructor(camera: Camera, domElement?: HTMLElement);
    update(): void;
  }
}
