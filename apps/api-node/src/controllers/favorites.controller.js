import { toApi } from './events.controller.js';
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
        { $setOnInsert: { createdAt: now, updatedAt: now, notificacionsActives: true } },
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

async function listInteractions(req, res, next, type, serialize) {
  try {
    const interactions = await Interaction.find({ userId: req.user._id, type })
      .sort({ createdAt: -1, _id: -1 })
      .populate('eventId')
      .lean();
    const items = interactions.filter(({ eventId }) => eventId).map(serialize);
    return res.json({ items });
  } catch (err) {
    return next(err);
  }
}

export function listFavorites(req, res, next) {
  return listInteractions(req, res, next, 'favorite', ({ eventId, notificacionsActives }) => ({
    ...toApi(eventId, new Set([String(eventId._id)])),
    notificacionsActives: notificacionsActives ?? true,
  }));
}

export function listActivity(req, res, next) {
  return listInteractions(req, res, next, 'attended', ({ _id, eventId, createdAt }) => ({
    id: String(_id),
    event: toApi(eventId),
    attendedAt: createdAt,
  }));
}

export async function listAttended(req, res, next) {
  try {
    const interactions = await Interaction.find({ userId: req.user._id, type: 'attended' })
      .populate({ path: 'eventId', match: { endDate: { $lt: new Date() } } })
      .lean();
    const items = interactions.map(({ eventId }) => eventId)
      .filter(Boolean)
      .sort((a, b) => b.endDate - a.endDate || String(a._id).localeCompare(String(b._id)))
      .map((event) => toApi(event));
    return res.json({ items });
  } catch (err) {
    return next(err);
  }
}

export async function updateFavoriteAlerts(req, res, next) {
  const { eventId } = req.params;
  const { notificacionsActives } = req.body ?? {};
  if (!mongoose.isObjectIdOrHexString(eventId)) {
    return res.status(400).json({ error: 'Identificador d’esdeveniment invàlid' });
  }
  if (typeof notificacionsActives !== 'boolean') {
    return res.status(400).json({ error: 'notificacionsActives ha de ser un booleà' });
  }

  try {
    const result = await Interaction.updateOne(
      { userId: req.user._id, type: 'favorite', eventId },
      { $set: { notificacionsActives } },
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Preferit no trobat' });
    }
    return res.status(204).end();
  } catch (err) {
    return next(err);
  }
}
