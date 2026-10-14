import express from 'express';

// Aquí només es configura l'aplicació. NO s'obre cap port (vegeu server.js),
// així es pot testejar amb supertest.
const app = express();

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'api-node' });
});

export default app;
