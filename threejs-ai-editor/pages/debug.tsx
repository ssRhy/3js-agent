import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";

// 动态导入ThreeCodeEditor以避免SSR问题
const ThreeCodeEditor = dynamic(() => import("../components/ThreeCodeEditor"), {
  ssr: false,
  loading: () => <div>Loading Three.js Editor...</div>,
});

export default function DebugPage() {
  const [isClient, setIsClient] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);

  useEffect(() => {
    setIsClient(true);

    // 添加调试信息
    const addDebugInfo = (message: string) => {
      setDebugInfo((prev) => [
        ...prev.slice(-9),
        `${new Date().toLocaleTimeString()}: ${message}`,
      ]);
    };

    addDebugInfo("Debug page mounted");

    // 监听自定义事件以便调试
    const handleCanvasReady = () => {
      addDebugInfo("Canvas ready event fired");
    };

    window.addEventListener("canvasReady", handleCanvasReady);

    // 监听控制台错误
    const originalError = console.error;
    console.error = (...args) => {
      originalError.apply(console, args);
      if (args[0] && typeof args[0] === "string") {
        if (
          args[0].includes("OrbitControls") ||
          args[0].includes("ObjectControls")
        ) {
          addDebugInfo(`Error: ${args[0]}`);
        }
      }
    };

    const originalLog = console.log;
    console.log = (...args) => {
      originalLog.apply(console, args);
      if (args[0] && typeof args[0] === "string") {
        if (
          args[0].includes("[Controls]") ||
          args[0].includes("[ObjectControls]")
        ) {
          addDebugInfo(args[0]);
        }
      }
    };

    return () => {
      window.removeEventListener("canvasReady", handleCanvasReady);
      console.error = originalError;
      console.log = originalLog;
    };
  }, []);

  if (!isClient) {
    return <div>Loading...</div>;
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          height: "80px",
          background: "#1a1a1a",
          color: "white",
          padding: "10px",
          borderBottom: "1px solid #333",
        }}
      >
        <h1>Production Debug Page</h1>
        <p>
          Testing OrbitControls and ObjectManipulationControls in production
          mode
        </p>
      </div>

      <div style={{ display: "flex", flex: 1 }}>
        <div style={{ flex: 1 }}>
          <ThreeCodeEditor />
        </div>

        <div
          style={{
            width: "300px",
            background: "#2a2a2a",
            color: "white",
            padding: "10px",
            overflow: "auto",
            borderLeft: "1px solid #333",
          }}
        >
          <h3>Debug Log</h3>
          <div style={{ fontSize: "12px", fontFamily: "monospace" }}>
            {debugInfo.map((info, index) => (
              <div key={index} style={{ marginBottom: "5px" }}>
                {info}
              </div>
            ))}
          </div>

          <div style={{ marginTop: "20px" }}>
            <h4>Test Instructions:</h4>
            <ul style={{ fontSize: "12px", paddingLeft: "20px" }}>
              <li>Try to rotate the view (drag with mouse)</li>
              <li>Try to zoom (mouse wheel)</li>
              <li>Try to select objects (click on them)</li>
              <li>Check console for error messages</li>
              <li>Use the Object Control panel on the right</li>
            </ul>
          </div>

          <div style={{ marginTop: "20px" }}>
            <h4>Common Issues:</h4>
            <ul style={{ fontSize: "12px", paddingLeft: "20px" }}>
              <li>Canvas not ready - check timing</li>
              <li>Event listeners not bound - check DOM state</li>
              <li>OrbitControls not working - check initialization</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
