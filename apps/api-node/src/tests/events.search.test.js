import request from 'supertest';
import mongoose from 'mongoose';
import app from '../app.js'; 

beforeAll(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error("MONGO_URI no està definida a les variables d'entorn");
  }
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }
});

afterAll(async () => {
  await mongoose.connection.close();
});

describe('Cerca d\'esdeveniments: GET /events/search', () => {

  test('AC1 i AC2: Cerca per text retorna coincidències (nom o etiqueta)', async () => {
    const response = await request(app).get('/events/search?q=infantil');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('items');
    expect(response.body.items).toBeInstanceOf(Array);
    expect(response.body.items.length).toBeGreaterThan(0); 
    expect(response.body).toHaveProperty('total');
  });

  test('AC3: Retorna resultat buit comprensible si no hi ha coincidències', async () => {
    const response = await request(app).get('/events/search?q=text_que_es_impossible_que_existeixi');

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([]);
    expect(response.body.total).toBe(0);
  });

  test('AC4: L\'endpoint base retorna el conjunt disponible en eliminar la cerca', async () => {
    const response = await request(app).get('/events');

    expect(response.status).toBe(200);
    expect(response.body.items.length).toBeGreaterThan(0);
  });

});