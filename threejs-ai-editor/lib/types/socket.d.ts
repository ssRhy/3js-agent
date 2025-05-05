import { Server as SocketIOServer } from "socket.io";

// Global declarations for socket-related objects
declare global {
  // Server instance - initialized in pages/api/socket.ts
  // eslint-disable-next-line no-var
  var socketIOServer: SocketIOServer | undefined;

  // Map of pending screenshot requests
  // eslint-disable-next-line no-var
  var screenshotRequests: Map<
    string,
    {
      resolve: (screenshot: string) => void;
      socketId: string;
    }
  >;
}
