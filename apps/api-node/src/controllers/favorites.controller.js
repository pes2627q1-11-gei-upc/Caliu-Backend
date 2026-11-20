import mongoose from 'mongoose';
import Event from '../models/Event.js';
import Interaction from '../models/Interaction.js';

export async function addFavorite(req, res, next) {
  const { eventId } = req.body ?? {};
  if (typeof eventId !== 'string' || !mongoose.isObjectIdOrHexString(eventId)) {
    return res.status(400).json({ error: 'Identificador d’esdeveniment invàlid' });
  }

  try {
    if (!(await Event.exists({ _id: eventId }))) {
      return res.status(404).json({ error: 'Esdeveniment no trobat' });
    }

    const favorite = { userId: req.user._id, type: 'favorite', eventId };
    const now = new Date();
    try {
      await Interaction.updateOne(
        favorite,
        { $setOnInsert: { createdAt: now, updatedAt: now } },
        { upsert: true, timestamps: false },
      );
    } catch (err) {
      // Un altre upsert concurrent pot haver inserit aquest mateix preferit.
      const key = err.keyPattern;
      if (err.code !== 11000 || key?.userId !== 1 || key?.type !== 1 || key?.eventId !== 1) {
        throw err;
      }
    }

    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
}

export async function removeFavorite(req, res, next) {
  const { eventId } = req.params;
  if (!mongoose.isObjectIdOrHexString(eventId)) {
    return res.status(400).json({ error: 'Identificador d’esdeveniment invàlid' });
  }

  try {
    await Interaction.deleteOne({ userId: req.user._id, type: 'favorite', eventId });
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
}
