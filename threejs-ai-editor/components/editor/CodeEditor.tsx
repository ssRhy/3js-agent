import React, { useRef, useEffect } from "react";
import { Editor, OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

interface CodeEditorProps {
  code: string;
  onChange: (code: string) => void;
  lintErrors: Array<{
    ruleId: string | null;
    severity: number;
    message: string;
    line: number;
    column: number;
  }>;
}

const CodeEditor: React.FC<CodeEditorProps> = ({ code, onChange }) => {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  const handleEditorDidMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  // 当组件重新渲染时，触发编辑器layout更新
  useEffect(() => {
    if (editorRef.current) {
      // 使用 setTimeout 确保DOM更新完成后再触发layout
      const timer = setTimeout(() => {
        editorRef.current?.layout();
      }, 100);

      return () => clearTimeout(timer);
    }
  }, []);

  // 监听窗口resize事件，确保编辑器自适应
  useEffect(() => {
    const handleResize = () => {
      if (editorRef.current) {
        editorRef.current.layout();
      }
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="code-section">
      <div className="code-editor-wrapper">
        <Editor
          height="100%"
          defaultLanguage="javascript"
          value={code}
          onChange={(value) => value !== undefined && onChange(value)}
          onMount={handleEditorDidMount}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            wordWrap: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            lineNumbers: "on",
            glyphMargin: true,
            folding: true,
            contextmenu: true,
            quickSuggestions: true,
            suggestOnTriggerCharacters: true,
            renderLineHighlight: "line",
            selectOnLineNumbers: true,
            roundedSelection: false,
            readOnly: false,
            cursorStyle: "line",
            fontFamily:
              "'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace",
          }}
        />
      </div>
    </div>
  );
};

export default CodeEditor;
