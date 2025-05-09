// clear_collection.js
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ChromaClient } = require("chromadb");

async function main() {
  const client = new ChromaClient();
  const collections = await client.listCollections();

  console.log("要删除的集合列表：", collections);

  for (const collectionName of collections) {
    await client.deleteCollection({ name: collectionName });
    console.log(`集合 "${collectionName}" 已删除`);
  }
}

main().catch(console.error);
