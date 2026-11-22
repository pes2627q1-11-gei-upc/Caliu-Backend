import mongoose from 'mongoose';

const userRef = { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true };
const followSchema = new mongoose.Schema({ follower: userRef, followed: userRef });
followSchema.index({ follower: 1, followed: 1 }, { unique: true });

export default mongoose.model('Follow', followSchema);
