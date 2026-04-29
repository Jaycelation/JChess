import { Router } from "express";
import { authRequired } from "../middleware/auth.js";
import { FriendRequest } from "../models/FriendRequest.js";
import { Friendship } from "../models/Friendship.js";
import { User } from "../models/User.js";
import { asyncHandler, createHttpError, normalizePair } from "../utils/http.js";

const router = Router();

router.use(authRequired);

async function friendshipExists(userAId, userBId) {
  const [a, b] = normalizePair(userAId, userBId);
  return Friendship.exists({ userAId: a, userBId: b });
}

router.post(
  "/requests",
  asyncHandler(async (req, res) => {
    const requesterId = req.user.id;
    const recipientId = req.body.recipientId;

    if (!recipientId || recipientId === requesterId) {
      throw createHttpError(400, "Valid recipientId is required");
    }

    const recipient = await User.findById(recipientId).select("_id username");

    if (!recipient) {
      throw createHttpError(404, "Recipient not found");
    }

    if (await friendshipExists(requesterId, recipientId)) {
      throw createHttpError(409, "Already friends");
    }

    const existingReverse = await FriendRequest.findOne({
      requesterId: recipientId,
      recipientId: requesterId,
      status: "pending"
    });

    if (existingReverse) {
      throw createHttpError(409, "This user already sent you a pending request");
    }

    const request = await FriendRequest.create({
      requesterId,
      recipientId,
      status: "pending"
    });

    req.app.get("io")?.to(`user:${recipientId}`).emit("friend:requestReceived", {
      requestId: request._id.toString(),
      from: {
        id: requesterId,
        username: req.user.username
      }
    });

    res.status(201).json({
      id: request._id.toString(),
      requesterId,
      recipientId,
      status: request.status
    });
  })
);

router.get(
  "/requests/incoming",
  asyncHandler(async (req, res) => {
    const requests = await FriendRequest.find({
      recipientId: req.user.id,
      status: "pending"
    })
      .populate("requesterId", "_id username avatarUrl onlineStatus")
      .sort({ createdAt: -1 });

    res.json({
      items: requests.map((request) => ({
        id: request._id.toString(),
        requester: request.requesterId,
        status: request.status,
        createdAt: request.createdAt
      }))
    });
  })
);

router.get(
  "/requests/outgoing",
  asyncHandler(async (req, res) => {
    const requests = await FriendRequest.find({
      requesterId: req.user.id,
      status: "pending"
    })
      .populate("recipientId", "_id username avatarUrl onlineStatus")
      .sort({ createdAt: -1 });

    res.json({
      items: requests.map((request) => ({
        id: request._id.toString(),
        recipient: request.recipientId,
        status: request.status,
        createdAt: request.createdAt
      }))
    });
  })
);

router.patch(
  "/requests/:id/accept",
  asyncHandler(async (req, res) => {
    const request = await FriendRequest.findOne({
      _id: req.params.id,
      recipientId: req.user.id,
      status: "pending"
    });

    if (!request) {
      throw createHttpError(404, "Pending request not found");
    }

    const [userAId, userBId] = normalizePair(request.requesterId, request.recipientId);
    const friendship = await Friendship.findOneAndUpdate(
      { userAId, userBId },
      { userAId, userBId },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    request.status = "accepted";
    request.respondedAt = new Date();
    await request.save();

    req.app.get("io")?.to(`user:${request.requesterId.toString()}`).emit("friend:requestAccepted", {
      friendshipId: friendship._id.toString(),
      friend: {
        id: req.user.id,
        username: req.user.username
      }
    });

    res.json({
      requestId: request._id.toString(),
      status: request.status,
      friendship: {
        id: friendship._id.toString(),
        userAId: friendship.userAId.toString(),
        userBId: friendship.userBId.toString()
      }
    });
  })
);

router.patch(
  "/requests/:id/reject",
  asyncHandler(async (req, res) => {
    const request = await FriendRequest.findOneAndUpdate(
      {
        _id: req.params.id,
        recipientId: req.user.id,
        status: "pending"
      },
      {
        status: "rejected",
        respondedAt: new Date()
      },
      { new: true }
    );

    if (!request) {
      throw createHttpError(404, "Pending request not found");
    }

    res.json({
      requestId: request._id.toString(),
      status: request.status
    });
  })
);

router.delete(
  "/requests/:id",
  asyncHandler(async (req, res) => {
    const request = await FriendRequest.findOneAndUpdate(
      {
        _id: req.params.id,
        requesterId: req.user.id,
        status: "pending"
      },
      {
        status: "cancelled",
        respondedAt: new Date()
      },
      { new: true }
    );

    if (!request) {
      throw createHttpError(404, "Pending request not found");
    }

    res.json({
      requestId: request._id.toString(),
      status: request.status
    });
  })
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const friendships = await Friendship.find({
      $or: [{ userAId: req.user.id }, { userBId: req.user.id }]
    });
    const friendIds = friendships.map((friendship) => {
      const a = friendship.userAId.toString();
      const b = friendship.userBId.toString();
      return a === req.user.id ? b : a;
    });
    const friends = await User.find({ _id: { $in: friendIds } }).select(
      "_id username avatarUrl onlineStatus lastSeenAt"
    );

    res.json({
      items: friends.map((friend) => ({
        id: friend._id.toString(),
        username: friend.username,
        avatarUrl: friend.avatarUrl,
        onlineStatus: friend.onlineStatus,
        lastSeenAt: friend.lastSeenAt
      }))
    });
  })
);

export default router;
