# Caliu · Backend

API i serveis de **Caliu**: descoberta d’esdeveniments culturals a Catalunya (equip **Cultura't** · PES FIB-UPC · grup 11).

<p align="center">
  <a href="https://github.com/pes2627q1-11-gei-upc/Caliu-Backend/actions/workflows/ci-node.yml"><img src="https://github.com/pes2627q1-11-gei-upc/Caliu-Backend/actions/workflows/ci-node.yml/badge.svg?branch=main" alt="CI api-node"></a>
  <a href="https://github.com/pes2627q1-11-gei-upc/Caliu-Backend/actions/workflows/ci-python.yml"><img src="https://github.com/pes2627q1-11-gei-upc/Caliu-Backend/actions/workflows/ci-python.yml/badge.svg?branch=main" alt="CI python-service"></a>
  <img src="https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/MongoDB-Atlas%20%2F%20local-47A248?logo=mongodb&logoColor=white" alt="MongoDB">
  <img src="https://img.shields.io/badge/OpenAPI-3.0-85EA2D?logo=openapiinitiative&logoColor=black" alt="OpenAPI">
</p>

<p align="center">
  <a href="docs/onboarding.md"><b>Onboarding</b></a> ·
  <a href="docs/openapi.yaml"><b>OpenAPI</b></a> ·
  <a href="docs/arquitectura.md"><b>Arquitectura</b></a> ·
  <a href="CONTRIBUTING.md"><b>Contribuir</b></a> ·
  <a href="https://github.com/pes2627q1-11-gei-upc/Caliu-FrontEnd"><b>FrontEnd</b></a>
</p>

## Què fa

- Exposa una **API REST** (`api-node`) per llistar i consultar esdeveniments amb filtres (text, categoria, geolocalització, dates).
- Persisteix a **MongoDB** (Docker local o Atlas).
- Inclou un **python-service** (FastAPI) preparat per lògica auxiliar (p. ex. IA); avui amb healthcheck.
- La sincronització amb dades obertes de Catalunya pot viure a **Atlas Triggers** (`docs/atlas/`).

## Arrencada ràpida

Requisits: [Docker Desktop](https://www.docker.com/products/docker-desktop/) i Git.

```powershell
git clone https://github.com/pes2627q1-11-gei-upc/Caliu-Backend.git
cd Caliu-Backend
copy .env.example .env
# Edita .env (MONGO_*, JWT_SECRET). Per Atlas, omple API_MONGO_URI.
docker compose up -d --build
curl.exe http://localhost:3000/health
```

Resposta esperada: `{"status":"ok","service":"api-node"}`.

### Dades de prova (Mongo local)

Amb el compose en marxa i **sense** `API_MONGO_URI` (BD local del contenidor):

```powershell
docker compose exec api-node npm run seed
curl.exe "http://localhost:3000/events?lat=41.3851&lng=2.1734&radiusKm=50&limit=5"
```

> **No** executeu `seed` contra Atlas: només crea documents `source: seed` i la BD d’Atlas és la de dades reals.

### Port i serveis

| Servei | Port / accés |
|--------|----------------|
| `api-node` | `http://localhost:3000` (`NODE_PORT` al `.env`) |
| `mongo` | intern a Docker (o Atlas via `API_MONGO_URI`) |
| `python-service` | només xarxa Docker (`PYTHON_SERVICE_URL`) |

## Secrets

El repositori és públic: **mai** pugeu `.env`, claus d’Atlas ni API keys.

1. Copieu [`.env.example`](.env.example) → `.env`
2. Demaneu els valors reals a l’equip per un canal segur
3. `.env` ja està al [`.gitignore`](.gitignore)

## Contracte API

El contracte compartit amb el front és [`docs/openapi.yaml`](docs/openapi.yaml).

Endpoints principals:

| Mètode | Ruta | Descripció |
|--------|------|------------|
| `GET` | `/health` | Estat del servei |
| `GET` | `/events` | Llista amb filtres i paginació |
| `GET` | `/events/categories` | Categories disponibles |
| `GET` | `/events/:id` | Detall d’un esdeveniment |

Coordenades en ordre **GeoJSON** `[lng, lat]`. Errors: `{ "error": "…" }`.

## Stack

| Peça | Tecnologia |
|------|------------|
| API | Node.js + Express + Mongoose |
| Servei auxiliar | Python + FastAPI |
| Dades | MongoDB 7 (Compose) / Atlas |
| Contracte | OpenAPI 3 |
| CI | GitHub Actions (`ci-node`, `ci-python`) |
| Infra local | Docker Compose |

## Estructura

```
Caliu-Backend/
├── apps/
│   ├── api-node/          # REST + tests Jest
│   └── python-service/    # FastAPI + pytest
├── docs/
│   ├── openapi.yaml
│   └── atlas/             # scripts / trigger d’ingesta
├── docker-compose.yml
├── .env.example
└── .github/workflows/
```

## Tests

```powershell
# api-node
cd apps/api-node
npm install
npm test

# python-service
cd apps/python-service
pip install -r requirements.txt
python -m pytest
```

A cada PR que toqui `apps/api-node/**` o `apps/python-service/**`, la CI corresponent s’executa automàticament.

## Com treballem

- Canvis via **pull request** a `main`
- Commits preferiblement en [Conventional Commits](https://www.conventionalcommits.org/) amb referència Taiga, p. ex. `feat(api): filtre per categoria` + `Refs: #80`
- El front consumeix només aquesta API: [Caliu-FrontEnd](https://github.com/pes2627q1-11-gei-upc/Caliu-FrontEnd)

## Equip

**Cultura't · Caliu** — PES 2026-27 Q1 · FIB-UPC · grup 11.

Gestió de tasques a **Taiga** (projecte *Cultura't - Caliu*; enllaç intern de l’equip).
