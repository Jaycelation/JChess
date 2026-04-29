import { Chess } from "chess.js";
import { Types } from "mongoose";
import { Game, START_FEN } from "../models/Game.js";
import { User } from "../models/User.js";

export function userRoom(userId) {
  return `user:${userId}`;
}

export function conversationRoom(conversationId) {
  return `conversation:${conversationId}`;
}

export function gameRoom(gameId) {
  return `game:${gameId}`;
}

export function playerColor(game, userId) {
  if (game.whitePlayerId.toString() === userId) {
    return "w";
  }

  if (game.blackPlayerId.toString() === userId) {
    return "b";
  }

  return null;
}

export function opponentId(game, userId) {
  const whiteId = game.whitePlayerId.toString();
  const blackId = game.blackPlayerId.toString();
  return whiteId === userId ? blackId : whiteId;
}

export function gameStatePayload(game) {
  return {
    gameId: game._id.toString(),
    fen: game.currentFen,
    pgn: game.pgn,
    moves: game.moves,
    status: game.status,
    turn: game.turn,
    timeControl: game.timeControl,
    clocks: game.clocks,
    whitePlayerId: game.whitePlayerId.toString(),
    blackPlayerId: game.blackPlayerId.toString(),
    winnerId: game.winnerId?.toString() || null,
    endedAt: game.endedAt
  };
}

function chessFromCurrentFen(game) {
  const chess = new Chess();
  chess.load(game.currentFen || START_FEN);
  return chess;
}

function pgnFromMoves(moves) {
  const replay = new Chess();

  for (const historicMove of moves) {
    const move = replay.move({
      from: historicMove.from,
      to: historicMove.to,
      promotion: historicMove.promotion || undefined
    });

    if (!move) {
      return "";
    }
  }

  return replay.pgn();
}

function statusFromChess(chess) {
  if (chess.isCheckmate()) {
    return "checkmate";
  }

  if (chess.isDraw() || chess.isStalemate()) {
    return "draw";
  }

  return "active";
}

function applyClockBeforeMove(game, color, now) {
  if (!game.clocks || !game.timeControl || game.timeControl.initialMs <= 0) {
    return true;
  }

  const lastMoveAt = game.clocks.lastMoveAt || game.createdAt || now;
  const elapsedMs = Math.max(0, now.getTime() - new Date(lastMoveAt).getTime());

  if (color === "w") {
    game.clocks.whiteMs = Math.max(0, game.clocks.whiteMs - elapsedMs);
    return game.clocks.whiteMs > 0;
  }

  game.clocks.blackMs = Math.max(0, game.clocks.blackMs - elapsedMs);
  return game.clocks.blackMs > 0;
}

function applyClockAfterMove(game, color, now) {
  if (!game.clocks || !game.timeControl || game.timeControl.initialMs <= 0) {
    return;
  }

  if (color === "w") {
    game.clocks.whiteMs += game.timeControl.incrementMs;
  } else {
    game.clocks.blackMs += game.timeControl.incrementMs;
  }

  game.clocks.lastMoveAt = now;
}

export async function createGameForPlayers(io, whiteEntry, blackEntry, options = {}) {
  const gameId = new Types.ObjectId();
  const room = gameRoom(gameId.toString());
  const chess = new Chess();
  const timeControl = options.timeControl || {
    label: "rapid",
    initialMs: 600000,
    incrementMs: 0
  };

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
    timeControl,
    clocks: {
      whiteMs: timeControl.initialMs,
      blackMs: timeControl.initialMs,
      lastMoveAt: new Date()
    },
    turn: chess.turn()
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

async function clearReconnectTimer(io, game, userId, disconnectTimers) {
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

export async function markActiveGamesDisconnected({
  io,
  userId,
  userSockets,
  disconnectTimers,
  reconnectGraceMs
}) {
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

export function registerGameHandlers({
  io,
  socket,
  user,
  disconnectTimers
}) {
  socket.on("game:join", async (payload = {}) => {
    try {
      const game = await Game.findById(payload.gameId);

      if (!game) {
        socket.emit("game:error", { gameId: payload.gameId, message: "Game not found" });
        return;
      }

      if (!playerColor(game, user.id)) {
        socket.emit("game:error", {
          gameId: payload.gameId,
          message: "Not a player in this game"
        });
        return;
      }

      socket.join(game.socketRoom);
      await clearReconnectTimer(io, game, user.id, disconnectTimers);
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

      const chess = chessFromCurrentFen(game);
      const activeTurn = chess.turn();

      if (activeTurn !== color) {
        game.turn = activeTurn;
        await game.save();
        socket.emit("game:error", { gameId, message: "Not your turn" });
        return;
      }

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

      const now = new Date();

      if (!applyClockBeforeMove(game, color, now)) {
        game.status = "timeout";
        game.winnerId = opponentId(game, user.id);
        game.endedAt = now;
        game.turn = activeTurn;
        await game.save();

        io.to(game.socketRoom).emit("game:ended", {
          gameId: game._id.toString(),
          status: game.status,
          winnerId: game.winnerId.toString(),
          reason: "timeout",
          endedAt: game.endedAt
        });
        return;
      }

      const status = statusFromChess(chess);
      const winnerId = status === "checkmate" ? user.id : null;
      const moveRecord = {
        from,
        to,
        promotion: promotion || null,
        san: move.san,
        fenBefore,
        fenAfter: chess.fen(),
        byUserId: user.id
      };

      applyClockAfterMove(game, color, now);

      game.currentFen = chess.fen();
      game.moves.push(moveRecord);
      game.pgn = pgnFromMoves(game.moves);
      game.turn = chess.turn();
      game.status = status;
      game.winnerId = winnerId;

      if (status !== "active") {
        game.endedAt = now;
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
        clocks: game.clocks,
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
        socket.emit("game:error", {
          gameId: payload.gameId,
          message: "Game not found or forbidden"
        });
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
}
