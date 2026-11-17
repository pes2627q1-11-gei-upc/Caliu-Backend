import mongoose from 'mongoose';

const sessioXatbotSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User', index: true },
  },
  { timestamps: true },
);

export default mongoose.model('SessioXatbot', sessioXatbotSchema, 'sessionsXatbot');
