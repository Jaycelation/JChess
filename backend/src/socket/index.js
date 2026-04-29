import { Chess } from "chess.js";
import jwt from "jsonwebtoken";
import { Types } from "mongoose";
import { Conversation } from "../models/Conversation.js";
import { Friendship } from "../models/Friendship.js";
import { Game, START_FEN } from "../models/Game.js";
import { Message } from "../models/Message.js";
import { User } from "../models/User.js";

const matchmakingQueue = [];
const privateRooms = new Map();
const userSockets = new Map();
const disconnectTimers = new Map();

const reconnectGraceMs = Number(process.env.RECONNECT_GRACE_MS || 60000);

function userRoom(userId) {
  return `user:${userId}`;
}

function conversationRoom(conversationId) {
  return `conversation:${conversationId}`;
}

function gameRoom(gameId) {
  return `game:${gameId}`;
}

function addUserSocket(userId, socketId) {
  const current = userSockets.get(userId) || new Set();
  current.add(socketId);
  userSockets.set(userId, current);
}

function removeUserSocket(userId, socketId) {
  const current = userSockets.get(userId);

  if (!current) {
    return 0;
  }

  current.delete(socketId);

  if (current.size === 0) {
    userSockets.delete(userId);
    return 0;
  }

  return current.size;
}

function removeFromQueueBySocket(socketId) {
  const index = matchmakingQueue.findIndex((entry) => entry.socketId === socketId);

  if (index >= 0) {
    matchmakingQueue.splice(index, 1);
    return true;
  }

  return false;
}

function removeFromQueueByUser(userId) {
  let removed = false;

  for (let index = matchmakingQueue.length - 1; index >= 0; index -= 1) {
    if (matchmakingQueue[index].userId === userId) {
      matchmakingQueue.splice(index, 1);
      removed = true;
    }
  }

  return removed;
}

async function getFriendIds(userId) {
  const friendships = await Friendship.find({
    $or: [{ userAId: userId }, { userBId: userId }]
  }).select("userAId userBId");

  return friendships.map((friendship) => {
    const a = friendship.userAId.toString();
    const b = friendship.userBId.toString();
    return a === userId ? b : a;
  });
}

async function notifyFriends(io, userId, event, payload) {
  const friendIds = await getFriendIds(userId);

  for (const friendId of friendIds) {
    io.to(userRoom(friendId)).emit(event, payload);
  }
}

function gameStatePayload(game) {
  return {
    gameId: game._id.toString(),
    fen: game.currentFen,
    pgn: game.pgn,
    moves: game.moves,
    status: game.status,
    turn: game.turn,
    whitePlayerId: game.whitePlayerId.toString(),
    blackPlayerId: game.blackPlayerId.toString(),
    winnerId: game.winnerId?.toString() || null,
    endedAt: game.endedAt
  };
}

function hydrateChess(game) {
  const chess = new Chess();

  if (game.pgn) {
    try {
      chess.loadPgn(game.pgn);
      return chess;
    } catch (_err) {
      chess.load(game.currentFen || START_FEN);
      return chess;
    }
  }

  chess.load(game.currentFen || START_FEN);
  return chess;
}

function playerColor(game, userId) {
  if (game.whitePlayerId.toString() === userId) {
    return "w";
  }

  if (game.blackPlayerId.toString() === userId) {
    return "b";
  }

  return null;
}

function opponentId(game, userId) {
  const whiteId = game.whitePlayerId.toString();
  const blackId = game.blackPlayerId.toString();
  return whiteId === userId ? blackId : whiteId;
}

async function createGameForPlayers(io, whiteEntry, blackEntry, options = {}) {
  const gameId = new Types.ObjectId();
  const room = gameRoom(gameId.toString());
  const chess = new Chess();

  const game = await Game.create({
    _id: gameId,
    whitePlayerId: whiteEntry.userId,
    blackPlayerId: blackEntry.userId,
    currentFen: chess.fen(),
    pgn: "",
    status: "active",
    socketRoom: room,
    roomCode: options.roomCode || null,
    roomType: options.roomType || "matchmaking",
    turn: "w"
  });

  await User.updateMany(
    { _id: { $in: [whiteEntry.userId, blackEntry.userId] } },
    { onlineStatus: "in_game" }
  );

  const whiteSocket = io.sockets.sockets.get(whiteEntry.socketId);
  const blackSocket = io.sockets.sockets.get(blackEntry.socketId);

  whiteSocket?.join(room);
  blackSocket?.join(room);

  return { game, whiteSocket, blackSocket };
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
    status: game.status
  };
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
      { roomType: "matchmaking" }
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

function messagePayload(message) {
  return {
    id: message._id.toString(),
    type: message.type,
    conversationId: message.conversationId?.toString() || null,
    gameId: message.gameId?.toString() || null,
    senderId: message.senderId.toString(),
    receiverId: message.receiverId?.toString() || null,
    content: message.content,
    readAt: message.readAt,
    createdAt: message.createdAt
  };
}

async function clearReconnectTimer(io, game, userId) {
  const key = `${game._id.toString()}:${userId}`;
  const timer = disconnectTimers.get(key);

  if (timer) {
    clearTimeout(timer);
    disconnectTimers.delete(key);
  }

  const openDisconnect = [...game.disconnects]
    .reverse()
    .find((entry) => entry.userId.toString() === userId && !entry.reconnectedAt);

  if (openDisconnect) {
    openDisconnect.reconnectedAt = new Date();
    await game.save();

    io.to(game.socketRoom).emit("game:playerReconnected", {
      gameId: game._id.toString(),
      userId
    });
  }
}

async function markActiveGamesDisconnected(io, userId) {
  const games = await Game.find({
    status: "active",
    $or: [{ whitePlayerId: userId }, { blackPlayerId: userId }]
  });

  for (const game of games) {
    const now = new Date();
    const reconnectDeadlineAt = new Date(now.getTime() + reconnectGraceMs);
    const key = `${game._id.toString()}:${userId}`;

    game.disconnects.push({
      userId,
      disconnectedAt: now,
      reconnectDeadlineAt
    });
    await game.save();

    io.to(game.socketRoom).emit("game:playerDisconnected", {
      gameId: game._id.toString(),
      userId,
      reconnectDeadlineAt
    });

    if (disconnectTimers.has(key)) {
      clearTimeout(disconnectTimers.get(key));
    }

    const timer = setTimeout(async () => {
      const freshGame = await Game.findById(game._id);

      if (!freshGame || freshGame.status !== "active" || userSockets.has(userId)) {
        return;
      }

      freshGame.status = "abandoned";
      freshGame.winnerId = opponentId(freshGame, userId);
      freshGame.endedAt = new Date();
      await freshGame.save();

      io.to(freshGame.socketRoom).emit("game:ended", {
        gameId: freshGame._id.toString(),
        status: freshGame.status,
        winnerId: freshGame.winnerId.toString(),
        reason: "abandoned",
        endedAt: freshGame.endedAt
      });
    }, reconnectGraceMs);

    disconnectTimers.set(key, timer);
  }
}

export function registerSocketHandlers(io) {
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers.authorization?.replace("Bearer ", "");

      if (!token) {
        return next(new Error("Missing socket token"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.sub).select("_id username email");

      if (!user) {
        return next(new Error("Socket user not found"));
      }

      socket.data.user = {
        id: user._id.toString(),
        username: user.username,
        email: user.email
      };

      next();
    } catch (_err) {
      next(new Error("Invalid or expired socket token"));
    }
  });

  io.on("connection", async (socket) => {
    const user = socket.data.user;

    addUserSocket(user.id, socket.id);
    socket.join(userRoom(user.id));

    await User.findByIdAndUpdate(user.id, {
      onlineStatus: "online",
      lastSeenAt: null
    });

    socket.emit("socket:connected", {
      socketId: socket.id,
      userId: user.id
    });

    await notifyFriends(io, user.id, "friend:online", {
      userId: user.id,
      onlineStatus: "online"
    });

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
          socket.emit("matchmaking:error", { message: "Finish or rejoin your active game first" });
          return;
        }

        matchmakingQueue.push({
          userId: user.id,
          username: user.username,
          socketId: socket.id,
          joinedAt: new Date(),
          timeControl: payload.timeControl || "rapid",
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
        timeControl: payload.timeControl || "rapid",
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
          { roomType: "private", roomCode }
        );

        privateRooms.delete(roomCode);

        whiteSocket?.emit("room:ready", matchedPayload(game, "white", blackEntry));
        blackSocket?.emit("room:ready", matchedPayload(game, "black", whiteEntry));
        io.to(game.socketRoom).emit("game:state", gameStatePayload(game));
      } catch (err) {
        socket.emit("room:error", { message: err.message });
      }
    });

    socket.on("game:join", async (payload = {}) => {
      try {
        const game = await Game.findById(payload.gameId);

        if (!game) {
          socket.emit("game:error", { gameId: payload.gameId, message: "Game not found" });
          return;
        }

        if (!playerColor(game, user.id)) {
          socket.emit("game:error", { gameId: payload.gameId, message: "Not a player in this game" });
          return;
        }

        socket.join(game.socketRoom);
        await clearReconnectTimer(io, game, user.id);
        socket.emit("game:state", gameStatePayload(game));
      } catch (err) {
        socket.emit("game:error", { gameId: payload.gameId, message: err.message });
      }
    });

    socket.on("game:move", async (payload = {}) => {
      const gameId = payload.gameId;

      try {
        const from = String(payload.from || "");
        const to = String(payload.to || "");
        const promotion = payload.promotion ? String(payload.promotion) : undefined;

        if (!gameId || !from || !to) {
          socket.emit("game:error", { gameId, message: "gameId, from, and to are required" });
          return;
        }

        const game = await Game.findById(gameId);

        if (!game) {
          socket.emit("game:error", { gameId, message: "Game not found" });
          return;
        }

        if (game.status !== "active") {
          socket.emit("game:error", { gameId, message: "Game is not active" });
          return;
        }

        const color = playerColor(game, user.id);

        if (!color) {
          socket.emit("game:error", { gameId, message: "Not a player in this game" });
          return;
        }

        if (game.turn !== color) {
          socket.emit("game:error", { gameId, message: "Not your turn" });
          return;
        }

        const chess = hydrateChess(game);
        const fenBefore = chess.fen();
        let move;

        try {
          move = chess.move({ from, to, promotion });
        } catch (_err) {
          move = null;
        }

        if (!move) {
          socket.emit("game:error", { gameId, message: "Invalid move" });
          return;
        }

        const status = chess.isCheckmate()
          ? "checkmate"
          : chess.isDraw() || chess.isStalemate()
            ? "draw"
            : "active";
        const winnerId = status === "checkmate" ? user.id : null;

        game.currentFen = chess.fen();
        game.pgn = chess.pgn();
        game.turn = chess.turn();
        game.status = status;
        game.winnerId = winnerId;
        game.moves.push({
          from,
          to,
          promotion: promotion || null,
          san: move.san,
          fenBefore,
          fenAfter: chess.fen(),
          byUserId: user.id
        });

        if (status !== "active") {
          game.endedAt = new Date();
        }

        await game.save();

        const movePayload = {
          gameId: game._id.toString(),
          move: {
            from,
            to,
            san: move.san,
            promotion: promotion || null
          },
          fen: game.currentFen,
          pgn: game.pgn,
          turn: game.turn,
          status: game.status,
          winnerId: game.winnerId?.toString() || null
        };

        io.to(game.socketRoom).emit("game:moveMade", movePayload);

        if (status !== "active") {
          io.to(game.socketRoom).emit("game:ended", {
            gameId: game._id.toString(),
            status: game.status,
            winnerId: game.winnerId?.toString() || null,
            reason: status,
            endedAt: game.endedAt
          });
        }
      } catch (err) {
        socket.emit("game:error", { gameId, message: err.message });
      }
    });

    socket.on("game:resign", async (payload = {}) => {
      try {
        const game = await Game.findById(payload.gameId);

        if (!game || !playerColor(game, user.id)) {
          socket.emit("game:error", { gameId: payload.gameId, message: "Game not found or forbidden" });
          return;
        }

        if (game.status !== "active") {
          socket.emit("game:error", { gameId: payload.gameId, message: "Game is not active" });
          return;
        }

        game.status = "resigned";
        game.winnerId = opponentId(game, user.id);
        game.endedAt = new Date();
        await game.save();

        io.to(game.socketRoom).emit("game:ended", {
          gameId: game._id.toString(),
          status: game.status,
          winnerId: game.winnerId.toString(),
          reason: "resigned",
          endedAt: game.endedAt
        });
      } catch (err) {
        socket.emit("game:error", { gameId: payload.gameId, message: err.message });
      }
    });

    socket.on("conversation:join", async (payload = {}) => {
      const conversation = await Conversation.findById(payload.conversationId);

      if (!conversation) {
        socket.emit("chat:error", { message: "Conversation not found" });
        return;
      }

      const participantIds = conversation.participantIds.map((id) => id.toString());

      if (!participantIds.includes(user.id)) {
        socket.emit("chat:error", { message: "Not allowed to join this conversation" });
        return;
      }

      socket.join(conversationRoom(conversation._id.toString()));
      socket.emit("conversation:joined", {
        conversationId: conversation._id.toString()
      });
    });

    socket.on("chat:send", async (payload = {}) => {
      try {
        const content = String(payload.content || "").trim();

        if (!content || content.length > 1000) {
          socket.emit("chat:error", { message: "Message content must be 1-1000 characters" });
          return;
        }

        if (payload.type === "direct") {
          const conversation = await Conversation.findById(payload.conversationId);

          if (!conversation) {
            socket.emit("chat:error", { message: "Conversation not found" });
            return;
          }

          const participantIds = conversation.participantIds.map((id) => id.toString());

          if (!participantIds.includes(user.id)) {
            socket.emit("chat:error", { message: "Not allowed to send to this conversation" });
            return;
          }

          const receiverId = participantIds.find((id) => id !== user.id);
          const message = await Message.create({
            conversationId: conversation._id,
            senderId: user.id,
            receiverId,
            content,
            type: "direct"
          });

          conversation.lastMessageId = message._id;
          conversation.lastMessageAt = message.createdAt;
          await conversation.save();

          io.to(conversationRoom(conversation._id.toString()))
            .to(userRoom(user.id))
            .to(userRoom(receiverId))
            .emit("chat:message", messagePayload(message));
          return;
        }

        if (payload.type === "game_room") {
          const game = await Game.findById(payload.gameId);

          if (!game || !playerColor(game, user.id)) {
            socket.emit("chat:error", { message: "Game not found or forbidden" });
            return;
          }

          const message = await Message.create({
            gameId: game._id,
            senderId: user.id,
            content,
            type: "game_room"
          });

          io.to(game.socketRoom).emit("chat:message", messagePayload(message));
          return;
        }

        socket.emit("chat:error", { message: "Unsupported chat type" });
      } catch (err) {
        socket.emit("chat:error", { message: err.message });
      }
    });

    socket.on("chat:typing", async (payload = {}) => {
      if (payload.type !== "direct") {
        return;
      }

      const conversation = await Conversation.findById(payload.conversationId);

      if (!conversation) {
        return;
      }

      const participantIds = conversation.participantIds.map((id) => id.toString());

      if (!participantIds.includes(user.id)) {
        return;
      }

      socket.to(conversationRoom(conversation._id.toString())).emit("chat:typing", {
        conversationId: conversation._id.toString(),
        userId: user.id,
        isTyping: Boolean(payload.isTyping)
      });
    });

    socket.on("chat:read", async (payload = {}) => {
      const conversation = await Conversation.findById(payload.conversationId);

      if (!conversation) {
        return;
      }

      const participantIds = conversation.participantIds.map((id) => id.toString());

      if (!participantIds.includes(user.id)) {
        return;
      }

      const message = await Message.findOneAndUpdate(
        {
          _id: payload.messageId,
          conversationId: conversation._id,
          receiverId: user.id
        },
        { readAt: new Date() },
        { new: true }
      );

      if (message) {
        io.to(conversationRoom(conversation._id.toString()))
          .to(userRoom(message.senderId.toString()))
          .emit("chat:read", {
            conversationId: conversation._id.toString(),
            messageId: message._id.toString(),
            readAt: message.readAt
          });
      }
    });

    socket.on("disconnect", async () => {
      removeFromQueueBySocket(socket.id);
      removeFromQueueByUser(user.id);

      const remainingSockets = removeUserSocket(user.id, socket.id);

      if (remainingSockets > 0) {
        return;
      }

      await User.findByIdAndUpdate(user.id, {
        onlineStatus: "offline",
        lastSeenAt: new Date()
      });

      await notifyFriends(io, user.id, "friend:offline", {
        userId: user.id,
        onlineStatus: "offline",
        lastSeenAt: new Date()
      });

      await markActiveGamesDisconnected(io, user.id);
    });
  });
}
