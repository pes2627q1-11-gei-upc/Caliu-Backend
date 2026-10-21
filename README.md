# Caliu — backend

API Node.js 22 / Express 4 / Mongoose 8, MongoDB 7 i servei Python d'ingesta.
El contracte compartit amb Android és [docs/openapi.yaml](docs/openapi.yaml).

## Executar amb Docker Compose

```sh
cp .env.example .env
# Omple els camps buits de .env localment abans d'arrencar.
docker compose up --build -d
curl http://localhost:3000/health
```

Configura `MONGO_USER`, `MONGO_PASSWORD`, `MONGO_DB` i un `JWT_SECRET` aleatori
d'almenys 32 bytes. Pots generar-lo amb `openssl rand -hex 32` i desar-lo només a
`.env`, que està ignorat per Git. No incloguis secrets ni tokens en logs o captures.
Codifica les credencials Mongo com a components URI si contenen caràcters reservats.
`JWT_TTL_SECONDS` és un enter d'1 a 86400; per defecte, 3600 (una hora).
Compose ja passa el secret i la durada a l'API. La configuració de Python continua
depenent de les variables d'ingesta existents.

Per iniciar només Mongo i l'API: `docker compose up --build -d api-node`.
L'API comprova la configuració JWT i espera l'índex únic d'email abans d'obrir el port.
Una configuració JWT absent o invàlida impedeix l'arrencada; no hi ha cap secret per defecte.
El Dockerfile utilitza `npm ci --omit=dev` i el lockfile del repositori.

## Desenvolupament i tests

```sh
cd apps/api-node
npm ci
npm test -- --runInBand
```

Els tests habituals amb Jest/Supertest simulen els models; no connecten a MongoDB,
no llegeixen `.env` i utilitzen secrets i dades sintètiques. Per executar Node fora de
Docker cal configurar un `MONGO_URI` accessible localment i `JWT_SECRET`:
`node --env-file=../../.env src/server.js`. `npm start`/`npm run dev` utilitzen les
variables exportades a l'entorn; no carreguen `.env` automàticament.

La integració és opcional, separada de `npm test`, i utilitza un MongoDB efímer:

```sh
docker run --rm -d --name caliu-users-integration-test \
  -p 127.0.0.1:27028:27017 mongo:7 --bind_ip_all
cd apps/api-node  # des de l'arrel del repositori
TEST_MONGO_URI=mongodb://127.0.0.1:27028/caliu_users_integration_test npm run test:integration
docker stop caliu-users-integration-test
```

Espera que MongoDB estigui disponible abans d'executar la integració. No muntis
volums amb dades del projecte. La suite només accepta `localhost`/`127.0.0.1`,
el nom exacte `caliu_users_integration_test`, sense credencials ni opcions d'URI;
neteja aquesta base de dades i l'elimina en acabar. No utilitza `MONGO_URI`.
Comprova l'índex únic amb registres concurrents, hash, login, persistència,
aïllament d'usuaris, logout i endpoints d'esdeveniments reals.

## Integració Android: Sprint 1

Base URL local: `http://localhost:3000`; emulador Android: `http://10.0.2.2:3000`.
En entorns desplegats cal HTTPS. Totes les peticions amb cos són `application/json`.
Els errors tenen sempre forma `{"error":"missatge"}`. Els endpoints d'esdeveniments
continuen públics. No hi ha OAuth, refresh tokens, rols ni recomanacions.

| Mètode | Ruta | Petició | Resposta correcta |
|---|---|---|---|
| POST | `/auth/register` | `{"email":"persona@example.cat","password":"Exemple-password-42"}` | 201, `{"user":{...}}` |
| POST | `/auth/login` | El mateix cos | 200, usuari i JWT |
| GET | `/users/me` | Sense cos, Bearer JWT | 200, perfil propi |
| PATCH | `/users/me` | `{"username":"Nuria_42"}`, Bearer JWT | 200, perfil actualitzat |
| GET | `/users/me/preferences` | Sense cos, Bearer JWT | 200, `{"preferences":[...]}` |
| PUT | `/users/me/preferences` | `{"preferences":["Música","Cinema"]}`, Bearer JWT | 200, llista substituïda |
| POST | `/auth/logout` | Sense cos, Bearer JWT | 204, sense cos |

Exemple de resposta de login (el token mostrat és només un marcador):

```json
{
  "user": {
    "id": "6710f1c2a1b2c3d4e5f60718",
    "email": "persona@example.cat",
    "username": null,
    "preferences": []
  },
  "token": "<access-token>",
  "tokenType": "Bearer",
  "expiresIn": 3600
}
```

El registre no inicia sessió: Android ha de fer login després. Desa el token en
emmagatzematge segur i envia `Authorization: Bearer <token>` a les rutes protegides;
no enviïs identificadors d'usuari per escollir el perfil. Perfil i credencials no
són intercanviables: `GET/PATCH /users/me` retorna directament l'objecte públic,
mentre que register/login l'inclouen dins de `user`.

Exemples amb `TOKEN` assignat localment a partir del login (no l'imprimeixis):

```sh
curl -X POST http://localhost:3000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"persona@example.cat","password":"Exemple-password-42"}'
curl http://localhost:3000/users/me -H "Authorization: Bearer $TOKEN"
curl -X PATCH http://localhost:3000/users/me \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"username":"Nuria_42"}'
curl -X PUT http://localhost:3000/users/me/preferences \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"preferences":["Música","Cinema"]}'
curl -X PUT http://localhost:3000/users/me/preferences \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"preferences":[]}'
curl -X POST http://localhost:3000/auth/logout -H "Authorization: Bearer $TOKEN"
```

No intentis parsejar JSON després d'un 204. En rebre 401, elimina la sessió local
i torna al login; no reintentis indefinidament el mateix token. Un 500 al logout
no confirma la invalidació al servidor; el client pot eliminar igualment el token local.

## Validació i decisions de seguretat

- Email: obligatori, ASCII amb domini amb punt, màxim 254 caràcters (64 part local),
  trim/minúscules, índex únic MongoDB. Duplicats, també en cursa, retornen 409.
- Password: obligatori, almenys 8 caràcters Unicode i màxim **72 bytes UTF-8**,
  sense caràcters de control ni només espais; es conserva exactament sense trim.
  bcryptjs amb salt aleatori i cost 12. El límit evita la truncació de bcrypt.
  No es retornen ni password, ni hash, ni tokenVersion. Els errors interns no
  imprimeixen documents, URI, tokens ni traces als logs.
- Login: missatge 401 idèntic per compte inexistent i contrasenya errònia;
  executa bcrypt.compare també si el compte no existeix. Entrades mal formades
  retornen 400. JWT HS256 amb `sub`, expiració, issuer, audience i tokenVersion;
  el middleware comprova signatura, claims, existència i versió actual a MongoDB.
- Perfil: només username és editable; trim/NFC, 3–30 lletres Unicode, números,
  punts, guions o guions baixos. Camps desconeguts es rebutgen amb 400; cap mass
  assignment. Les escriptures filtren per identitat autenticada i tokenVersion.
- Preferències: llista completa, màxim 30 entrades de 1–50 caràcters Unicode,
  trim/NFC, sense controls Cc/Cf; deduplicació sense distingir majúscules i
  preservant la primera grafia. `[]` elimina totes les preferències.
- Auth i perfil utilitzen `Cache-Control: no-store`. JSON mal format retorna 400
  sense reproduir el cos; el límit JSON d'Express (100 KiB) retorna 413.

La [documentació de bcryptjs](https://github.com/dcodeIO/bcrypt.js#security-considerations)
explica el límit de 72 bytes; les opcions JWT segueixen
[jsonwebtoken](https://github.com/auth0/node-jsonwebtoken#jwtverifytoken-secretorpublickey-options-callback).

**Logout:** incrementa atòmicament `tokenVersion`, de manera que invalida **totes
les sessions actives del compte**, també les d'altres dispositius. No elimina
perfil ni preferències. Una sessió iniciada després del logout utilitza la nova
versió. La invalidació depèn de MongoDB i implica una consulta per petició
protegida; una caiguda de persistència retorna 500. No cancel·la respostes de
lectura ja en curs. Android també ha d'eliminar el token del dispositiu.

## Decisions pendents de Cultura't i límits

- Confirmar si el logout ha de ser global. Si només ha d'afectar un dispositiu,
  caldria acordar un model de sessions per dispositiu; tokenVersion no el proporciona.
- Confirmar la unicitat de username. Aquí és un nom visible **no únic**, inicialment
  `null`; no s'ha creat cap índex únic ni s'utilitza per iniciar sessió.
- Confirmar catàleg i semàntica de #37. Les categories d'esdeveniments són Música,
  Teatre, Gastronomia, Arts, Esports, Menjar i beguda, Nit, Tallers, Comèdia i
  A l'aire lliure. El repositori no conté el catàleg específic de la US i la consulta
  remota no ha estat accessible. Per això s'accepta text lliure validat, inclosos
  Cinema, Dansa o Literatura; aquests exemples no es pressuposen requisits de #37.
  No s'ha imposat cap enum ni s'ha canviat `eventCategories.js`.
- Confirmar les convencions provisionals de longitud de password/username/preferències
  i durada de sessió. No hi ha verificació de correu, recuperació de contrasenya,
  refresh tokens ni limitació distribuïda d'intents; abans d'exposar login a Internet,
  cal concretar HTTPS i controls d'abús al desplegament.

## Cobertura dels criteris de backend

| US | Implementació i comprovació |
|---|---|
| #39 | Registre 201, validació 400, email normalitzat únic/409 i hash amb salt; test de cursa real a MongoDB |
| #40 | Login amb JWT expirable i usuari públic, 401 genèric; tests de signatura, claims, token absent/expirat/invàlid i errors de persistència |
| #34 | GET/PATCH propi, username validat, camps no autoritzats rebutjats, persistència i aïllament entre dos usuaris |
| #37 | GET/PUT propi, substitució, deduplicació, llista buida i límits; catàleg definitiu pendent |
| #38 | Logout 204, revocació comprovada, conservació de dades i nou login; decisió de logout global pendent |

Els criteris descrits a la petició estan coberts per tests; la validació final dels
criteris originals de les US i les decisions de producte requereix Cultura't.
