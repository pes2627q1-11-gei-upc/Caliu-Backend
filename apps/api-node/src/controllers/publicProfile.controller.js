import { completedAttendanceIds } from '../domain/attendance.js';
import User, { USERNAME_COLLATION } from '../models/User.js';
import Interaction from '../models/Interaction.js';
import Follow from '../models/Follow.js';
import { normalizeUsername } from '../domain/userValidation.js';

export async function getPublicProfile(req, res, next) {
  try {
    const username = normalizeUsername(req.params.username);
    const user = await User.findOne({ username }).collation(USERNAME_COLLATION)
      .select('_id username avatarUrl').lean();
    if (!user) return res.status(404).json({ error: 'Usuari no trobat' });

    const attended = await completedAttendanceIds(req.user._id);
    const [sharedEventsCount, following] = await Promise.all([
      Interaction.countDocuments({ userId: user._id, type: 'attended', eventId: { $in: attended } }),
      Follow.exists({ follower: req.user._id, followed: user._id }),
    ]);
    res.json({
      id: String(user._id), username: user.username, avatarUrl: user.avatarUrl ?? null,
      sharedEventsCount, isFollowing: Boolean(following),
    });
  } catch (err) {
    next(err);
  }
}
