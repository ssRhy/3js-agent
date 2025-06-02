# Three.js AI Editor

An AI-powered editor for creating and editing Three.js scenes through natural language instructions. This project combines Three.js for 3D visualization, Monaco editor for code editing, and LangChain.js 0.3 for AI-driven agent workflows.

## Features

- **AI-Driven 3D Scene Creation**: Generate Three.js scenes from natural language descriptions
- **Interactive 3D Viewport**: Visualize and interact with your 3D scenes in real-time
- **Code Editor Integration**: Edit generated Three.js code directly with Monaco editor
- **Iterative Refinement**: AI agent validates and improves scenes automatically
- **Persistent Memory**: Store and retrieve 3D objects for reuse across sessions

## Core Technologies

- **Next.js**: React framework for the application
- **Three.js**: 3D visualization library
- **LangChain.js 0.3**: Framework for AI agent workflows
- **Monaco Editor**: Code editing capabilities
- **Zustand**: State management
- **ChromaDB**: Vector database for persistent storage

## AI Agentic Workflow

The application follows a complete loop for creating and refining 3D scenes:

1. **User Input**: Provide natural language instructions
2. **Agent Planning**: AI determines the optimal approach
3. **Initial Generation**: Create Three.js code or 3D models
4. **Rendering**: Visualize the scene in the browser
5. **Visual Validation**: Screenshot the scene and analyze results
6. **Iterative Refinement**: Apply patches until the scene matches user intent
7. **Persistence**: Store objects in ChromaDB for future use

## Agent Tools

- **codeGenTool**: Generate or modify Three.js code
- **modelGenTool**: Create 3D models based on descriptions
- **applyPatchTool**: Apply code patches while preserving context
- **screenshotTool**: Capture and analyze scene renderings
- **retrievalTool**: Fetch objects from persistent storage
- **writeChromaTool**: Store generated objects to local database

## Getting Started

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Start the development server:
   ```
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000) in your browser

## License

This project is licensed under the terms included in the [LICENSE](../LICENSE) file.
