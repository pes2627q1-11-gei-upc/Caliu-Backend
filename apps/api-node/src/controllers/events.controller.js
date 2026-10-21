import mongoose from 'mongoose';
import Event from '../models/Event.js';
import { EVENT_CATEGORIES } from '../domain/eventCategories.js';
import { parseEventQuery, parseSearchQuery } from '../domain/eventQuery.js';

// Document de Mongo (lean) -> JSON de l'API: _id passa a "id" i s'amaguen camps interns.
function toApi(doc) {
  const { _id, __v, createdAt, updatedAt, ...rest } = doc;
  const out = { id: String(_id), ...rest };
  if (typeof out.distanceMeters === 'number') out.distanceMeters = Math.round(out.distanceMeters);
  return out;
}

// Consulta comuna de GET /events i GET /events/search: filtre + (opcionalment) proximitat + paginació.
async function findEvents({ filter, geo, limit, skip }) {
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
    res.json({ items: items.map(toApi), page: parsed.page, limit: parsed.limit, total });
  } catch (err) {
    next(err);
  }
}

// GET /events/search?q=...: cerca per text al títol i a les etiquetes (vegeu parseSearchQuery).
export async function searchEvents(req, res, next) {
  try {
    const parsed = parseSearchQuery(req.query);
    const { items, total } = await findEvents(parsed);
    res.json({ items: items.map(toApi), page: parsed.page, limit: parsed.limit, total });
  } catch (err) {
    next(err);
  }
}

export async function getEvent(req, res, next) {
  try {
    const { id } = req.params;
    const doc = mongoose.isValidObjectId(id) ? await Event.findById(id).lean() : null;
    if (!doc) return res.status(404).json({ error: 'Esdeveniment no trobat' });
    res.json(toApi(doc));
  } catch (err) {
    next(err);
  }
}

export function listCategories(_req, res) {
  res.json({ categories: EVENT_CATEGORIES });
}
