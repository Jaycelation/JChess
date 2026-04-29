import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
import { createHttpError } from "../utils/http.js";

export function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      username: user.username
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d"
    }
  );
}

export async function authRequired(req, _res, next) {
  try {
    const header = req.headers.authorization || "";
    const [scheme, token] = header.split(" ");

    if (scheme !== "Bearer" || !token) {
      throw createHttpError(401, "Missing bearer token");
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.sub).select("_id username email avatarUrl chessComUsername");

    if (!user) {
      throw createHttpError(401, "User not found");
    }

    req.user = {
      id: user._id.toString(),
      username: user.username,
      email: user.email
    };

    next();
  } catch (err) {
    next(createHttpError(401, err.message || "Unauthorized"));
  }
}
