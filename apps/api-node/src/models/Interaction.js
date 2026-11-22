import mongoose from 'mongoose';

const { Schema } = mongoose;

const interactionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    notificacionsActives: { type: Boolean },
    type: { type: String, enum: ['favorite', 'attended'], required: true },
  },
  { timestamps: true },
);

// Un usuari pot guardar un esdeveniment i haver-hi assistit, una vegada per tipus.
interactionSchema.index({ userId: 1, type: 1, eventId: 1 }, { unique: true });

export default mongoose.model('Interaction', interactionSchema, 'interactions');
