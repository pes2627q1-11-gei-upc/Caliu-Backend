import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  _id: String,
  title: { type: String, required: true },
  description: { type: String, required: true },
  icon: { type: String, required: true },
  target: { type: Number, required: true, min: 1 },
  metric: { type: String, enum: ['attended', 'museums', 'fairs', 'favorites', 'following'], required: true },
  position: Number,
});
export default mongoose.model('Achievement', schema);
