import mongoose from 'mongoose';

const userRef = { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true };
const followSchema = new mongoose.Schema({ follower: userRef, followed: userRef });
followSchema.index({ follower: 1, followed: 1 }, { unique: true });
// Llista de seguidors d'un usuari (#183): GET /users/:id/followers filtra per "followed".
followSchema.index({ followed: 1, _id: -1 });

export default mongoose.model('Follow', followSchema);
