import mongoose from "mongoose";

const friendshipSchema = new mongoose.Schema(
  {
    userAId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    userBId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    }
  },
  { timestamps: true }
);

friendshipSchema.pre("validate", function normalizePair(next) {
  if (this.userAId && this.userBId) {
    const a = this.userAId.toString();
    const b = this.userBId.toString();

    if (a > b) {
      const previousA = this.userAId;
      this.userAId = this.userBId;
      this.userBId = previousA;
    }
  }

  next();
});

friendshipSchema.index({ userAId: 1, userBId: 1 }, { unique: true });
friendshipSchema.index({ userAId: 1 });
friendshipSchema.index({ userBId: 1 });

export const Friendship = mongoose.model("Friendship", friendshipSchema);
