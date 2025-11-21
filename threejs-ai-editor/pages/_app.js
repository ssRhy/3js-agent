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

    // Initialize Socket.IO client
    const initializeSocketIO = async () => {
      if (typeof window !== "undefined" && !window.io) {
        try {
          const { io } = await import("socket.io-client");
          window.io = () =>
            io("/api/socket", {
              path: "/api/socket",
              transports: ["websocket", "polling"],
            });
          console.log("Socket.IO client initialized");
        } catch (error) {
          console.error("Failed to initialize Socket.IO client:", error);
        }
      }
    };

    initializeSocketIO();

    return () => {
      // Restore original fetch when component unmounts
      window.fetch = originalFetch;
    };
  }, []);

  return <Component {...pageProps} />;
}
