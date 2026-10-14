import mongoose from 'mongoose';

export async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('Falta la variable d\'entorn MONGO_URI');
  }
  await mongoose.connect(uri);
  console.log('Connectat a MongoDB');
}
