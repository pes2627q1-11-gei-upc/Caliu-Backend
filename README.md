# Caliu — backend

Node.js 22, Express 4, Mongoose 8 i MongoDB 7. Contracte REST:
[docs/openapi.yaml](docs/openapi.yaml). La ingesta Python i l'API pública
d'esdeveniments mantenen el comportament existent.

## Execució

```sh
cp .env.example .env
# Omple .env localment; no el comparteixis ni el versionis.
docker compose up --build -d api-node
curl http://localhost:3000/health
```

Configura `MONGO_USER`, `MONGO_PASSWORD`, `MONGO_DB` i un `JWT_SECRET` aleatori
d'almenys 32 bytes (p. ex. genera'l localment amb `openssl rand -hex 32`).
`JWT_TTL_SECONDS`: enter d'1 a 86400, per defecte 3600. No hi ha secret per defecte.
Codifica les credencials Mongo com a components URI si contenen caràcters reservats.
Per arrencar també la ingesta existent: `docker compose up --build -d` amb les
seves variables configurades. Fora de Docker, configura un `MONGO_URI` accessible:

```sh
cd apps/api-node
npm ci
node --env-file=../../.env src/server.js
```

`npm start` i `npm run dev` utilitzen les variables exportades; no carreguen `.env`
automàticament. L'API valida JWT_SECRET i espera l'auditoria i els índexs d'usuaris
i sessions abans d'escoltar peticions. El Dockerfile continua utilitzant
`npm ci --omit=dev`; no s'ha modificat Compose.

## Flutter integration contract

Base local: `http://localhost:3000`; emulador Android: `http://10.0.2.2:3000`.
En desplegament utilitza HTTPS. Cossos JSON amb `Content-Type: application/json`.
Les rutes protegides exigeixen `Authorization: Bearer <token>`.

| Mètode | Ruta | Cos obligatori | Resposta |
|---|---|---|---|
| POST | `/auth/register` | `username`, `email`, `password` | 201, `user`, `token`, `tokenType`, `expiresIn` |
| POST | `/auth/login` | `email`, `password` | 200, mateix esquema que register |
| POST | `/auth/logout` | Sense cos; Bearer | 204 sense cos |
| GET | `/users/me` | Sense cos; Bearer | 200, objecte públic de l'usuari |
| PATCH | `/users/me` | `username`; Bearer | 200, objecte públic actualitzat |
| GET | `/users/me/preferences` | Sense cos; Bearer | 200, `{"preferences":[...]}` |
| PUT | `/users/me/preferences` | `preferences`; Bearer | 200, llista completa substituïda |
| GET | `/events/categories` | Sense cos ni token | 200, `{"categories":[...]}` |

Registre amb **auto-login**; Flutter pot entrar directament a l'aplicació:

```http
POST /auth/register
Content-Type: application/json

{"username":"Nuria_42","email":"nuria@example.cat","password":"ExemplePassword42"}
```

Login posterior:

```http
POST /auth/login
Content-Type: application/json

{"email":"nuria@example.cat","password":"ExemplePassword42"}
```

Les dues respostes tenen exactament aquesta estructura; el token és un marcador:

```json
{
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "username": "Nuria_42",
    "email": "nuria@example.cat",
    "preferences": []
  },
  "token": "<JWT>",
  "tokenType": "Bearer",
  "expiresIn": 3600
}
```

Exemples de peticions autenticades (substitueix el marcador localment, sense logs):

```http
GET /users/me
Authorization: Bearer <JWT>
```

```json
{"id":"507f1f77bcf86cd799439011","username":"Nuria_42","email":"nuria@example.cat","preferences":["Música"]}
```

```http
PATCH /users/me
Authorization: Bearer <JWT>
Content-Type: application/json

{"username":"Nuria_2026"}
```

Retorna directament l'objecte públic amb el nom actualitzat. Només aquest camp
és editable aquí: `id`, `email`, `password`, `role`, `jti`, `sessions`,
`tokenVersion`, `preferences` i qualsevol altre camp desconegut es rebutgen amb 400.
La identitat prové del JWT, mai d'un identificador de perfil enviat pel client.
No existeixen rutes `/profile` ni respostes amb el camp `profile`.

```http
PUT /users/me/preferences
Authorization: Bearer <JWT>
Content-Type: application/json

{"preferences":[" música ","Teatre","MÚSICA"]}
```

Resposta 200: `{"preferences":["Música","Teatre"]}`. GET retorna el mateix format.
`{"preferences":[]}` elimina tota la selecció. Flutter ha de carregar el catàleg de
`GET /events/categories`: Música, Teatre, Gastronomia, Arts, Esports, Menjar i
beguda, Nit, Tallers, Comèdia i A l'aire lliure. La font de veritat és
`EVENT_CATEGORIES`; no s'accepten Cinema, Dansa o altres valors desconeguts.

```http
POST /auth/logout
Authorization: Bearer <JWT>
```

Resposta **204 sense JSON**. Només es revoca aquesta sessió: A passa a 401,
B continua funcionant i un nou login d'A no afecta B. Cada registre/login genera
una sessió diferent, encara que es faci en el mateix segon.

Flutter ha de desar el token en emmagatzematge segur, enviar-lo només al backend,
retirar-lo del dispositiu en logout i tractar 401 com sessió absent/expirada/revocada.
`expiresIn` s'expressa en segons. No hi ha refresh tokens. No imprimeixis ni capturis
JWT, contrasenyes o secrets. No intentis parsejar JSON després del 204. Si logout
retorna 500, la revocació al servidor no està confirmada; el client pot retirar
igualment el token local. L'issuer/audience existents (`caliu-api`/`caliu-android`)
es conserven com a identificadors del contracte, també per a Flutter.

Regles que Flutter ha de reproduir:

- **Username:** obligatori al registre; `trim()` i Unicode NFC; 3–30 punts de codi
  Unicode; només lletres, números, `.`, `-`, `_`. Es conserva la grafia visible.
  Unicitat sense distingir majúscules amb collation `ca`, força 2, normalització ICU;
  els accents són significatius. `Quim_42`/`quim_42` i `Núria`/`NÚRIA` entren en
  conflicte; `Núria` i `Nuria` poden coexistir. Flutter ha de gestionar el 409 del
  servidor, que és qui garanteix la unicitat. No cal comprovar-la amb un altre endpoint.
- **Email:** obligatori, ASCII amb domini amb punt, màxim 254 caràcters (64 part
  local), trim i minúscules. Unicitat garantida per índex MongoDB.
- **Password:** almenys 8 punts de codi Unicode, màxim **72 bytes UTF-8**; sense
  controls Unicode Cc ni només espais. No es fa trim ni truncació. A Dart, compteu
  `password.runes.length` i `utf8.encode(password).length`; `String.length` compta
  unitats UTF-16. El backend desa exclusivament bcrypt amb salt aleatori i cost 12.
- **Preferències:** llista completa de fins a 30 entrades, strings no buits de
  màxim 50 punts de codi després de trim/NFC, sense controls Cc/Cf. Només categories
  reals; es toleren majúscules diferents, espais exteriors i equivalència NFC,
  però no s'eliminen accents. Es retorna sempre el nom canònic i sense duplicats.

Errors uniformes: `{"error":"missatge"}`. 400: payload/JSON invàlid; 401:
autenticació invàlida o credencials incorrectes (mateix missatge per email inexistent
i password erroni de format vàlid); 409: email o username ocupat; 413: JSON superior
a 100 KiB; 429: massa intents amb `Retry-After`; 500: error intern genèric.
Exemples: `{"error":"El username ja està ocupat"}` i
`{"error":"Preferència desconeguda; consulta /events/categories"}`.

## Sessions, consistència i seguretat

La col·lecció `sessions` desa només `userId`, `jti` aleatori de 32 bytes i
`expiresAt` (més `_id`/`__v` de Mongo/Mongoose); mai JWT complets ni informació de
dispositiu. Té índex únic `jti`, índex `userId` i TTL `expiresAt` amb
`expireAfterSeconds: 0`. Cada petició protegida comprova HS256 explícit,
signatura, issuer, audience, exp, sub vàlid, usuari existent i sessió amb aquell
propietari i `expiresAt > ara`. El TTL només neteja: pot executar-se amb retard.
El logout elimina exclusivament aquella sessió. Una caiguda de MongoDB retorna
500; mai es concedeix accés per error. Les peticions ja autoritzades en curs
poden acabar després d'un logout; no hi ha transaccions entre sessió i perfil.

**Registre en MongoDB standalone:** es valida i signa abans de persistir, es crea
la sessió amb un userId preassignat i després s'insereix el compte. Si falla la
sessió no es crea el compte. Si falla el compte, s'intenta eliminar només aquella
sessió; si la neteja falla, queda una sessió òrfena incapaç d'autenticar ningú,
fins a la neteja TTL. No s'eliminen comptes com a compensació. Com en qualsevol
escriptura Mongo amb resultat ambigu per tall de xarxa, un client pot rebre 500
encara que l'última inserció s'hagi completat: ha de provar login abans de repetir
un registre que ja retorna 409. No hi ha una transacció distribuïda ni refresh tokens.

Auth i perfil porten `Cache-Control: no-store`. Errors interns genèrics, sense
cossos originals, hashes, URI o traces als logs. El password s'exclou de les
consultes habituals i l'API publica només `id`, `username`, `email`, `preferences`.

S'ha afegit un límit combinat de **30 intents de register/login per IP cada
15 minuts**, comptant també èxits, abans de bcrypt. És en memòria per procés,
es reinicia amb l'API i no es comparteix entre rèpliques. Express no confia en
`X-Forwarded-For` per defecte. Si hi ha proxy, cal configurar expressament els
salts de confiança al desplegament i acordar un límit compartit si es replica
l'API; no activar `trust proxy: true` indiscriminadament. Aquesta mesura bàsica
no substitueix HTTPS ni els controls d'abús del desplegament.

## Comptes antics i desplegament sense pèrdua de dades

Les decisions de Cultura't ja són definitives. No s'ha executat cap migració sobre
una base compartida. Abans del desplegament, amb les escriptures d'usuari aturades,
executa l'auditoria de **només lectura** sobre el destí aprovat:

```sh
cd apps/api-node
# Amb MONGO_URI exportat de forma segura:
npm run users:audit
# O, si .env ja conté el MONGO_URI adequat:
node --env-file=../../.env src/scripts/auditUsers.js
```

El resultat només inclou grups d'IDs duplicats, IDs amb nom invàlid/no normalitzat,
preferències no canòniques i comptes amb nom nul/absent; no imprimeix noms,
correus ni secrets. L'arrencada comprova el mateix abans de crear l'índex
`username_unique_ci` (únic, collation `ca`, strength 2, normalization true).
No s'utilitza `syncIndexes` ni s'eliminen índexs existents.

Procediment de regularització:

1. Fer còpia de seguretat segons el procediment del desplegament i revisar el
   report. Els conflictes no es resolen automàticament ni s'inventen noms.
2. Acordar amb els titulars/equip els usernames alternatius dels grups duplicats
   i la normalització de formats incompatibles. Acordar també el tractament de
   preferències antigues fora del catàleg. Aplicar només aquests canvis aprovats
   amb el desplegament anterior o una operació de manteniment revisada.
3. Repetir l'auditoria i desplegar quan no quedin duplicats, noms incompatibles
   ni preferències no canòniques. L'API es nega a arrencar si en queden; una cursa
   residual també serà rebutjada per la creació de l'índex únic.
4. Els noms nuls/absents antics s'exclouen de l'índex parcial i no bloquegen el
   desplegament. Els comptes es conserven i poden fer login; `user.username` és
   `null` fins que el titular el regularitza amb el PATCH habitual. Flutter ha de
   mostrar l'edició del nom en aquest cas. Els comptes nous no poden ometre'l.

Els JWT antics sense `jti` passen a ser invàlids: cal tornar a iniciar sessió.
`tokenVersion` deixa de tenir funció; si el camp queda en documents antics,
s'ignora i no s'exposa. No cal esborrar-lo per desplegar aquesta versió.

## Tests i criteris de Sprint 1

```sh
cd apps/api-node
npm ci
npm test -- --runInBand
```

Jest/Supertest amb models simulats: mai llegeixen `.env` ni connecten a MongoDB.
La integració és separada i destructiva **només per a la seva base efímera**:

```sh
docker run --rm -d --name caliu-users-integration-test \
  -p 127.0.0.1:27028:27017 mongo:7 --bind_ip_all
cd apps/api-node  # des de l'arrel
TEST_MONGO_URI=mongodb://127.0.0.1:27028/caliu_users_integration_test npm run test:integration
docker stop caliu-users-integration-test
```

Espera que MongoDB estigui disponible. Sense Docker, pots iniciar `mongod` 7 amb
`--bind_ip 127.0.0.1 --port 27028 --dbpath <directori-temporal-buit>` i executar la
mateixa comanda de test; atura'l en acabar. No utilitzis volums o directoris de dades
compartits. La suite només accepta localhost/127.0.0.1, el nom exacte
`caliu_users_integration_test`, sense credencials ni opcions URI. No utilitza
`MONGO_URI`. Neteja col·leccions, prova l'auditoria amb dades antigues sintètiques
i elimina aquesta base en acabar.

| US | Criteris de backend comprovats |
|---|---|
| #39 | Username obligatori/únic, hash/salt/cost, auto-login, JWT immediat, 400/409/500, concurrència i consistència standalone |
| #40 | Esquema uniforme, sessions diferents, expiració, credencials genèriques, claims/propietari/sessió/usuari i fallades de Mongo |
| #34 | Perfil propi, edició i unicitat, persistència, Unicode, rebuig de camps interns i aïllament entre usuaris |
| #37 | Catàleg real, noms canònics, duplicats, substitució, buidatge, persistència i aïllament |
| #38 | Revocar A conserva B i altres usuaris; nou login conserva B; 204, reutilització 401 i error de persistència segur |

La regressió inclou `/events`, `/events/search`, `/events/:id` i
`/events/categories`; la ingesta no es modifica. No es pressuposa verificació de
correu, recuperació de password, OAuth o recomanador.
