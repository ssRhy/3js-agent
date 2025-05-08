import dynamic from "next/dynamic";

// 使用动态导入避免SSR问题，并设置加载超时时间更长
const ThreeCodeEditor = dynamic(() => import("../components/ThreeCodeEditor"), {
  ssr: false,
  loading: () => (
    <div style={{ padding: "20px", textAlign: "center" }}>
      <h1>Three.js AI 编辑器</h1>
      <p>正在加载编辑器，请稍候...</p>
      <p style={{ color: "#666", marginTop: "20px" }}>
        首次加载可能需要较长时间，请耐心等待...
      </p>
    </div>
  ),
});

export default function Home() {
  return <ThreeCodeEditor />;
}
