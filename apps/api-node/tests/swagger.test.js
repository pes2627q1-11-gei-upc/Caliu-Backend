import { readFile } from 'node:fs/promises';
import request from 'supertest';
import app from '../src/app.js';

test('Swagger UI serveix la pàgina i carrega el contracte del mateix servei', async () => {
  await request(app).get('/api-docs').redirects(1)
    .expect(200).expect('Content-Type', /html/).expect(/Caliu API/);

  await request(app).get('/api-docs/swagger-ui-init.js')
    .expect(200).expect(/\/api-docs\/openapi\.yaml/);
});

test('Swagger UI serveix el contracte OpenAPI del repositori', async () => {
  const spec = await readFile(new URL('../../../docs/openapi.yaml', import.meta.url), 'utf8');
  await request(app).get('/api-docs/openapi.yaml')
    .expect(200).expect('Content-Type', /application\/yaml/).expect(spec);
});
