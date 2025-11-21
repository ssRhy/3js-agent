// list_collections.js
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ChromaClient } = require("chromadb");

async function main() {
  const client = new ChromaClient(); // 默认 http://localhost:8000
  const collections = await client.listCollections();
  // e.g. collections = ['scene_objects', 'another_collection', …]
  console.log("所有集合：", collections);

  for (const collectionName of collections) {
    // 需要使用 name 参数而不是 collectionId
    const col = await client.getCollection({ name: collectionName });
    const total = await col.count();
    console.log(`集合 "${collectionName}" 共 ${total} 条记录`);

    // // 预览前 5 条
    // const preview = await col.peek();
    // console.log(`前 5 条：`, preview);

    // 如果要获取所有记录，使用 get()
    const allItems = await col.get();
    console.log(`所有记录：`, allItems);
  }
}

main().catch(console.error);
