import mongoose from "mongoose";

const externalChessProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    provider: {
      type: String,
      enum: ["chesscom"],
      required: true
    },
    username: {
      type: String,
      required: true,
      trim: true
    },
    profile: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    stats: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    archives: {
      type: [String],
      default: []
    },
    lastFetchedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

externalChessProfileSchema.index({ userId: 1, provider: 1 }, { unique: true });
externalChessProfileSchema.index({ provider: 1, username: 1 }, { unique: true });
externalChessProfileSchema.index({ lastFetchedAt: -1 });

export const ExternalChessProfile = mongoose.model(
  "ExternalChessProfile",
  externalChessProfileSchema
);
