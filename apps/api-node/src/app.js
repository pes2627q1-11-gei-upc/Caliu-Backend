import express from 'express';
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

// CORS abans de tot (inclòs /health): el preflight OPTIONS ha de respondre sense passar per auth.
app.use(createCors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'api-node' });
});

app.use('/events', eventsRoutes);
app.use('/auth', authRoutes);
app.use('/users', usersRoutes);
app.use('/chat', chatRoutes);
app.use('/ext/v1', externalRoutes); // API per a altres equips (clau X-API-Key)

// Sempre al final
app.use(notFound);
app.use(errorHandler);

export default app;
