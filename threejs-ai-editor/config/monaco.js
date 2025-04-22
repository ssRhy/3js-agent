import * as monaco from "monaco-editor";

// 避免直接导入CSS，而是在运行时加载
export function initMonaco() {
  return monaco;
}

export default monaco;
