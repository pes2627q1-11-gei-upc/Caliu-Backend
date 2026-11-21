export function notFound(_req, res) {
  res.status(404).json({ error: 'Ruta no trobada' });
}

// Resum de la causa per als logs, sense missatges (poden contenir URI, documents o el cos de Python):
// només el tipus d'error i el codi de sistema (p. ex. "TypeError (ECONNREFUSED)") o l'estat de Python.
function describeCause(cause) {
  if (!cause || typeof cause !== 'object') return null;
  if (Number.isInteger(cause.pythonStatus)) return `Python ${cause.pythonStatus}`;
  const systemCode = [cause.code, cause.cause?.code].find((value) => typeof value === 'string');
  return `${cause.name || 'Error'}${systemCode ? ` (${systemCode})` : ''}`;
}

// Format d'error únic per a tota l'API: { "error": "missatge" }, amb "code" si l'error en té (#143).
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  const status = err.status || 500;
  // Només els codis propis (httpError, marcats amb isApiError): els errors de Mongo també tenen `code`,
  // però numèric i intern, i una altra llibreria podria tenir un `errorCode` de text.
  const code = err.isApiError === true && typeof err.errorCode === 'string' ? err.errorCode : undefined;
  // Els errors de persistència poden incloure documents, hashes o URI: als logs, només estat, codi i causa.
  if (status >= 500) {
    console.error('Error intern de l’API', JSON.stringify({ status, code: code ?? null, cause: describeCause(err.cause) }));
  }
  const message = err.type === 'entity.parse.failed' ? 'JSON no vàlid'
    : err.type === 'entity.too.large' ? 'Petició massa gran' : err.message;
  // Un 5xx amb codi propi té un missatge escrit per nosaltres, sense dades internes: es pot mostrar.
  const visible = status < 500 || code;
  res.status(status).json({ error: visible ? message : 'Error intern del servidor', ...(code ? { code } : {}) });
}
