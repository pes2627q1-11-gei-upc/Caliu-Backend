export function notFound(_req, res) {
  res.status(404).json({ error: 'Ruta no trobada' });
}

// Format d'error únic per a tota l'API: { "error": "missatge" }
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  const status = err.status || 500;
  // Els errors de persistència poden incloure documents, hashes o URI.
  if (status >= 500) console.error('Error intern de l’API');
  const message = err.type === 'entity.parse.failed' ? 'JSON no vàlid'
    : err.type === 'entity.too.large' ? 'Petició massa gran' : err.message;
  res.status(status).json({ error: status >= 500 ? 'Error intern del servidor' : message });
}
