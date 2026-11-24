// Proposta inicial basada en el prototip Flutter (#177). Cap progrés de demostració.
import Achievement from '../models/Achievement.js';

export const catalog = [
  ['first-event', 'Primeres passes', 'Assisteix al teu primer acte cultural.', 'steps', 1, 'attended'],
  ['explorer', 'Explorador cultural', 'Assisteix a 5 actes culturals.', 'explore', 5, 'attended'],
  ['museums', 'Amant dels museus', 'Assisteix a 3 exposicions.', 'museum', 3, 'museums'],
  ['fairs', 'Fira rere fira', 'Assisteix a 3 fires.', 'fair', 3, 'fairs'],
  ['collector', 'Col·leccionista', 'Desa 10 esdeveniments a Preferits.', 'favorite', 10, 'favorites'],
  ['social', 'Ànima social', 'Segueix 5 persones de la comunitat.', 'people', 5, 'following'],
].map(([_id, title, description, icon, target, metric], position) =>
  ({ _id, title, description, icon, target, metric, position }));

export function seedAchievements() {
  return Achievement.bulkWrite(catalog.map(({ _id, ...fields }) => ({
    updateOne: { filter: { _id }, update: { $set: fields }, upsert: true },
  })));
}
