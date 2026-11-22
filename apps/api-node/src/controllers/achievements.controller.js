import Achievement from '../models/Achievement.js';
import { achievementProgress } from '../domain/achievementProgress.js';

export async function listAchievements(req, res, next) {
  try {
    const [catalog, counts] = await Promise.all([
      Achievement.find().sort({ position: 1 }).lean(),
      achievementProgress(req.user._id),
    ]);
    const items = catalog.map(({ _id, title, description, icon, target, metric }) => {
      const progress = Math.min(target, counts[metric]);
      return { id: _id, title, description, icon, target, progress, unlocked: progress >= target };
    });
    res.json({ items });
  } catch (err) {
    next(err);
  }
}
