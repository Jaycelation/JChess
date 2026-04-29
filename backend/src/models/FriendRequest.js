import mongoose from "mongoose";

const friendRequestSchema = new mongoose.Schema(
  {
    requesterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "cancelled"],
      default: "pending"
    },
    respondedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

friendRequestSchema.index(
  { requesterId: 1, recipientId: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } }
);
friendRequestSchema.index({ recipientId: 1, status: 1, createdAt: -1 });
friendRequestSchema.index({ requesterId: 1, status: 1, createdAt: -1 });

export const FriendRequest = mongoose.model("FriendRequest", friendRequestSchema);
