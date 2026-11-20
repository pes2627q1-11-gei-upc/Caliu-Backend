// `code` (opcional): codi d'error estable perquè l'app pugui reaccionar sense dependre del text (#143).
export function httpError(status, message, code) {
  return Object.assign(new Error(message), { status }, code ? { errorCode: code } : {});
}
