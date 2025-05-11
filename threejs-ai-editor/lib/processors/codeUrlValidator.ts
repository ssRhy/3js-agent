/**
 * URL Validator for Three.js code
 *
 * Extracts and validates URLs found in generated Three.js code to ensure
 * they are accessible before the code is sent to the frontend.
 */
import { validateUrl } from "../services/urlValidationService";
import { extractModelUrls } from "./modelExtractor";

// URL patterns to detect in code
const URL_PATTERNS = [
  // Standard model URLs (glb, gltf, obj)
  /['"`](https?:\/\/[^'"`]+\.(glb|gltf|obj)(\?[^'"`]*)?)[`'"]/g,

  // Texture and image URLs
  /['"`](https?:\/\/[^'"`]+\.(jpe?g|png|webp|svg|bmp)(\?[^'"`]*)?)[`'"]/g,

  // Audio URLs
  /['"`](https?:\/\/[^'"`]+\.(mp3|wav|ogg)(\?[^'"`]*)?)[`'"]/g,

  // Other common asset URLs
  /['"`](https?:\/\/[^'"`]+\.(json|bin)(\?[^'"`]*)?)[`'"]/g,

  // Variable assignments with URLs (no quotes)
  /(\w+)\s*=\s*(https?:\/\/[^;]+\.(glb|gltf|obj|jpe?g|png|webp|svg|bmp|mp3|wav|ogg|json|bin)(\?[^;]*)?)[;\s]/g,
];

/**
 * Extract all URLs from code
 */
export function extractUrlsFromCode(code: string): string[] {
  if (!code || typeof code !== "string") {
    return [];
  }

  // First use dedicated model extractor
  const { modelUrls } = extractModelUrls(code);
  const extractedUrls = new Set<string>(
    modelUrls ? modelUrls.map((item) => item.url) : []
  );

  // Then use generic URL patterns
  URL_PATTERNS.forEach((pattern) => {
    const matches = code.matchAll(pattern);
    for (const match of matches) {
      // The URL is in capture group 1 for quoted URLs
      // and in capture group 2 for variable assignments
      const url = match[1]?.startsWith("http") ? match[1] : match[2];
      if (url && url.startsWith("http")) {
        extractedUrls.add(url);
      }
    }
  });

  return Array.from(extractedUrls);
}

/**
 * Validates all URLs in code and returns details
 */
export async function validateCodeUrls(code: string): Promise<{
  isValid: boolean;
  validUrls: string[];
  invalidUrls: Array<{ url: string; error: string }>;
  validatedCode: string;
}> {
  // Extract all URLs from code
  const urls = extractUrlsFromCode(code);
  if (urls.length === 0) {
    return {
      isValid: true,
      validUrls: [],
      invalidUrls: [],
      validatedCode: code,
    };
  }

  console.log(`Found ${urls.length} URLs in code, validating...`);

  // Validate each URL
  const validationResults = await Promise.all(
    urls.map((url) => validateUrl(url, { timeoutMs: 10000, retries: 2 }))
  );

  // Separate valid and invalid URLs
  const validUrls: string[] = [];
  const invalidUrls: Array<{ url: string; error: string }> = [];

  validationResults.forEach((result) => {
    if (result.isValid) {
      validUrls.push(result.url);
    } else {
      invalidUrls.push({
        url: result.url,
        error: result.error || "Unknown validation error",
      });
    }
  });

  // If we have invalid URLs, clean up the code
  let validatedCode = code;

  if (invalidUrls.length > 0) {
    // Remove or comment out invalid URLs
    invalidUrls.forEach(({ url }) => {
      const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // Comment out URL assignments or uses
      const regex = new RegExp(`(['"\`])(${escapedUrl})(['"\`])`, "g");
      validatedCode = validatedCode.replace(
        regex,
        `$1/* INVALID URL REMOVED: ${url} */$3`
      );

      // Handle variable assignments without quotes
      const assignmentRegex = new RegExp(
        `(\\w+\\s*=\\s*)(${escapedUrl})([;\\s])`,
        "g"
      );
      validatedCode = validatedCode.replace(
        assignmentRegex,
        `$1/* INVALID URL REMOVED: ${url} */''//$3`
      );
    });

    // Add a comment explaining the validation
    validatedCode = `// URL validation performed: ${invalidUrls.length} invalid URLs were removed\n${validatedCode}`;
  }

  return {
    isValid: invalidUrls.length === 0,
    validUrls,
    invalidUrls,
    validatedCode,
  };
}

/**
 * Check if the code contains any URLs and validate them
 * Returns cleaned code with invalid URLs removed
 */
export async function ensureValidUrlsInCode(code: string): Promise<string> {
  try {
    const validation = await validateCodeUrls(code);

    if (!validation.isValid) {
      console.warn(
        `Found ${validation.invalidUrls.length} invalid URLs in code:`
      );
      validation.invalidUrls.forEach(({ url, error }) => {
        console.warn(`- ${url}: ${error}`);
      });

      console.log("Cleaned code to remove invalid URLs");
      return validation.validatedCode;
    }

    if (validation.validUrls.length > 0) {
      console.log(`All ${validation.validUrls.length} URLs in code are valid`);
    }

    return code;
  } catch (error) {
    console.error("Error validating URLs in code:", error);
    return code;
  }
}
