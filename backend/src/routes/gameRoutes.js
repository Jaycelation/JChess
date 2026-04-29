import { Router } from "express";
import { authRequired } from "../middleware/auth.js";
import { Game } from "../models/Game.js";
import { asyncHandler, createHttpError } from "../utils/http.js";

const router = Router();

router.use(authRequired);

function isPlayer(game, userId) {
  return (
    game.whitePlayerId.toString() === userId ||
    game.blackPlayerId.toString() === userId
  );
}

router.get(
  "/me/history",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit || 20), 100);
    const page = Math.max(Number(req.query.page || 1), 1);
    const status = req.query.status ? String(req.query.status) : null;
    const query = {
      $or: [{ whitePlayerId: req.user.id }, { blackPlayerId: req.user.id }]
    };

    if (status) {
      query.status = status;
    }

    const games = await Game.find(query)
      .populate("whitePlayerId", "_id username avatarUrl")
      .populate("blackPlayerId", "_id username avatarUrl")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.json({
      page,
      limit,
      items: games.map((game) => {
        const whiteId = game.whitePlayerId._id.toString();
        const playedAs = whiteId === req.user.id ? "white" : "black";
        const opponent = playedAs === "white" ? game.blackPlayerId : game.whitePlayerId;

        return {
          id: game._id.toString(),
          opponent: {
            id: opponent._id.toString(),
            username: opponent.username,
            avatarUrl: opponent.avatarUrl
          },
          playedAs,
          status: game.status,
          winnerId: game.winnerId?.toString() || null,
          createdAt: game.createdAt,
          endedAt: game.endedAt
        };
      })
    });
  })
);

router.get(
  "/:gameId/moves",
  asyncHandler(async (req, res) => {
    const game = await Game.findById(req.params.gameId);

    if (!game) {
      throw createHttpError(404, "Game not found");
    }

    if (!isPlayer(game, req.user.id)) {
      throw createHttpError(403, "Not allowed to view this game");
    }

    res.json({
      items: game.moves
    });
  })
);

router.get(
  "/:gameId",
  asyncHandler(async (req, res) => {
    const game = await Game.findById(req.params.gameId);

    if (!game) {
      throw createHttpError(404, "Game not found");
    }

    if (!isPlayer(game, req.user.id)) {
      throw createHttpError(403, "Not allowed to view this game");
    }

    res.json({
      id: game._id.toString(),
      whitePlayerId: game.whitePlayerId.toString(),
      blackPlayerId: game.blackPlayerId.toString(),
      currentFen: game.currentFen,
      pgn: game.pgn,
      moves: game.moves,
      status: game.status,
      winnerId: game.winnerId?.toString() || null,
      socketRoom: game.socketRoom,
      roomCode: game.roomCode,
      roomType: game.roomType,
      timeControl: game.timeControl,
      clocks: game.clocks,
      turn: game.turn,
      createdAt: game.createdAt,
      updatedAt: game.updatedAt,
      endedAt: game.endedAt
    });
  })
);

export default router;
