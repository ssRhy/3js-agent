import React from "react";
import Editor from "@monaco-editor/react";

interface CodeEditorProps {
  value: string;
  onChange: (value: string | undefined) => void;
  language?: string;
}

export default function CodeEditor({
  value,
  onChange,
  language = "javascript",
}: CodeEditorProps) {
  return (
    <Editor
      height="100%"
      defaultLanguage={language}
      value={value}
      onChange={onChange}
      theme="vs-dark"
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        wordWrap: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
      }}
    />
  );
}
