import { Router } from "express";
import { authRequired } from "../middleware/auth.js";
import { ExternalChessProfile } from "../models/ExternalChessProfile.js";
import { asyncHandler, createHttpError } from "../utils/http.js";

const router = Router();
const chessComBaseUrl = "https://api.chess.com/pub";

router.use(authRequired);

function validateUsername(username) {
  const normalized = String(username || "").trim().toLowerCase();

  if (!/^[a-z0-9_-]{2,40}$/.test(normalized)) {
    throw createHttpError(400, "Invalid Chess.com username");
  }

  return normalized;
}

async function fetchChessComJson(path) {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.CHESSCOM_TIMEOUT_MS || 5000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${chessComBaseUrl}${path}`, {
      headers: {
        "User-Agent":
          process.env.CHESSCOM_USER_AGENT ||
          "JChessMVP/0.1 (+https://localhost; contact: admin@example.com)",
        Accept: "application/json"
      },
      signal: controller.signal
    });

    if (response.status === 429) {
      throw createHttpError(429, "Chess.com API rate limit reached");
    }

    if (response.status === 404) {
      throw createHttpError(404, "Chess.com resource not found");
    }

    if (!response.ok) {
      throw createHttpError(502, "Chess.com API request failed");
    }

    return response.json();
  } catch (err) {
    if (err.name === "AbortError") {
      throw createHttpError(504, "Chess.com API request timed out");
    }

    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

router.get(
  "/player/:username",
  asyncHandler(async (req, res) => {
    const username = validateUsername(req.params.username);
    const profile = await fetchChessComJson(`/player/${username}`);

    await ExternalChessProfile.findOneAndUpdate(
      { userId: req.user.id, provider: "chesscom" },
      {
        userId: req.user.id,
        provider: "chesscom",
        username,
        profile,
        lastFetchedAt: new Date()
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({
      provider: "chesscom",
      username,
      profile,
      readOnly: true
    });
  })
);

router.get(
  "/player/:username/stats",
  asyncHandler(async (req, res) => {
    const username = validateUsername(req.params.username);
    const stats = await fetchChessComJson(`/player/${username}/stats`);

    await ExternalChessProfile.findOneAndUpdate(
      { userId: req.user.id, provider: "chesscom" },
      {
        userId: req.user.id,
        provider: "chesscom",
        username,
        stats,
        lastFetchedAt: new Date()
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({
      provider: "chesscom",
      username,
      stats,
      readOnly: true
    });
  })
);

router.get(
  "/player/:username/archives",
  asyncHandler(async (req, res) => {
    const username = validateUsername(req.params.username);
    const archives = await fetchChessComJson(`/player/${username}/games/archives`);

    await ExternalChessProfile.findOneAndUpdate(
      { userId: req.user.id, provider: "chesscom" },
      {
        userId: req.user.id,
        provider: "chesscom",
        username,
        archives: archives.archives || [],
        lastFetchedAt: new Date()
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({
      provider: "chesscom",
      username,
      archives: archives.archives || [],
      readOnly: true
    });
  })
);

export default router;
