import "../styles/globals.css";
import { useEffect } from "react";

export default function App({ Component, pageProps }) {
  // Add error handling for webpack-internal URL scheme errors
  useEffect(() => {
    // Patch fetch to ignore webpack-internal URLs
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      const url = args[0];
      if (typeof url === "string" && url.startsWith("webpack-internal:")) {
        console.warn("Prevented fetch to webpack-internal URL:", url);
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      return originalFetch.apply(this, args);
    };

    return () => {
      // Restore original fetch when component unmounts
      window.fetch = originalFetch;
    };
  }, []);

  return <Component {...pageProps} />;
}
