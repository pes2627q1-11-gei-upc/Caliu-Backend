# Desplegament — Caliu

Com tornar a deixar l’API i l’app accessibles fora del PC local.

## API a Render

URL actual: **https://caliu-api.onrender.com**

| Comprovació | URL |
|-------------|-----|
| Health | https://caliu-api.onrender.com/health |
| Esdeveniments | https://caliu-api.onrender.com/events?limit=3 |

### Config del Web Service (resum)

| Camp | Valor |
|------|--------|
| Repo | `Caliu-Backend` |
| Root Directory | `apps/api-node` |
| Dockerfile | `Dockerfile` (dins d’aquest directori) |
| `MONGO_URI` | URI d’Atlas amb `/Caliu?...` |
| `JWT_SECRET` | string llarg (només a Render) |
| `CORS_ORIGINS` | `http://localhost:5000,https://pes2627q1-11-gei-upc.github.io` (Flutter Web de testing) |

`PORT` el posa Render sol.

### Restricció de la clau de Google Maps

La clau de Maps no es configura ni s'utilitza en aquest backend: la web Flutter
la carrega directament des del navegador a `maps.googleapis.com`. `CORS_ORIGINS`
només controla les peticions del navegador a l'API de Caliu; no restringeix l'ús
de la clau de Google Maps. La restricció s'ha d'aplicar a la credencial a Google
Cloud Console → **APIs i serveis → Credencials**.

La configuració actual del frontend reutilitza la clau d'Android per a Flutter
Web. No s'ha de limitar aquesta mateixa clau a referents HTTP perquè deixaria de
funcionar a Android. Cal crear dues claus separades:

1. **Clau web**: *Restriccions d'aplicació → Llocs web (referents HTTP)*. Permet
   només aquests referents:
   - `http://localhost:5000/*` (desenvolupament local; el port 5000 és fixat per
     `scripts/run-web.ps1` del frontend).
   - `https://pes2627q1-11-gei-upc.github.io/Caliu-FrontEnd/*` (Flutter Web a
     GitHub Pages).

   A *Restriccions d'API*, permet només **Maps JavaScript API**. El frontend ha
   de llegir aquesta clau web en `web/maps_config.js`; per al desplegament de
   GitHub Actions, configureu-la com un secret separat (per exemple,
   `MAPS_WEB_API_KEY`) i actualitzeu el workflow i `scripts/run-web.ps1` del
   repositori `Caliu-FrontEnd` perquè no injectin la clau d'Android a la web.
2. **Clau Android**: restringiu-la a l'aplicació Android (nom del paquet i
   empremta SHA-1 de signatura) i, a *Restriccions d'API*, a **Maps SDK for
   Android**. Manteniu-la a `android/local.properties` i al secret de CI que
   genera l'APK; no la poseu a la configuració web.

Cal activar **Maps JavaScript API** al projecte de Google Cloud. Aquestes
restriccions són configuració externa i no es poden aplicar des d'aquest
repositori. Fins que les dues claus i el frontend no estiguin actualitzats,
Google Maps Web pot quedar sense funcionar; no es considera completat només
amb limitar CORS o documentar aquests passos.

**Comprovar-ho després de configurar les claus:**

1. Obriu el mapa des de `http://localhost:5000` i des de
   `https://pes2627q1-11-gei-upc.github.io/Caliu-FrontEnd/`; en tots dos casos
   s'ha de carregar.
2. Serviu/proveu la mateixa web des d'un origen no permès, per exemple
   `http://localhost:5001`. A les eines de desenvolupador del navegador, la
   consola ha d'indicar `RefererNotAllowedMapError` i el mapa no s'ha de
   carregar. Google pot respondre amb un recurs JavaScript tot i rebutjar-ne
   l'ús; el senyal de rebuig és aquest error i que el mapa no funcioni, no
   necessàriament un HTTP 403.
3. Proveu també l'APK per confirmar que la clau Android continua carregant el
   mapa. No feu servir la clau real en proves amb `curl` ni la publiqueu als
   logs.

### Notes

- El pla free **s’adorm**: la primera petició després d’una estona pot trigar ~30–60 s.
- **No** executeu `npm run seed` contra Atlas.
- Network Access d’Atlas ha de permetre Render (`0.0.0.0/0` o les IPs que indiquin).

### Redeploy

1. Push a `main` (o Manual Deploy a Render).
2. Mirar logs: `Connectat a MongoDB` + `api-node escoltant…`.
3. Provar `/health`.

## App (APK)

Des de [Caliu-FrontEnd](https://github.com/pes2627q1-11-gei-upc/Caliu-FrontEnd):

```powershell
cd Caliu-FrontEnd
flutter build apk --dart-define=API_BASE_URL=https://caliu-api.onrender.com
```

Fitxer: `build\app\outputs\flutter-apk\app-release.apk`

Instal·lar al mòbil → pestanya **Perfil** → ha de sortir Connectat amb la URL d’HTTPS.

## Local (recordatori)

- Docker: `docker compose up -d mongo api-node`
- Mòbil USB: `.\scripts\run-mobil.ps1` al front (`adb reverse`)
