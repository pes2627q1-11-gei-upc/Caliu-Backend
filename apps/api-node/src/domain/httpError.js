// Error propi de l'API (#143). `code` (opcional): codi d'error estable perquè l'app pugui reaccionar sense
// dependre del text. `cause` (opcional): detall intern (error original, estat de Python…) que només va als
// logs, mai a la resposta. `isApiError` marca que el missatge l'hem escrit nosaltres i es pot mostrar.
export function httpError(status, message, code, cause) {
  const err = cause === undefined ? new Error(message) : new Error(message, { cause });
  return Object.assign(err, { status, isApiError: true }, code ? { errorCode: code } : {});
}
