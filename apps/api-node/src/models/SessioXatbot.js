import mongoose from 'mongoose';

export const SESSION_TITLE_LENGTH = 80;

const sessioXatbotSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User', index: true },
    // Historial (#163): inici del primer missatge de l'usuari. Sense valor mentre la sessió és buida.
    title: { type: String, trim: true, maxlength: SESSION_TITLE_LENGTH },
    // Últim missatge desat (o creació de la sessió): ordena l'historial de la més recent a la més antiga.
    lastActivityAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

sessioXatbotSchema.index({ userId: 1, lastActivityAt: -1, _id: -1 });

export default mongoose.model('SessioXatbot', sessioXatbotSchema, 'sessionsXatbot');
