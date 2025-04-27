# ThreeJS AI Editor History

## Project Overview

This project is a ThreeJS AI Editor built with Next.js and LangChain.js 0.3. It enables the creation and modification of 3D models using AI-assisted tools.

## Components

- **Agent System**: Uses LangChain.js 0.3 agent API to manage tool interactions
- **Tools**:
  - `applyPatchTool`: Applies code patches in unified diff format
  - `codeGenTool`: Generates improved code based on original code
  - `diffTool`: Creates patches between code versions
  - `lintTool`: Checks code for errors and automatically fixes issues
  - `generate_3d_model`: Custom tool for 3D model generation (Hyper3D integration)

## Architecture

- **Frontend**: React components in ThreeJS editor with Monaco editor integration
- **Backend**: Next.js API routes handling agent orchestration and tool execution
- **Memory System**: Tracks code changes and patch history

## Key Features

- Incremental code updates using patches
- AI-driven code generation and optimization
- 3D model generation via Hyper3D API
- Loop-based workflow for continuous improvement
  1. Initial code generation
  2. Screenshot analysis
  3. Code improvement and diff generation
  4. Linting and validation
  5. Patch application

## Libraries and Dependencies

- LangChain.js 0.3
- Next.js 14
- Three.js
- Monaco Editor
- Zustand for state management
- Zod for validation

## History Log

- Initial project setup
- Implemented basic editor functionality
- Added agent system with LangChain.js 0.3
- Integrated Hyper3D for model generation
- Added memory system for tracking changes
