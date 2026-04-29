import mongoose from "mongoose";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const embeddedMoveSchema = new mongoose.Schema(
  {
    from: { type: String, required: true },
    to: { type: String, required: true },
    promotion: { type: String, default: null },
    san: { type: String, required: true },
    fenBefore: { type: String, required: true },
    fenAfter: { type: String, required: true },
    byUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const disconnectSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    disconnectedAt: { type: Date, required: true },
    reconnectDeadlineAt: { type: Date, required: true },
    reconnectedAt: { type: Date, default: null }
  },
  { _id: false }
);

const timeControlSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      default: "rapid"
    },
    initialMs: {
      type: Number,
      default: 600000,
      min: 0
    },
    incrementMs: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  { _id: false }
);

const clockSchema = new mongoose.Schema(
  {
    whiteMs: {
      type: Number,
      default: 600000,
      min: 0
    },
    blackMs: {
      type: Number,
      default: 600000,
      min: 0
    },
    lastMoveAt: {
      type: Date,
      default: null
    }
  },
  { _id: false }
);

const gameSchema = new mongoose.Schema(
  {
    whitePlayerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    blackPlayerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    // Source of truth for board position and active side.
    currentFen: {
      type: String,
      default: START_FEN,
      required: true
    },
    pgn: {
      type: String,
      default: ""
    },
    moves: {
      type: [embeddedMoveSchema],
      default: []
    },
    status: {
      type: String,
      enum: ["waiting", "active", "checkmate", "draw", "resigned", "abandoned", "timeout"],
      default: "waiting"
    },
    winnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null
    },
    socketRoom: {
      type: String,
      required: true
    },
    roomCode: {
      type: String,
      default: null
    },
    roomType: {
      type: String,
      enum: ["matchmaking", "private"],
      default: "matchmaking"
    },
    timeControl: {
      type: timeControlSchema,
      default: () => ({ label: "rapid", initialMs: 600000, incrementMs: 0 })
    },
    clocks: {
      type: clockSchema,
      default: () => ({ whiteMs: 600000, blackMs: 600000, lastMoveAt: null })
    },
    // Cached for reads only. Move validation derives the active side from currentFen.
    turn: {
      type: String,
      enum: ["w", "b"],
      default: "w"
    },
    disconnects: {
      type: [disconnectSchema],
      default: []
    },
    endedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

gameSchema.index({ whitePlayerId: 1, createdAt: -1 });
gameSchema.index({ blackPlayerId: 1, createdAt: -1 });
gameSchema.index({ status: 1, updatedAt: -1 });
gameSchema.index({ socketRoom: 1 }, { unique: true });
gameSchema.index({ roomCode: 1 }, { sparse: true });
gameSchema.index({ createdAt: -1 });

export const Game = mongoose.model("Game", gameSchema);
