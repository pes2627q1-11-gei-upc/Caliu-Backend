import mongoose from 'mongoose';
import Event from '../models/Event.js';
import { EVENT_CATEGORIES } from '../domain/eventCategories.js';
import { parseEventQuery } from '../domain/eventQuery.js';

// Document de Mongo (lean) -> JSON de l'API: _id passa a "id" i s'amaguen camps interns.
function toApi(doc) {
  const { _id, __v, createdAt, updatedAt, ...rest } = doc;
  const out = { id: String(_id), ...rest };
  if (typeof out.distanceMeters === 'number') out.distanceMeters = Math.round(out.distanceMeters);
  return out;
}

export async function listEvents(req, res, next) {
  try {
    const { filter, geo, page, limit, skip } = parseEventQuery(req.query);
    let items;
    let total;

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
      items = result.items;
      total = result.total[0]?.n ?? 0;
    } else {
      [items, total] = await Promise.all([
        Event.find(filter).sort({ startDate: 1, _id: 1 }).skip(skip).limit(limit).lean(),
        Event.countDocuments(filter),
      ]);
    }

    res.json({ items: items.map(toApi), page, limit, total });
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

export async function searchEvents(req, res, next) {
  try {
    const q = req.query.q !== undefined ? String(req.query.q).trim() : '';

    if (!q) {
      return res.json({ items: [], total: 0 });
    }

    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escapeRegex(q), 'i'); 

    const filter = {
      $or: [{ title: rx }, { tags: rx }]
    };

    const [items, total] = await Promise.all([
      Event.find(filter).sort({ startDate: 1, _id: 1 }).limit(20).lean(),
      Event.countDocuments(filter)
    ]);

    res.json({ items: items.map(toApi), total });
  } catch (err) {
    next(err);
  }
}