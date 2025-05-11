import fetch from "node-fetch";
import type { RequestInit } from "node-fetch";

// URL validation configuration
interface ValidationOptions {
  timeoutMs: number; // Timeout for URL validation in milliseconds
  retries: number; // Number of retry attempts for validation
  retryDelayMs: number; // Delay between retries in milliseconds
}

// Default validation options
const defaultOptions: ValidationOptions = {
  timeoutMs: 10000, // 10 seconds timeout
  retries: 3, // 3 retry attempts
  retryDelayMs: 1000, // 1 second delay between retries
};

// Response from URL validation
interface ValidationResult {
  isValid: boolean;
  url: string;
  statusCode?: number;
  contentType?: string;
  contentLength?: number;
  error?: string;
  responseTimeMs?: number;
}

/**
 * Promisified timeout that rejects after the specified milliseconds
 */
function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Request timed out after ${ms}ms`)), ms);
  });
}

/**
 * Validates a URL by checking if it's accessible
 */
export async function validateUrl(
  url: string,
  options: Partial<ValidationOptions> = {}
): Promise<ValidationResult> {
  // Merge options with defaults
  const config = { ...defaultOptions, ...options };

  // Basic URL format validation
  if (!url || typeof url !== "string") {
    return {
      isValid: false,
      url: url || "",
      error: "Invalid URL: URL must be a non-empty string",
    };
  }

  // Ensure URL has proper protocol
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return {
      isValid: false,
      url,
      error: "Invalid URL: URL must start with http:// or https://",
    };
  }

  try {
    // Validate URL format
    new URL(url);
  } catch (error) {
    return {
      isValid: false,
      url,
      error: `Invalid URL format: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  let retriesLeft = config.retries;
  let lastError: string | undefined;
  let responseTime = 0;

  // Try URL validation with retries
  while (retriesLeft > 0) {
    const startTime = Date.now();

    try {
      const fetchOptions: RequestInit = {
        method: "HEAD", // Use HEAD request to avoid downloading full content
        redirect: "follow",
        timeout: config.timeoutMs, // Use the built-in timeout option of node-fetch
        headers: {
          "User-Agent": "ThreeJS-AI-Editor-URL-Validator/1.0",
        },
      };

      // Use Promise.race to implement timeout if built-in timeout doesn't work
      const response = await Promise.race([
        fetch(url, fetchOptions),
        timeout(config.timeoutMs),
      ]);

      responseTime = Date.now() - startTime;

      if (response.ok) {
        // URL is valid and accessible
        return {
          isValid: true,
          url,
          statusCode: response.status,
          contentType: response.headers.get("content-type") || undefined,
          contentLength:
            parseInt(response.headers.get("content-length") || "0", 10) ||
            undefined,
          responseTimeMs: responseTime,
        };
      } else {
        // URL is accessible but returned an error status
        lastError = `Server responded with status: ${response.status} ${response.statusText}`;
      }
    } catch (error) {
      responseTime = Date.now() - startTime;

      // Handle specific error types
      if (error instanceof Error) {
        if (error.message.includes("timed out")) {
          lastError = `Request timeout after ${config.timeoutMs}ms`;
        } else {
          lastError = error.message;
        }
      } else {
        lastError = "Unknown error occurred";
      }
    }

    // Decrement retry counter and wait before next attempt
    retriesLeft--;

    if (retriesLeft > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.retryDelayMs));
    }
  }

  // All validation attempts failed
  return {
    isValid: false,
    url,
    error: lastError || "URL validation failed after multiple attempts",
  };
}

/**
 * Validates a collection of URLs and returns the results for each
 */
export async function validateUrls(
  urls: string[],
  options: Partial<ValidationOptions> = {}
): Promise<ValidationResult[]> {
  if (!urls || !Array.isArray(urls)) return [];

  // Validate all URLs in parallel
  return Promise.all(urls.map((url) => validateUrl(url, options)));
}

/**
 * Filters an array of objects containing URLs, removing any with invalid URLs
 */
export async function filterValidUrlItems<T extends Record<string, unknown>>(
  items: T[],
  urlProperty: keyof T = "url" as keyof T,
  options: Partial<ValidationOptions> = {}
): Promise<T[]> {
  if (!items || !Array.isArray(items) || items.length === 0) {
    return [];
  }

  // Create validation tasks for all items
  const validationTasks = items.map(async (item) => {
    const url = item[urlProperty];

    if (typeof url !== "string") {
      return { item, isValid: false };
    }

    const validation = await validateUrl(url as string, options);
    return { item, isValid: validation.isValid };
  });

  // Process all validation tasks
  const results = await Promise.all(validationTasks);

  // Return only items with valid URLs
  return results
    .filter((result) => result.isValid)
    .map((result) => result.item);
}

/**
 * Process model URLs from Hyper3D API response
 * Validates and filters model URLs to ensure they're accessible
 */
export async function processModelUrls(
  downloadUrls: Array<{ name: string; url: string }>,
  options: Partial<ValidationOptions> = {}
): Promise<Array<{ name: string; url: string }>> {
  if (
    !downloadUrls ||
    !Array.isArray(downloadUrls) ||
    downloadUrls.length === 0
  ) {
    console.warn("No download URLs provided for validation");
    return [];
  }

  console.log(`Validating ${downloadUrls.length} model URLs...`);

  // Validate URLs and filter out invalid ones
  const validUrls = await filterValidUrlItems(downloadUrls, "url", options);

  console.log(
    `Validation complete: ${validUrls.length}/${downloadUrls.length} URLs are valid`
  );

  return validUrls;
}
