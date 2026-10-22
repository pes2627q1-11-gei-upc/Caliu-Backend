export function getAuthConfig() {
  const secret = process.env.JWT_SECRET;
  const ttl = process.env.JWT_TTL_SECONDS ?? '3600';
  if (typeof secret !== 'string' || Buffer.byteLength(secret.trim(), 'utf8') < 32) {
    throw new Error('JWT_SECRET ha de contenir almenys 32 bytes; genera un secret aleatori');
  }
  if (!/^\d+$/.test(ttl) || !Number.isSafeInteger(Number(ttl)) || Number(ttl) < 1 || Number(ttl) > 86400) {
    throw new Error('JWT_TTL_SECONDS ha de ser un enter entre 1 i 86400');
  }
  return { secret, expiresIn: Number(ttl), issuer: 'caliu-api', audience: 'caliu-android' };
}
