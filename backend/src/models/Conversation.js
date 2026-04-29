import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["direct"],
      default: "direct"
    },
    participantIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
      }
    ],
    directKey: {
      type: String,
      default: null
    },
    lastMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null
    },
    lastMessageAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

conversationSchema.index({ participantIds: 1 });
conversationSchema.index({ lastMessageAt: -1 });
conversationSchema.index({ type: 1, updatedAt: -1 });
conversationSchema.index({ directKey: 1 }, { unique: true, sparse: true });

export const Conversation = mongoose.model("Conversation", conversationSchema);
