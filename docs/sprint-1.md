# Sprint 1 — Caliu

Resum del que s’ha entregat (octubre 2026).

## Objectiu

Tenir una app mòbil que mostri esdeveniments culturals de Catalunya (mapa, fitxa, cerca) alimentada per una API amb dades d’ingesta / Atlas.

## Backend

| Peça | Estat |
|------|--------|
| `api-node` (Express): `/health`, `/events`, `/events/:id`, `/events/categories` | Fet |
| Mongo local (Docker) + Atlas | Fet |
| Ingesta / trigger (docs Atlas) | Fet (equip) |
| CI Jest + pytest | Fet |
| OpenAPI (`docs/openapi.yaml`) | Fet |
| Desplegament Render | Fet → https://caliu-api.onrender.com |
| Auth / usuaris | En curs |

## Front (Flutter)

| Peça | Estat |
|------|--------|
| Mapa + geolocalització + pins | Fet |
| Fitxa d’esdeveniment + web oficial | Fet |
| Cerca / filtres / chips | Fet |
| Pestanya Perfil (estat API) | Fet |
| Script mòbil USB (`adb reverse`) | Fet |
| CI Flutter (`analyze` + test) | Fet |
| APK amb URL de Render | Per generar / compartir |

## Docs i procés

- README + onboarding + CONTRIBUTING
- Banner al README
- Commits amb `Refs: #NN` i PRs (objectiu d’equip)

## Com provar la demo

1. https://caliu-api.onrender.com/health  
2. APK o `flutter run --dart-define=API_BASE_URL=https://caliu-api.onrender.com`  
3. Mapa → fitxa → cerca → Perfil verd  

Detall de desplegament: [deploy.md](deploy.md).
