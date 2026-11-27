import { completedAttendanceIds } from './attendance.js';
import Interaction from '../models/Interaction.js';
import Follow from '../models/Follow.js';
import Event from '../models/Event.js';

// Un únic recompte per mètrica i usuari. Els favorits i els seguiments són els vigents.
export async function achievementProgress(userId) {
  const [attended, favorites, following] = await Promise.all([
    completedAttendanceIds(userId),
    Interaction.countDocuments({ userId, type: 'favorite' }),
    Follow.countDocuments({ follower: userId }),
  ]);
  const countTagged = (label) => Event.countDocuments({
    _id: { $in: attended }, $or: [{ categories: label }, { tags: label }],
  }).collation({ locale: 'ca', strength: 1 });
  const [museums, fairs] = await Promise.all([
    countTagged({ $in: ['Exposició', 'Exposicions'] }), countTagged({ $in: ['Fira', 'Fires'] }),
  ]);
  return { attended: attended.length, favorites, following, museums, fairs };
}
