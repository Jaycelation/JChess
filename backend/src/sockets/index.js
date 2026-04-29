import jwt from "jsonwebtoken";
import { Conversation } from "../models/Conversation.js";
import { Friendship } from "../models/Friendship.js";
import { Message } from "../models/Message.js";
import { User } from "../models/User.js";
import {
  conversationRoom,
  markActiveGamesDisconnected,
  playerColor,
  registerGameHandlers,
  userRoom
} from "./game.js";
import {
  registerMatchmakingHandlers,
  removeFromQueueBySocket,
  removeFromQueueByUser
} from "./matchmaking.js";

const userSockets = new Map();
const disconnectTimers = new Map();
const reconnectGraceMs = Number(process.env.RECONNECT_GRACE_MS || 60000);

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

function registerChatHandlers(io, socket, user) {
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
        const { Game } = await import("../models/Game.js");
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

    registerMatchmakingHandlers({ io, socket, user });
    registerGameHandlers({ io, socket, user, disconnectTimers });
    registerChatHandlers(io, socket, user);

    socket.on("disconnect", async () => {
      removeFromQueueBySocket(socket.id);
      removeFromQueueByUser(user.id);

      const remainingSockets = removeUserSocket(user.id, socket.id);

      if (remainingSockets > 0) {
        return;
      }

      const lastSeenAt = new Date();

      await User.findByIdAndUpdate(user.id, {
        onlineStatus: "offline",
        lastSeenAt
      });

      await notifyFriends(io, user.id, "friend:offline", {
        userId: user.id,
        onlineStatus: "offline",
        lastSeenAt
      });

      await markActiveGamesDisconnected({
        io,
        userId: user.id,
        userSockets,
        disconnectTimers,
        reconnectGraceMs
      });
    });
  });
}
