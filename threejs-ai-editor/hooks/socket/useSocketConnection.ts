import { useEffect, useState, useRef } from "react";
import { useSocketStore } from "../../lib/socket";

export type SocketConnectionStatus = "connecting" | "open" | "closed" | "error";

export const useSocketConnection = () => {
  const [socketConnectionStatus, setSocketConnectionStatus] =
    useState<SocketConnectionStatus>("connecting");
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const { setConnectionError, connect } = useSocketStore();

  const manualReconnect = () => {
    setSocketConnectionStatus("connecting");
    setConnectionError(null);
    window.location.reload();
  };

  useEffect(() => {
    connect();

    const { socket } = useSocketStore.getState();
    if (socket) {
      const handleConnect = () => {
        console.log("[Socket] Connected");
        setSocketConnectionStatus("open");
      };

      const handleDisconnect = () => {
        console.log("[Socket] Disconnected");
        setSocketConnectionStatus("closed");
      };

      const handleError = (err: Error) => {
        console.error("[Socket] Error:", err);
        setSocketConnectionStatus("error");
        setConnectionError(err.message);
      };

      if (socket.connected) {
        setSocketConnectionStatus("open");
      }

      socket.on("connect", handleConnect);
      socket.on("disconnect", handleDisconnect);
      socket.on("error", handleError);
      socket.on("connection_established", (data) => {
        console.log("[Socket] Server confirmed connection:", data);
        setSocketConnectionStatus("open");
      });
      socket.on("pong", () => {
        setSocketConnectionStatus("open");
      });
    }

    heartbeatIntervalRef.current = setInterval(() => {
      const { socket } = useSocketStore.getState();
      if (socket && socket.connected) {
        socket.emit("ping");
      }
    }, 60000);

    return () => {
      const { disconnect, socket } = useSocketStore.getState();

      if (socket) {
        socket.off("connect");
        socket.off("disconnect");
        socket.off("error");
        socket.off("connection_established");
        socket.off("pong");
      }

      disconnect();

      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
    };
  }, [connect, setConnectionError]);

  return {
    socketConnectionStatus,
    manualReconnect,
  };
};
