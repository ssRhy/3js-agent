import { NextApiRequest, NextApiResponse } from "next";
import { Linter } from "eslint";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: "No code provided" });
    }

    // Initialize ESLint with appropriate configuration
    const eslint = new Linter();
    const lintConfig: Linter.Config = {
      languageOptions: {
        ecmaVersion: 2020,
        sourceType: "script",
        globals: {
          // Three.js and browser globals
          THREE: "readonly",
          OrbitControls: "readonly",
          scene: "readonly",
          camera: "readonly",
          renderer: "readonly",
          // Browser environment globals
          window: "readonly",
          document: "readonly",
          console: "readonly",
          setTimeout: "readonly",
          clearTimeout: "readonly",
          requestAnimationFrame: "readonly",
        },
        parserOptions: {
          ecmaVersion: 2020,
        },
      },
      rules: {
        // Basic rules for cleaner Three.js code
        "no-undef": "error",
        "no-unused-vars": "warn",
        semi: ["error", "always"],
        "no-extra-semi": "warn",
        quotes: ["warn", "double"],
        "no-console": "warn",
        "no-debugger": "error",
        // Three.js specific good practices
        "no-new": "off", // Allow new THREE.Geometry() without assignment
        camelcase: "warn",
        "prefer-const": "warn",
        eqeqeq: ["warn", "always"],
      },
    };

    // Create a temporary file content for linting
    // Since ESLint works with files, wrap the code in a setup function if not already
    let codeToLint = code;

    // Ensure code isn't missing semi-colons at the end of statements which causes hard to debug issues
    if (!codeToLint.includes("function setup")) {
      codeToLint = `function setup(scene, camera, renderer, THREE) {\n${codeToLint}\n}`;
    }

    // Perform linting
    const results = eslint.verify(codeToLint, lintConfig);

    // Process and return the lint results
    if (results && results.length > 0) {
      const lintErrors = results.map((msg) => ({
        ruleId: msg.ruleId,
        severity: msg.severity, // 1 for warning, 2 for error
        message: msg.message,
        line: msg.line,
        column: msg.column,
      }));

      // Return the lint results
      return res.status(200).json({
        errors: lintErrors,
        warningCount: results.filter((msg) => msg.severity === 1).length,
        errorCount: results.filter((msg) => msg.severity === 2).length,
      });
    }

    // No errors found
    return res.status(200).json({ errors: [] });
  } catch (error) {
    console.error("ESLint error:", error);
    return res.status(500).json({
      error: "Failed to perform ESLint check",
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
