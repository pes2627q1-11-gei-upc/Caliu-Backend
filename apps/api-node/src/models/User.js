import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    // Provisional: nom visible no únic, pendent de validació de Cultura't.
    username: { type: String, default: null, maxlength: 30 },
    preferences: { type: [String], default: [] },
    tokenVersion: { type: Number, default: 0, min: 0, select: false },
  },
  { timestamps: true },
);

// Llista explícita: cap camp intern ni credencial pot sortir a l'API.
export function publicUser(user) {
  return {
    id: String(user._id),
    email: user.email,
    username: user.username,
    preferences: [...user.preferences],
  };
}

export default mongoose.model('User', userSchema);
