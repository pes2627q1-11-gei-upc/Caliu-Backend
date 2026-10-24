# Onboarding — Caliu Backend

Guia per tenir l’API en marxa en menys de 15 minuts.

## Requisits

- Git
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) en marxa
- (Opcional) Node 22 si vols córrer `api-node` fora de Docker

## Passos

1. Clona el repo i entra al directori.
2. `copy .env.example .env` (Windows) o `cp .env.example .env`.
3. Edita `.env`: com a mínim `MONGO_USER`, `MONGO_PASSWORD`, `MONGO_DB`, `JWT_SECRET`.
4. `docker compose up -d --build`
5. Comprova: `curl.exe http://localhost:3000/health`

### Dades locals

```powershell
docker compose exec api-node npm run seed
curl.exe "http://localhost:3000/events?limit=3"
```

### Atlas (dades reals)

Si l’equip comparteix `API_MONGO_URI`, posa-la al `.env` (amb el nom de BD al path). **No** executis `seed` contra Atlas.

## Front

El client mòbil és [Caliu-FrontEnd](https://github.com/pes2627q1-11-gei-upc/Caliu-FrontEnd). Des de l’emulador Android la base URL és `http://10.0.2.2:3000`; des d’un mòbil físic, la IP Wi‑Fi del PC (o USB + `adb reverse`).

## API a Render

URL: **https://caliu-api.onrender.com**

```powershell
curl.exe https://caliu-api.onrender.com/health
curl.exe "https://caliu-api.onrender.com/events?limit=3"
```

Variables al servei: `MONGO_URI` (Atlas), `JWT_SECRET`. Root Directory: `apps/api-node`.

## On mirar després

| Recurs | Contingut |
|--------|-----------|
| [README](../README.md) | Visió general i stack |
| [openapi.yaml](openapi.yaml) | Contracte API |
| [arquitectura.md](arquitectura.md) | Components i flux de dades |
| [git-workflow.md](git-workflow.md) | Branques, PR i commits |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Com contribuir |
