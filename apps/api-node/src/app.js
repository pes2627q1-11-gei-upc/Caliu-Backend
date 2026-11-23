import { fileURLToPath } from 'node:url';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import eventsRoutes from './routes/events.routes.js';
import authRoutes from './routes/auth.routes.js';
import usersRoutes from './routes/users.routes.js';
import chatRoutes from './routes/chat.routes.js';
import externalRoutes from './routes/external.routes.js';
import { errorHandler, notFound } from './middlewares/errorHandler.js';
import { createCors } from './middlewares/cors.js';

// Aquí només es configura l'aplicació. NO s'obre cap port (vegeu server.js),
// així es pot testejar amb supertest.
const app = express();
const openApiPath = fileURLToPath(new URL('../../../docs/openapi.yaml', import.meta.url));

// CORS abans de tot (inclòs /health): el preflight OPTIONS ha de respondre sense passar per auth.
app.use(createCors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'api-node' });
});

app.get('/api-docs/openapi.yaml', (_req, res) => {
  res.type('application/yaml').sendFile(openApiPath);
});
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(null, {
  customSiteTitle: 'Caliu API',
  swaggerOptions: {
    url: '/api-docs/openapi.yaml',
    validatorUrl: null,
  },
}));

app.use('/events', eventsRoutes);
app.use('/auth', authRoutes);
app.use('/users', usersRoutes);
app.use('/chat', chatRoutes);
app.use('/ext/v1', externalRoutes); // API per a altres equips (clau X-API-Key)

// Sempre al final
app.use(notFound);
app.use(errorHandler);

export default app;
