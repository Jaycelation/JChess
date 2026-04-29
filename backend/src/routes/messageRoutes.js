import { Router } from "express";
import { authRequired } from "../middleware/auth.js";
import { Conversation } from "../models/Conversation.js";
import { Message } from "../models/Message.js";
import { User } from "../models/User.js";
import { asyncHandler, createHttpError, normalizePair } from "../utils/http.js";

const router = Router();

router.use(authRequired);

router.get(
  "/conversations",
  asyncHandler(async (req, res) => {
    const conversations = await Conversation.find({
      participantIds: req.user.id
    })
      .populate("participantIds", "_id username avatarUrl onlineStatus")
      .populate("lastMessageId")
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .limit(50);

    res.json({
      items: conversations.map((conversation) => ({
        id: conversation._id.toString(),
        type: conversation.type,
        participants: conversation.participantIds.map((participant) => ({
          id: participant._id.toString(),
          username: participant.username,
          avatarUrl: participant.avatarUrl,
          onlineStatus: participant.onlineStatus
        })),
        lastMessage: conversation.lastMessageId,
        lastMessageAt: conversation.lastMessageAt,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt
      }))
    });
  })
);

router.post(
  "/conversations/direct",
  asyncHandler(async (req, res) => {
    const otherUserId = req.body.userId;

    if (!otherUserId || otherUserId === req.user.id) {
      throw createHttpError(400, "Valid userId is required");
    }

    const otherUser = await User.findById(otherUserId).select("_id");

    if (!otherUser) {
      throw createHttpError(404, "User not found");
    }

    const [a, b] = normalizePair(req.user.id, otherUserId);
    const conversation = await Conversation.findOneAndUpdate(
      { directKey: `${a}:${b}` },
      {
        type: "direct",
        participantIds: [a, b],
        directKey: `${a}:${b}`
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({
      id: conversation._id.toString(),
      type: conversation.type,
      participantIds: conversation.participantIds.map((id) => id.toString())
    });
  })
);

router.get(
  "/conversations/:conversationId/messages",
  asyncHandler(async (req, res) => {
    const conversation = await Conversation.findById(req.params.conversationId);

    if (!conversation) {
      throw createHttpError(404, "Conversation not found");
    }

    const participantIds = conversation.participantIds.map((id) => id.toString());

    if (!participantIds.includes(req.user.id)) {
      throw createHttpError(403, "Not allowed to view this conversation");
    }

    const limit = Math.min(Number(req.query.limit || 30), 100);
    const query = { conversationId: conversation._id };

    if (req.query.before) {
      const before = await Message.findById(req.query.before).select("createdAt");

      if (before) {
        query.createdAt = { $lt: before.createdAt };
      }
    }

    const messages = await Message.find(query).sort({ createdAt: -1 }).limit(limit);

    res.json({
      items: messages.reverse().map((message) => ({
        id: message._id.toString(),
        conversationId: message.conversationId?.toString() || null,
        gameId: message.gameId?.toString() || null,
        senderId: message.senderId.toString(),
        receiverId: message.receiverId?.toString() || null,
        content: message.content,
        type: message.type,
        readAt: message.readAt,
        createdAt: message.createdAt
      }))
    });
  })
);

export default router;
