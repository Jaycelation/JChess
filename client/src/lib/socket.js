import { io } from "socket.io-client";

const socketUrl = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";

export function createAuthedSocket(token) {
  return io(socketUrl, {
    auth: { token },
    transports: ["websocket", "polling"],
    autoConnect: true
  });
}
