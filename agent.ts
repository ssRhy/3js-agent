// import { AzureChatOpenAI } from "@langchain/openai";
// import { AgentExecutor, createOpenAIToolsAgent } from "langchain/agents";
// import {
//   MessagesPlaceholder,
//   HumanMessagePromptTemplate,
//   SystemMessagePromptTemplate,
//   ChatPromptTemplate,
// } from "@langchain/core/prompts";
// import { lintTool } from "./tools/lintTool";
// import { diffTool } from "./tools/diffTool";
// import { applyPatchTool } from "./tools/applyPatchTool";
// import { codeGenTool } from "./tools/codeGenTool";

// // Initialize Azure OpenAI client
// const model = new AzureChatOpenAI({
//   model: "gpt-4o",
//   temperature: 0,
//   azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
//   azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
//   azureOpenAIApiVersion: "2024-02-15-preview",
//   azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
//   azureOpenAIEndpoint: process.env.AZURE_OPENAI_API_ENDPOINT,
//   maxTokens: 4000,
// });

// /**
//  * Generate initial code based on user instructions
//  * Only called once during the first interaction
//  */
// export async function generate_code(instruction: string): Promise<string> {
//   try {
//     console.log("Generating initial code based on instruction...");
//     return await codeGenTool.func(instruction);
//   } catch (error) {
//     console.error("Error generating initial code:", error);
//     // Return default code if generation fails
//     return `function setup(scene, camera, renderer, THREE, OrbitControls) {
//       const geometry = new THREE.BoxGeometry(1, 1, 1);
//       const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
//       const cube = new THREE.Mesh(geometry, material);
//       scene.add(cube);
//       return cube;
//     }`;
//   }
// }

// /**
//  * Directly analyze screenshot using LLM without the agent loop
//  * Used for subsequent interactions
//  */
// export async function analyzeScreenshotDirectly(
//   screenshotBase64: string,
//   currentCode: string
// ): Promise<string> {
//   try {
//     console.log("Analyzing screenshot directly...");

//     const prompt = `Analyze this Three.js scene screenshot and suggest code improvements:

// Current code:
// \`\`\`javascript
// ${currentCode}
// \`\`\`

// Based on the screenshot (provided as base64), suggest specific Three.js code changes to improve the scene.
// Focus on visual improvements, object positioning, lighting, materials, and user interaction.`;

//     const result = await model.invoke(prompt, {
//       additionalImageBase64s: [screenshotBase64],
//     });

//     return result.content as string;
//   } catch (error) {
//     console.error("Error analyzing screenshot:", error);
//     return "Could not analyze the screenshot. Please try again.";
//   }
// }

// /**
//  * Main agent function that handles the optimization loop
//  * This creates an agent that uses the tools to improve the code
//  */
// export async function runAgentLoop(
//   suggestion: string,
//   currentCode: string,
//   maxIterations = 3
// ): Promise<string> {
//   // Prepare tools for the agent loop - excluding codeGenTool which is only used initially
//   const loopTools = [lintTool, diffTool, applyPatchTool];

//   // Create system message for the agent
//   const systemMessage = SystemMessagePromptTemplate.fromTemplate(
//     "You are a professional Three.js AI assistant responsible for optimizing and fixing Three.js code. " +
//       "Follow these steps to improve the code:\n" +
//       "1. Use the lint tool to check for code issues\n" +
//       "2. Based on lint results and improvement suggestions, create an improved code version\n" +
//       "3. Use the diff tool to generate a patch\n" +
//       "4. Use the apply_patch tool to apply the patch\n" +
//       "Incrementally improve the existing code rather than generating new code from scratch."
//   );

//   // Create human message template
//   const humanPrompt =
//     "Optimize this Three.js code based on the following suggestion:\n\n{suggestion}\n\n" +
//     "Current code:\n```javascript\n{currentCode}\n```\n\n" +
//     "Please improve this code by:\n" +
//     "1. Following Three.js best practices\n" +
//     "2. Implementing the suggested improvements\n" +
//     "3. Maintaining the setup function format\n" +
//     "4. Using the lint tool to check for issues\n" +
//     "5. Using the diff tool to generate patches\n" +
//     "6. Using the apply_patch tool to apply changes";

//   // Create the prompt template
//   const promptTemplate = ChatPromptTemplate.fromMessages([
//     systemMessage,
//     HumanMessagePromptTemplate.fromTemplate(humanPrompt),
//     new MessagesPlaceholder("agent_scratchpad"),
//   ]);

//   try {
//     // Create the agent
//     const agent = await createOpenAIToolsAgent({
//       llm: model,
//       tools: loopTools,
//       prompt: promptTemplate,
//     });

//     // Create executor
//     const executor = new AgentExecutor({
//       agent,
//       tools: loopTools,
//       maxIterations,
//       verbose: true,
//       handleParsingErrors: true,
//       returnIntermediateSteps: false,
//     });

//     // Run the agent
//     const result = await executor.invoke({
//       suggestion,
//       currentCode,
//     });

//     // Extract and clean the output
//     let output = result.output as string;

//     // Clean code - remove HTML structure if present
//     if (output.includes("<!DOCTYPE html>") || output.includes("<html>")) {
//       const scriptMatch = output.match(/<script>([\s\S]*?)<\/script>/);
//       if (scriptMatch && scriptMatch[1]) {
//         output = scriptMatch[1].trim();
//       }
//     }

//     // Remove Markdown code blocks
//     if (output.includes("```")) {
//       const codeBlockMatch = output.match(/```(?:js|javascript)?([\s\S]*?)```/);
//       if (codeBlockMatch && codeBlockMatch[1]) {
//         output = codeBlockMatch[1].trim();
//       }
//     }

//     // Ensure code is a setup function
//     if (!output.includes("function setup")) {
//       output = `function setup(scene, camera, renderer, THREE, OrbitControls) {
//         ${output}
//         return scene.children.find(child => child instanceof THREE.Mesh) || scene;
//       }`;
//     }

//     return output;
//   } catch (error) {
//     console.error("Error running agent loop:", error);
//     return currentCode; // Return original code if optimization fails
//   }
// }
