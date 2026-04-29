import cors from "cors";
import express from "express";
import authRoutes from "./routes/authRoutes.js";
import externalChessComRoutes from "./routes/externalChessComRoutes.js";
import friendRoutes from "./routes/friendRoutes.js";
import gameRoutes from "./routes/gameRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import userRoutes from "./routes/userRoutes.js";

export function createApp(io) {
  const app = express();
  const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:5173";

  app.set("io", io);

  app.use(
    cors({
      origin: clientOrigin,
      credentials: true
    })
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/friends", friendRoutes);
  app.use("/api/games", gameRoutes);
  app.use("/api", messageRoutes);
  app.use("/api/external/chesscom", externalChessComRoutes);

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.status || 500).json({
      message: err.message || "Internal server error"
    });
  });

  return app;
}
