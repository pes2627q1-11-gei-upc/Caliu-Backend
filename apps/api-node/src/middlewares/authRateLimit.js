import { rateLimit, MemoryStore } from 'express-rate-limit';

export const authRateLimitStore = new MemoryStore();

export function createAuthLimiter(options = {}) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Massa intents; torna-ho a provar més tard' },
    ...options,
  });
}

export const authLimiter = createAuthLimiter({ store: authRateLimitStore });
