export function userConflict(err) {
  if (err.code !== 11000) return err;

  const duplicateField = Object.keys(err.keyPattern ?? {})[0]
    ?? Object.keys(err.keyValue ?? {})[0]
    ?? (() => {
      const match = /(?:index:\s*|key:\s*\{?\s*)([a-zA-Z0-9_]+)(?::|\s*\}|\s*\})/m.exec(err.message ?? '');
      return match ? match[1] : undefined;
    })();

  const username = duplicateField === 'username'
    || err.message?.includes('username_unique_ci')
    || /(?:index:\s*|key:\s*\{?\s*)username(?:\s*\}|\s*\}|\s*\)|\s*\:)/i.test(err.message ?? '');

  return Object.assign(new Error(username ? 'El username ja està ocupat' : 'El correu ja està registrat'), { status: 409 });
}
