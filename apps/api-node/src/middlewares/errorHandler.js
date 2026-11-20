export function notFound(_req, res) {
  res.status(404).json({ error: 'Ruta no trobada' });
}

// Format d'error únic per a tota l'API: { "error": "missatge" }, amb "code" si l'error en té (#143).
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  const status = err.status || 500;
  // Només els codis propis (httpError): els errors de Mongo també tenen `code`, però numèric i intern.
  const code = typeof err.errorCode === 'string' ? err.errorCode : undefined;
  // Els errors de persistència poden incloure documents, hashes o URI.
  if (status >= 500) console.error('Error intern de l’API');
  const message = err.type === 'entity.parse.failed' ? 'JSON no vàlid'
    : err.type === 'entity.too.large' ? 'Petició massa gran' : err.message;
  // Un 5xx amb codi propi té un missatge escrit per nosaltres, sense dades internes: es pot mostrar.
  const visible = status < 500 || code;
  res.status(status).json({ error: visible ? message : 'Error intern del servidor', ...(code ? { code } : {}) });
}
