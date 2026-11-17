import mongoose from 'mongoose';

const missatgeXatbotSchema = new mongoose.Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'SessioXatbot' },
    role: { type: String, required: true, enum: ['user', 'assistant'] },
    content: { type: String, required: true, trim: true, maxlength: 10000 },
  },
  { timestamps: true },
);

missatgeXatbotSchema.index({ sessionId: 1, createdAt: 1 });

export default mongoose.model('MissatgeXatbot', missatgeXatbotSchema, 'missatgesXatbot');
