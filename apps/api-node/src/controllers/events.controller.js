import mongoose from 'mongoose';
import Event from '../models/Event.js';
import Interaction from '../models/Interaction.js';
import { EVENT_CATEGORIES } from '../domain/eventCategories.js';
import { parseEventQuery, parseNearbyQuery, parseSearchQuery } from '../domain/eventQuery.js';

// Document de Mongo (lean) -> JSON de l'API: _id passa a "id" i s'amaguen camps interns.
export function toApi(doc, favoriteIds = null) {
  const { _id, __v, createdAt, updatedAt, isFavorite: _isFavorite, ...rest } = doc;
  const out = { id: String(_id), ...rest };
  if (typeof out.distanceMeters === 'number') out.distanceMeters = Math.round(out.distanceMeters);
  if (favoriteIds) out.isFavorite = favoriteIds.has(out.id);
  return out;
}

async function favoriteIdsFor(user, items) {
  if (!user || items.length === 0) return null;
  const ids = await Interaction.distinct('eventId', {
    userId: user._id,
    type: 'favorite',
    eventId: { $in: items.map(({ _id }) => _id) },
  });
  return new Set(ids.map(String));
}

// Consulta comuna de GET /events i GET /events/search: filtre + (opcionalment) proximitat + paginació.
// També la reaprofita l'API externa (controllers/external.controller.js).
export async function findEvents({ filter, geo, limit, skip }) {
  if (geo) {
    // $geoNear ordena per distància i afegeix "distanceMeters" a cada resultat.
    const near = {
      near: { type: 'Point', coordinates: [geo.lng, geo.lat] },
      distanceField: 'distanceMeters',
      spherical: true,
      query: filter,
    };
    if (geo.maxDistance) near.maxDistance = geo.maxDistance;

    const [result] = await Event.aggregate([
      { $geoNear: near },
      { $facet: { items: [{ $skip: skip }, { $limit: limit }], total: [{ $count: 'n' }] } },
    ]);
    return { items: result.items, total: result.total[0]?.n ?? 0 };
  }

  const [items, total] = await Promise.all([
    Event.find(filter).sort({ startDate: 1, _id: 1 }).skip(skip).limit(limit).lean(),
    Event.countDocuments(filter),
  ]);
  return { items, total };
}

export async function listEvents(req, res, next) {
  try {
    const parsed = parseEventQuery(req.query);
    const { items, total } = await findEvents(parsed);
    const favoriteIds = await favoriteIdsFor(req.user, items);
    res.json({ items: items.map((doc) => toApi(doc, favoriteIds)), page: parsed.page, limit: parsed.limit, total });
  } catch (err) {
    next(err);
  }
}

// GET /events/search?q=...: cerca per text al títol i a les etiquetes (vegeu parseSearchQuery).
export async function searchEvents(req, res, next) {
  try {
    const parsed = parseSearchQuery(req.query);
    const { items, total } = await findEvents(parsed);
    res.json({ items: items.map((doc) => toApi(doc)), page: parsed.page, limit: parsed.limit, total });
  } catch (err) {
    next(err);
  }
}

// GET /events/nearby?lat=&lng=&radiusKm=: esdeveniments propers, ordenats per distància (vegeu parseNearbyQuery).
export async function nearbyEvents(req, res, next) {
  try {
    const parsed = parseNearbyQuery(req.query);
    const { items, total } = await findEvents(parsed);
    res.json({ items: items.map((doc) => toApi(doc)), page: parsed.page, limit: parsed.limit, total });
  } catch (err) {
    next(err);
  }
}

export async function getEvent(req, res, next) {
  try {
    const { id } = req.params;
    const doc = mongoose.isValidObjectId(id) ? await Event.findById(id).lean() : null;
    if (!doc) return res.status(404).json({ error: 'Esdeveniment no trobat' });
    res.json(toApi(doc, await favoriteIdsFor(req.user, [doc])));
  } catch (err) {
    next(err);
  }
}

export function listCategories(_req, res) {
  res.json({ categories: EVENT_CATEGORIES });
}

// Catàleg de parelles comarca/municipi amb esdeveniments disponibles.
export async function listLocations(_req, res, next) {
  try {
    const { filter } = parseEventQuery({});
    const locations = await Event.aggregate([
      { $match: filter },
      { $project: {
        comarca: { $trim: { input: { $ifNull: ['$comarca', ''] } } },
        municipality: { $trim: { input: { $ifNull: ['$municipality', ''] } } },
      } },
      { $match: { $or: [{ comarca: { $ne: '' } }, { municipality: { $ne: '' } }] } },
      { $group: { _id: { comarca: '$comarca', municipality: '$municipality' } } },
      { $sort: { '_id.comarca': 1, '_id.municipality': 1 } },
      { $project: { _id: 0, comarca: '$_id.comarca', municipality: '$_id.municipality' } },
    ]);
    res.json({ locations });
  } catch (err) {
    next(err);
  }
}
