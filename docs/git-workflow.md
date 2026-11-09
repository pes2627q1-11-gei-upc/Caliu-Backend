# Flux de Git — Caliu

Estil **Git Flow** simplificat: `main` + `development` + branques `feature/...`.

## Branques

| Branca | Ús |
|--------|-----|
| `main` | Estable; el que es demostra i es desplega |
| `development` | Integració contínua del sprint |
| `feature/<id-taiga>-<nom>` | Treball d’una tasca Taiga |

La feature **surt de** `development` i **hi torna** amb pull request.  
Per alliberar: PR de `development` → `main`.

Exemple: `feature/80-filtre-categoria`

## Pull requests

1. Obre el PR cap a `development` (o `development` → `main` per release).
2. Omple la plantilla (`.github/pull_request_template.md`): tasca Taiga, què/per què, proves, checklist DoD.
3. La CI ha de passar (`ci-node` / `ci-python` / Flutter al front).
4. Almenys una revisió abans de merge, quan sigui possible.
5. Actualitza Taiga després del merge.

## Commits

```
task #<id>: <resum en imperatiu>
```

- Imperatiu (`afegeix`, `corregeix`, `documenta`…).
- Resum **≤ 50 caràcters** (part després de `: `).

```
task #80: afegeix filtre per categoria a /events
```

## Secrets

Mai commits amb `.env`, claus d’Atlas, Maps API keys ni `local.properties`.
