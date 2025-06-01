import React, { useRef } from "react";
import { Editor, OnMount } from "@monaco-editor/react";

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

const CodeEditor: React.FC<CodeEditorProps> = ({
  code,
  onChange,
  
}) => {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  const handleEditorDidMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  return (
    <div className="code-section">
      <h3 className="code-header">Three.js Scene Code</h3>
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
        }}
      />
    </div>
  );
};

export default CodeEditor;
