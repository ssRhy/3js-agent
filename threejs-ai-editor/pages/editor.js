import dynamic from "next/dynamic";

// 使用动态导入避免SSR问题
const ThreeCodeEditor = dynamic(() => import("../components/ThreeCodeEditor"), {
  ssr: false,
});

export default function EditorPage() {
  return <ThreeCodeEditor />;
}
