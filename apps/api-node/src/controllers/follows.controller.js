import mongoose from 'mongoose';
import Follow from '../models/Follow.js';
import User from '../models/User.js';

export async function validateFollowTarget(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.isObjectIdOrHexString(id)) return res.status(400).json({ error: 'Identificador no vàlid' });
    if (String(req.user._id) === id.toLowerCase()) return res.status(400).json({ error: 'No et pots seguir a tu mateix' });
    if (!await User.exists({ _id: id })) return res.status(404).json({ error: 'Usuari no trobat' });
    next();
  } catch (err) {
    next(err);
  }
}

export async function follow(req, res, next) {
  const relation = { follower: req.user._id, followed: req.params.id };
  try {
    await Follow.updateOne(relation, { $setOnInsert: relation }, { upsert: true });
    res.sendStatus(204);
  } catch (err) {
    if (err.code === 11000 && err.keyPattern?.follower && err.keyPattern?.followed) return res.sendStatus(204);
    next(err);
  }
}

export async function unfollow(req, res, next) {
  try {
    await Follow.deleteOne({ follower: req.user._id, followed: req.params.id });
    res.sendStatus(204);
  } catch (err) {
    next(err);
  }
}
