import React from "react";
import dynamic from "next/dynamic";

// 使用动态导入避免SSR问题
const ThreeCodeEditor = dynamic(() => import("../components/ThreeCodeEditor"), {
  ssr: false,
});

export default function EditorPage() {
  return (
    <div className="container">
      <ThreeCodeEditor />

      <style jsx>{`
        .container {
          height: 100vh;
          width: 100vw;
          padding: 0;
          margin: 0;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}
