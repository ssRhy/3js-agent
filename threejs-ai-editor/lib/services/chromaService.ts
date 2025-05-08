import { Chroma } from "@langchain/community/vectorstores/chroma";
import { AzureOpenAIEmbeddings } from "@langchain/openai";
import { Document } from "@langchain/core/documents";
import "chromadb";
import { SceneStateObject } from "../types/sceneTypes";

// Collection names for different object types
const COLLECTION_NAMES = {
  SCENE_OBJECTS: "scene_objects",
};

// ChromaDB configuration
const CHROMA_CONFIG = {
  host: "localhost",
  port: 8000,
  collectionName: "scene_objects",
  apiUrl: "http://localhost:8000", // Explicitly set the API URL
};

// Define metadata interface for type safety
interface ChromaMetadata {
  id: string;
  type: string;
  name: string;
  objectType: string;
  prompt: string;
  timestamp: string;
  hasFullData?: boolean;
  [key: string]: unknown;
}

// Add enhanced interface for SceneStateObject with objectData
interface EnhancedSceneStateObject extends SceneStateObject {
  objectData?: string; // Full serialized Three.js object data
  [key: string]: unknown; // Allow for additional properties
}

class ChromaService {
  private static instance: ChromaService;
  private embeddings: AzureOpenAIEmbeddings;
  private collections: Record<string, Chroma> = {};
  private initialized = false;

  private constructor() {
    this.embeddings = new AzureOpenAIEmbeddings({
      modelName: "gpt3.5-turbo",
      azureOpenAIApiKey:
        "ES3vLOAy8MUTMui8udIAk2vZO1Fo7qCBHKlaAvcprOXicYTkjzwbJQQJ99BDACHYHv6XJ3w3AAAAACOG4FT8",
      azureOpenAIApiInstanceName: "ai-philxia4932ai122623990161",
      azureOpenAIApiEmbeddingsDeploymentName: "text-embedding-ada-002",
      azureOpenAIApiVersion: "2023-05-15",
    });
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): ChromaService {
    if (!ChromaService.instance) {
      ChromaService.instance = new ChromaService();
    }
    return ChromaService.instance;
  }

  /**
   * Initialize ChromaDB collections
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      console.log("[ChromaService] Initializing ChromaDB collections...");
      console.log(
        `[ChromaService] Connecting to ChromaDB at ${CHROMA_CONFIG.apiUrl}`
      );

      // Initialize scene objects collection with explicit connection parameters
      const collection = await Chroma.fromExistingCollection(this.embeddings, {
        collectionName: COLLECTION_NAMES.SCENE_OBJECTS,
        url: CHROMA_CONFIG.apiUrl,
        collectionMetadata: {
          "hnsw:space": "cosine",
        },
      }).catch(async (err) => {
        console.log(
          `[ChromaService] Collection not found, creating new: ${COLLECTION_NAMES.SCENE_OBJECTS}`
        );
        console.log(`[ChromaService] Error details: ${err.message}`);

        return await Chroma.fromDocuments(
          [], // Initialize with empty documents
          this.embeddings,
          {
            collectionName: COLLECTION_NAMES.SCENE_OBJECTS,
            url: CHROMA_CONFIG.apiUrl,
            collectionMetadata: {
              "hnsw:space": "cosine",
            },
          }
        );
      });

      // Store the collection
      this.collections[COLLECTION_NAMES.SCENE_OBJECTS] = collection;

      this.initialized = true;
      console.log(
        "[ChromaService] ChromaDB collections initialized successfully"
      );
    } catch (error) {
      console.error("[ChromaService] Error initializing ChromaDB:", error);
      throw error;
    }
  }

  /**
   * Store Three.js objects in ChromaDB
   * @param objects Scene objects to store
   * @param prompt User prompt that generated these objects
   * @returns Success status
   */
  public async storeSceneObjects(
    objects: SceneStateObject[],
    prompt: string
  ): Promise<boolean> {
    try {
      await this.ensureInitialized();

      if (!objects || objects.length === 0) {
        console.log("[ChromaDB Debug] No objects to store");
        return true;
      }

      // Debug log all objects being stored
      console.log("[ChromaDB Debug] Writing objects to ChromaDB:");
      objects.forEach((obj, index) => {
        console.log(`[ChromaDB Debug] Object ${index + 1}/${objects.length}:`);
        console.log(`  ID: ${obj.id}`);
        console.log(`  Type: ${obj.type}`);
        console.log(`  Name: ${obj.name || "unnamed"}`);
        console.log(`  Position: ${JSON.stringify(obj.position || "N/A")}`);
        if (obj.rotation)
          console.log(`  Rotation: ${JSON.stringify(obj.rotation)}`);
        if (obj.scale) console.log(`  Scale: ${JSON.stringify(obj.scale)}`);

        // Log if we have full object data
        const enhancedObj = obj as EnhancedSceneStateObject;
        if (enhancedObj.objectData) {
          console.log(
            `  Full object data: Available (${(
              enhancedObj.objectData.length / 1024
            ).toFixed(2)} KB)`
          );
        } else {
          console.log(`  Full object data: Not available`);
        }
      });

      // Prepare documents for storage
      const documents = objects.map((obj) => {
        // Get the full objectData if available or fallback to basic serialization
        const enhancedObj = obj as EnhancedSceneStateObject;
        const hasFullData =
          enhancedObj.objectData && typeof enhancedObj.objectData === "string";

        // Convert object to JSON string for storage, preferring full object data if available
        const content = hasFullData
          ? enhancedObj.objectData! // Use non-null assertion since we check it exists above
          : JSON.stringify(obj);

        // Create metadata for search and retrieval
        const metadata: ChromaMetadata = {
          id: obj.id,
          type: obj.type,
          name: obj.name || "unnamed",
          objectType: obj.type,
          prompt: prompt,
          timestamp: new Date().toISOString(),
          hasFullData: Boolean(hasFullData), // Ensure it's a boolean
        };

        return new Document({ pageContent: content, metadata });
      });

      // Store documents in ChromaDB
      const collection = this.collections[COLLECTION_NAMES.SCENE_OBJECTS];
      await collection.addDocuments(documents);

      // Print memory stats after storing
      const allIds = await this.getAllObjectIds();
      console.log(
        `[ChromaDB Debug] Successfully stored ${objects.length} objects in ChromaDB`
      );
      console.log(
        `[ChromaDB Debug] Total objects in database: ${allIds.length}`
      );

      return true;
    } catch (error) {
      console.error("[ChromaDB Debug] Error storing objects:", error);
      return false;
    }
  }

  /**
   * Retrieve Three.js objects from ChromaDB
   * @param query Text query or object ID to retrieve
   * @param limit Maximum number of objects to retrieve
   * @returns Retrieved scene objects
   */
  public async retrieveSceneObjects(
    query: string,
    limit: number = 10
  ): Promise<SceneStateObject[]> {
    try {
      await this.ensureInitialized();

      console.log(`[ChromaDB Debug] Retrieving objects with query: "${query}"`);

      const collection = this.collections[COLLECTION_NAMES.SCENE_OBJECTS];

      // Check if query is an object ID
      if (query.startsWith("id:")) {
        const id = query.substring(3).trim();
        console.log(`[ChromaDB Debug] Performing ID lookup for: ${id}`);

        try {
          // Use similaritySearch as the reliable method to find by metadata
          const results = await collection.similaritySearch("", 100, {
            id: id,
          });

          if (results && results.length > 0) {
            console.log(
              `[ChromaDB Debug] Found ${results.length} objects with ID: ${id}`
            );

            // Parse stored JSON back to objects
            return results.map((doc) => {
              try {
                const parsed = JSON.parse(doc.pageContent);
                const hasFullData = doc.metadata.hasFullData === true;

                console.log(
                  `[ChromaDB Debug] Retrieved object with ID ${doc.metadata.id}, hasFullData=${hasFullData}`
                );
                return parsed;
              } catch (e) {
                console.error(
                  `[ChromaDB Debug] Error parsing object JSON: ${e}`
                );
                return {
                  id,
                  type: "unknown",
                  error: "Failed to parse object data",
                };
              }
            });
          }
        } catch (error) {
          console.error(`[ChromaDB Debug] Error during ID lookup: ${error}`);
        }

        console.log(`[ChromaDB Debug] No objects found with ID: ${id}`);
        return [];
      }

      // Semantic search
      console.log(
        `[ChromaDB Debug] Performing semantic search for: "${query}"`
      );
      const results = await collection.similaritySearch(query, limit);

      // Log found objects
      console.log(
        `[ChromaDB Debug] Found ${results.length} objects matching query: "${query}"`
      );

      // Parse stored JSON back to objects, considering metadata
      const objects = results.map((doc) => {
        try {
          const parsed = JSON.parse(doc.pageContent);
          const hasFullData = doc.metadata.hasFullData === true;

          if (hasFullData) {
            console.log(
              `[ChromaDB Debug] Retrieved full object data for ${doc.metadata.id}`
            );
          }

          return parsed;
        } catch (e) {
          console.error(`[ChromaDB Debug] Error parsing object JSON: ${e}`);
          return {
            id: doc.metadata.id || "unknown",
            type: doc.metadata.type || "unknown",
            error: "Failed to parse object data",
          };
        }
      });

      // Log detailed info about retrieved objects
      if (objects.length > 0) {
        console.log("[ChromaDB Debug] Retrieved objects details:");
        objects.forEach((obj, index) => {
          console.log(
            `[ChromaDB Debug] Result ${index + 1}/${objects.length}:`
          );
          console.log(`  ID: ${obj.id}`);
          console.log(`  Type: ${obj.type}`);
          console.log(`  Name: ${obj.name || "unnamed"}`);
          if (obj.objectData) {
            console.log(`  Has full object data: Yes`);
          }
        });
      }

      return objects;
    } catch (error) {
      console.error("[ChromaDB Debug] Error retrieving objects:", error);
      return [];
    }
  }

  /**
   * Get all object IDs stored in ChromaDB
   * @returns Array of object IDs
   */
  public async getAllObjectIds(): Promise<string[]> {
    try {
      await this.ensureInitialized();

      const collection = this.collections[COLLECTION_NAMES.SCENE_OBJECTS];

      try {
        // Use similaritySearch as the most reliable method to get all documents
        // Setting a high limit to retrieve most/all documents
        const results = await collection.similaritySearch("", 1000);

        if (results && results.length > 0) {
          // Extract valid IDs from metadata
          const ids = results
            .map((doc) => {
              // Only include valid string IDs
              return typeof doc.metadata.id === "string"
                ? doc.metadata.id
                : null;
            })
            .filter((id): id is string => id !== null); // Type guard to ensure ids are strings

          console.log(`[ChromaDB Debug] Retrieved ${ids.length} object IDs`);
          return ids;
        }
      } catch (error) {
        console.error(
          "[ChromaDB Debug] Error retrieving objects with similaritySearch:",
          error
        );
      }

      console.log("[ChromaDB Debug] No objects found in ChromaDB");
      return [];
    } catch (error) {
      console.error("[ChromaDB Debug] Error getting object IDs:", error);
      return [];
    }
  }

  /**
   * Ensure ChromaDB is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}

// Export a singleton instance
export const chromaService = ChromaService.getInstance();
