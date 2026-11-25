import mongoose from 'mongoose';
import Event from '../models/Event.js';
import { fetchNearbyMobility } from '../integrations/waygo.js';
import {
  MOBILITY_RADIUS_METERS, UNAVAILABLE_MOBILITY, buildMobility, mobilityOrigin,
} from '../domain/mobility.js';

// GET /events/{id}/mobility (#226, HU #211): com arribar-hi de manera sostenible (dades de WayGo).
// Fora de Barcelona, sense coordenades, sense configuració o si WayGo falla: { available: false }, i la
// fitxa es mostra sense la secció. La clau de WayGo mai surt del servidor.
export async function getEventMobility(req, res, next) {
  try {
    const { id } = req.params;
    const event = mongoose.isValidObjectId(id) ? await Event.findById(id).lean() : null;
    if (!event) return res.status(404).json({ error: 'Esdeveniment no trobat' });

    const origin = mobilityOrigin(event);
    if (!origin) return res.json(UNAVAILABLE_MOBILITY);

    const results = await fetchNearbyMobility({ ...origin, radiusMeters: MOBILITY_RADIUS_METERS });
    return res.json(results ? buildMobility(results) : UNAVAILABLE_MOBILITY);
  } catch (err) {
    return next(err);
  }
}
