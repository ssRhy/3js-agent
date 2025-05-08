# 3js-agent Project

This project combines Three.js with LangChain agents to create a 3D scene editor with AI capabilities. The system includes ChromaDB for vector storage of 3D objects.

## Prerequisites

- Node.js (v16+)
- npm or yarn
- ChromaDB server running locally

## Setup Instructions

1. Install dependencies:

```bash
cd threejs-ai-editor
npm install
```

2. Set up and run ChromaDB server:

ChromaDB needs to be running as a separate process before the application can connect to it.

```bash
# Install ChromaDB standalone server (if not already installed)
pip install chromadb

# Run ChromaDB server
chroma run --host 0.0.0.0 --port 8000
```

3. Run the development server:

```bash
npm run dev
```

## Troubleshooting

### ChromaDB Connection Issues

If you see errors like:

```
ChromaConnectionError: Failed to connect to chromadb. Make sure your server is running and try again.
```

Make sure:

1. ChromaDB server is running on localhost:8000
2. No firewall is blocking the connection
3. The ChromaDB collections have the correct permissions
4. CORS settings are configured properly in ChromaDB

## Architecture

- **Frontend**: React, Next.js, Three.js for 3D visualization
- **Backend**: Next.js API routes with LangChain for AI processing
- **Storage**: ChromaDB for vector embeddings and object retrieval
- **Agent System**: LangChain agents for orchestrating tools and actions

## Development

The project uses a serverless architecture with Next.js API routes. All Vector DB operations happen on the server side through ChromaDB.
