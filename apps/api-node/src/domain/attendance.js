import Event from '../models/Event.js';
import Interaction from '../models/Interaction.js';

export async function completedAttendanceIds(userId) {
  const attended = await Interaction.distinct('eventId', { userId, type: 'attended' });
  return Event.distinct('_id', { _id: { $in: attended }, endDate: { $lt: new Date() } });
}
