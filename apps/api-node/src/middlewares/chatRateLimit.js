import { rateLimit } from 'express-rate-limit';

export const chatRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  keyGenerator: (req) => String(req.user._id),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Has arribat al límit de missatges; torna-ho a provar més tard' },
});
