import mongoose from 'mongoose';
import { normalizeUsername } from '../domain/userValidation.js';

export const USERNAME_COLLATION = { locale: 'ca', strength: 2, normalization: true };

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 254 },
    avatarUrl: String,
    avatarVersion: { type: String, select: false },
    avatarBytes: { type: Buffer, select: false },
    resetDigest: { type: String, select: false },
    resetExpiresAt: { type: Date, select: false },
    passwordHash: { type: String, required: true, select: false },
    sessionVersion: { type: Number, default: 0 },
    username: {
      type: String,
      required: true,
      validate: {
        validator(value) {
          try { return normalizeUsername(value) === value; } catch { return false; }
        },
        message: 'username no vàlid o no normalitzat',
      },
    },
    preferences: { type: [String], default: [] },
    // Radi d'activitat en km (#123). Sense valor si l'usuari no n'ha triat cap.
    proximitatKm: { type: Number, min: 0.1, max: 500 },
  },
  // Els índexs es creen explícitament després de l'auditoria de dades antigues.
  { timestamps: true, autoIndex: false },
);

userSchema.index({ resetDigest: 1 }, { partialFilterExpression: { resetDigest: { $type: "string" } } });

userSchema.index({ username: 1 }, {
  name: 'username_unique_ci', unique: true, collation: USERNAME_COLLATION,
  // Només els comptes antics poden tenir username nul/absent, fins al seu PATCH.
  partialFilterExpression: { username: { $type: 'string' } },
});

// Llista explícita: cap camp intern ni credencial pot sortir a l'API.
export function publicUser(user) {
  return {
    id: String(user._id),
    ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
    email: user.email,
    username: user.username ?? null,
    preferences: [...user.preferences],
  };
}

export default mongoose.model('User', userSchema);
