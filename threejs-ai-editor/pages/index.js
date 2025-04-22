import dynamic from "next/dynamic";

// 使用动态导入避免SSR问题
const ThreeCodeEditor = dynamic(() => import("../components/ThreeCodeEditor"), {
  ssr: false,
  loading: () => (
    <div style={{ padding: "20px", textAlign: "center" }}>
      <h1>Three.js AI 编辑器</h1>
      <p>正在加载编辑器，请稍候...</p>
    </div>
  ),
});

export default function Home() {
  return <ThreeCodeEditor />;
}
