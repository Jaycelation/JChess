import "dotenv/config";
import http from "http";
import { Server } from "socket.io";
import { createApp } from "./app.js";
import { connectDb } from "./config/db.js";
import { registerSocketHandlers } from "./sockets/index.js";

const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const io = new Server({
  cors: {
    origin: clientOrigin,
    credentials: true
  }
});

const app = createApp(io);
const server = http.createServer(app);
io.attach(server);

registerSocketHandlers(io);

const port = Number(process.env.PORT || 4000);

async function bootstrap() {
  await connectDb();
  server.listen(port, () => {
    console.log(`JChess backend listening on http://localhost:${port}`);
  });
}

bootstrap().catch((err) => {
  console.error("Failed to start backend", err);
  process.exit(1);
});
