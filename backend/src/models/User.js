import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 32
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254
    },
    passwordHash: {
      type: String,
      required: true
    },
    avatarUrl: {
      type: String,
      default: ""
    },
    chessComUsername: {
      type: String,
      trim: true,
      default: ""
    },
    onlineStatus: {
      type: String,
      enum: ["online", "offline", "in_game"],
      default: "offline"
    },
    lastSeenAt: {
      type: Date,
      default: null
    },
    rating: {
      rapid: { type: Number, default: 1200 },
      blitz: { type: Number, default: 1200 },
      bullet: { type: Number, default: 1200 }
    }
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        delete ret.passwordHash;
        return ret;
      }
    }
  }
);

userSchema.index({ username: 1 }, { unique: true });
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ chessComUsername: 1 }, { sparse: true });
userSchema.index({ onlineStatus: 1 });

export const User = mongoose.model("User", userSchema);
