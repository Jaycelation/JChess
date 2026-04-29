import { Router } from "express";
import { authRequired } from "../middleware/auth.js";
import { ExternalChessProfile } from "../models/ExternalChessProfile.js";
import { User } from "../models/User.js";
import { asyncHandler, createHttpError } from "../utils/http.js";

const router = Router();

router.use(authRequired);

router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const username = String(req.query.username || "").trim().toLowerCase();

    if (username.length < 2) {
      throw createHttpError(400, "username query must be at least 2 characters");
    }

    const users = await User.find({
      username: { $regex: `^${username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` }
    })
      .select("_id username avatarUrl onlineStatus")
      .limit(20);

    res.json({
      items: users.map((user) => ({
        id: user._id.toString(),
        username: user.username,
        avatarUrl: user.avatarUrl,
        onlineStatus: user.onlineStatus
      }))
    });
  })
);

router.patch(
  "/me",
  asyncHandler(async (req, res) => {
    const allowed = {};

    if (typeof req.body.avatarUrl === "string") {
      allowed.avatarUrl = req.body.avatarUrl.trim();
    }

    if (typeof req.body.chessComUsername === "string") {
      allowed.chessComUsername = req.body.chessComUsername.trim().toLowerCase();
    }

    const user = await User.findByIdAndUpdate(req.user.id, allowed, {
      new: true,
      runValidators: true
    }).select("-passwordHash");

    res.json(user);
  })
);

router.post(
  "/me/chesscom-link",
  asyncHandler(async (req, res) => {
    const username = String(req.body.username || "").trim().toLowerCase();

    if (!username) {
      throw createHttpError(400, "username is required");
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { chessComUsername: username },
      { new: true, runValidators: true }
    ).select("-passwordHash");

    await ExternalChessProfile.findOneAndUpdate(
      { userId: req.user.id, provider: "chesscom" },
      { username, provider: "chesscom", userId: req.user.id },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({
      userId: user._id.toString(),
      chessComUsername: user.chessComUsername,
      externalProfileLinked: true
    });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id).select(
      "_id username avatarUrl onlineStatus lastSeenAt chessComUsername"
    );

    if (!user) {
      throw createHttpError(404, "User not found");
    }

    res.json({
      id: user._id.toString(),
      username: user.username,
      avatarUrl: user.avatarUrl,
      onlineStatus: user.onlineStatus,
      lastSeenAt: user.lastSeenAt,
      chessComUsername: user.chessComUsername
    });
  })
);

export default router;
