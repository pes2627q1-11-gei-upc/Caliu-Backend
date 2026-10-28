export function usernameConflict() {
  return Object.assign(new Error('El username ja està ocupat'), { status: 409 });
}

export function userConflict(err) {
  const message = err.message ?? '';
  const isDuplicate = err.code === 11000 || err.code === '11000'
    || (err.name === 'MongoServerError' && message.startsWith('E11000'));
  if (!isDuplicate) return err;

  const duplicateField = Object.keys(err.keyPattern ?? {})[0]
    ?? Object.keys(err.keyValue ?? {})[0];
  const username = duplicateField === 'username'
    || message.includes('username_unique_ci')
    || /\busername\b/i.test(message);

  return username ? usernameConflict()
    : Object.assign(new Error('El correu ja està registrat'), { status: 409 });
}
