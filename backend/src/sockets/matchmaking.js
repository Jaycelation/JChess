import { Game } from "../models/Game.js";
import {
  createGameForPlayers,
  gameStatePayload
} from "./game.js";

// MVP single-server queue. Production should use Redis queue plus Socket.io Redis adapter.
const matchmakingQueue = [];
const privateRooms = new Map();

const TIME_CONTROL_PRESETS = {
  bullet: { label: "bullet", initialMs: 60000, incrementMs: 0 },
  blitz: { label: "blitz", initialMs: 300000, incrementMs: 0 },
  rapid: { label: "rapid", initialMs: 600000, incrementMs: 0 },
  rapid10inc5: { label: "rapid10inc5", initialMs: 600000, incrementMs: 5000 }
};

function normalizeTimeControl(payload = {}) {
  if (payload.initialMs !== undefined) {
    const initialMs = Math.min(Math.max(Number(payload.initialMs) || 600000, 0), 7200000);
    const incrementMs = Math.min(Math.max(Number(payload.incrementMs) || 0, 0), 60000);

    return {
      label: String(payload.label || "custom").slice(0, 32),
      initialMs,
      incrementMs
    };
  }

  return TIME_CONTROL_PRESETS[payload.timeControl] || TIME_CONTROL_PRESETS.rapid;
}

function matchedPayload(game, color, opponent) {
  return {
    gameId: game._id.toString(),
    socketRoom: game.socketRoom,
    color,
    opponent: {
      id: opponent.userId,
      username: opponent.username
    },
    initialFen: game.currentFen,
    turn: game.turn,
    status: game.status,
    timeControl: game.timeControl,
    clocks: game.clocks
  };
}

export function removeFromQueueBySocket(socketId) {
  const index = matchmakingQueue.findIndex((entry) => entry.socketId === socketId);

  if (index >= 0) {
    matchmakingQueue.splice(index, 1);
    return true;
  }

  return false;
}

export function removeFromQueueByUser(userId) {
  let removed = false;

  for (let index = matchmakingQueue.length - 1; index >= 0; index -= 1) {
    if (matchmakingQueue[index].userId === userId) {
      matchmakingQueue.splice(index, 1);
      removed = true;
    }
  }

  return removed;
}

async function tryMatchPlayers(io) {
  for (let index = matchmakingQueue.length - 1; index >= 0; index -= 1) {
    const entry = matchmakingQueue[index];

    if (!io.sockets.sockets.has(entry.socketId)) {
      matchmakingQueue.splice(index, 1);
    }
  }

  while (matchmakingQueue.length >= 2) {
    const first = matchmakingQueue.shift();
    const second = matchmakingQueue.find((entry) => entry.userId !== first.userId);

    if (!second) {
      matchmakingQueue.unshift(first);
      return;
    }

    matchmakingQueue.splice(matchmakingQueue.indexOf(second), 1);

    const [whiteEntry, blackEntry] =
      Math.random() < 0.5 ? [first, second] : [second, first];
    const { game, whiteSocket, blackSocket } = await createGameForPlayers(
      io,
      whiteEntry,
      blackEntry,
      {
        roomType: "matchmaking",
        timeControl: first.timeControl
      }
    );

    whiteSocket?.emit("matchmaking:matched", matchedPayload(game, "white", blackEntry));
    blackSocket?.emit("matchmaking:matched", matchedPayload(game, "black", whiteEntry));

    io.to(game.socketRoom).emit("game:state", gameStatePayload(game));
  }
}

function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let index = 0; index < 6; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return code;
}

export function registerMatchmakingHandlers({ io, socket, user }) {
  socket.on("matchmaking:join", async (payload = {}) => {
    try {
      const alreadyQueued = matchmakingQueue.some((entry) => entry.userId === user.id);

      if (alreadyQueued) {
        socket.emit("matchmaking:error", { message: "Already in queue" });
        return;
      }

      const activeGame = await Game.exists({
        status: "active",
        $or: [{ whitePlayerId: user.id }, { blackPlayerId: user.id }]
      });

      if (activeGame) {
        socket.emit("matchmaking:error", {
          message: "Finish or rejoin your active game first"
        });
        return;
      }

      matchmakingQueue.push({
        userId: user.id,
        username: user.username,
        socketId: socket.id,
        joinedAt: new Date(),
        timeControl: normalizeTimeControl(payload),
        rated: Boolean(payload.rated)
      });

      socket.emit("matchmaking:joined", {
        queued: true,
        queueSize: matchmakingQueue.length
      });

      await tryMatchPlayers(io);
    } catch (err) {
      socket.emit("matchmaking:error", { message: err.message });
    }
  });

  socket.on("matchmaking:cancel", () => {
    const removed = removeFromQueueBySocket(socket.id);
    socket.emit("matchmaking:cancelled", { cancelled: removed });
  });

  socket.on("room:create", (payload = {}) => {
    let roomCode = generateRoomCode();

    while (privateRooms.has(roomCode)) {
      roomCode = generateRoomCode();
    }

    privateRooms.set(roomCode, {
      roomCode,
      creatorUserId: user.id,
      players: [
        {
          userId: user.id,
          username: user.username,
          socketId: socket.id
        }
      ],
      timeControl: normalizeTimeControl(payload),
      rated: Boolean(payload.rated),
      createdAt: new Date()
    });

    socket.join(`private-lobby:${roomCode}`);
    socket.emit("room:created", {
      roomCode,
      inviteUrl: `/play/private/${roomCode}`
    });
  });

  socket.on("room:join", async (payload = {}) => {
    try {
      const roomCode = String(payload.roomCode || "").trim().toUpperCase();
      const room = privateRooms.get(roomCode);

      if (!room) {
        socket.emit("room:error", { message: "Room not found" });
        return;
      }

      if (room.players.some((player) => player.userId === user.id)) {
        socket.emit("room:error", { message: "You are already in this room" });
        return;
      }

      if (room.players.length >= 2) {
        socket.emit("room:error", { message: "Room is already full" });
        return;
      }

      const joiningPlayer = {
        userId: user.id,
        username: user.username,
        socketId: socket.id
      };

      room.players.push(joiningPlayer);
      socket.join(`private-lobby:${roomCode}`);

      io.to(`private-lobby:${roomCode}`).emit("room:joined", {
        roomCode,
        players: room.players.map((player) => ({
          id: player.userId,
          username: player.username
        }))
      });

      const [first, second] = room.players;
      const [whiteEntry, blackEntry] =
        Math.random() < 0.5 ? [first, second] : [second, first];
      const { game, whiteSocket, blackSocket } = await createGameForPlayers(
        io,
        whiteEntry,
        blackEntry,
        {
          roomType: "private",
          roomCode,
          timeControl: room.timeControl
        }
      );

      privateRooms.delete(roomCode);

      whiteSocket?.emit("room:ready", matchedPayload(game, "white", blackEntry));
      blackSocket?.emit("room:ready", matchedPayload(game, "black", whiteEntry));
      io.to(game.socketRoom).emit("game:state", gameStatePayload(game));
    } catch (err) {
      socket.emit("room:error", { message: err.message });
    }
  });
}
