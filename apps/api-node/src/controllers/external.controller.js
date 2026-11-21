import { findEvents } from './events.controller.js';
import { externalEvent, parseExternalEventQuery } from '../domain/externalEvent.js';

// GET /ext/v1/events (#214, HU #209): agenda per dates i zona per als clients externs (Xematrip).
// Mateixa consulta que GET /events (ordenada per distància si és per radi), amb el DTO extern.
export async function listExternalEvents(req, res, next) {
  try {
    const parsed = parseExternalEventQuery(req.query);
    const { items, total } = await findEvents(parsed);
    res.json({ items: items.map(externalEvent), page: parsed.page, limit: parsed.limit, total });
  } catch (err) {
    next(err);
  }
}
