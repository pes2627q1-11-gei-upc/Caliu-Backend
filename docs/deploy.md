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

`PORT` el posa Render sol.

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
