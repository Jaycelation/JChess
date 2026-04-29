import bcrypt from "bcrypt";
import { Router } from "express";
import { authRequired, signAccessToken } from "../middleware/auth.js";
import { User } from "../models/User.js";
import { asyncHandler, createHttpError } from "../utils/http.js";

const router = Router();

function publicUser(user) {
  return {
    id: user._id.toString(),
    username: user.username,
    email: user.email,
    avatarUrl: user.avatarUrl,
    chessComUsername: user.chessComUsername,
    onlineStatus: user.onlineStatus,
    lastSeenAt: user.lastSeenAt
  };
}

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      throw createHttpError(400, "username, email, and password are required");
    }

    if (password.length < 8) {
      throw createHttpError(400, "Password must be at least 8 characters");
    }

    const normalizedUsername = String(username).trim().toLowerCase();
    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = await User.findOne({
      $or: [{ username: normalizedUsername }, { email: normalizedEmail }]
    });

    if (existing) {
      throw createHttpError(409, "Username or email already exists");
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      username: normalizedUsername,
      email: normalizedEmail,
      passwordHash
    });

    res.status(201).json({
      user: publicUser(user),
      accessToken: signAccessToken(user)
    });
  })
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      throw createHttpError(400, "email and password are required");
    }

    const user = await User.findOne({ email: String(email).trim().toLowerCase() });
    const isValid = user ? await bcrypt.compare(password, user.passwordHash) : false;

    if (!isValid) {
      throw createHttpError(401, "Invalid email or password");
    }

    res.json({
      user: publicUser(user),
      accessToken: signAccessToken(user)
    });
  })
);

router.get(
  "/me",
  authRequired,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);
    res.json(publicUser(user));
  })
);

export default router;
