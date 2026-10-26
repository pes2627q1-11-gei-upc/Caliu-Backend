export function userConflict(err) {
  if (err.code !== 11000) return err;
  const username = Boolean(err.keyPattern?.username) || err.message?.includes('username_unique_ci');
  return Object.assign(new Error(username ? 'El username ja està ocupat' : 'El correu ja està registrat'), { status: 409 });
}
