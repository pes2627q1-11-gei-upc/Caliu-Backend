# Com contribuir — Caliu Backend

## Abans de començar

1. Llegeix [docs/onboarding.md](docs/onboarding.md) i aixeca Docker.
2. Mira el contracte [docs/openapi.yaml](docs/openapi.yaml) abans de canviar rutes o camps.
3. Agafa la història a **Taiga** (*Cultura't - Caliu*) i marca-la *In progress*.

## Flux Git (estil Git Flow)

| Branca | Ús |
|--------|-----|
| `main` | Estable / entregable |
| `development` | Integració del sprint |
| `feature/<id-taiga>-<nom>` | Una tasca; surt de `development` i hi torna amb PR |

Exemple de branca: `feature/80-filtre-categoria`

1. `git checkout development && git pull`
2. `git checkout -b feature/<id>-<nom-curt>`
3. Commits i push de la branca
4. **Pull request** cap a `development` (plantilla a `.github/pull_request_template.md`)
5. Quan calgui alliberar: PR de `development` → `main`
6. Actualitza Taiga en merge (*Ready for test* / *Closed*)

Més detall: [docs/git-workflow.md](docs/git-workflow.md).

## Commits

Format: `task #<id>: <resum en imperatiu>`  
El resum (després dels dos punts) **≤ 50 caràcters**.

```
task #80: afegeix filtre per categoria a /events
```

## Tests abans del PR

```powershell
cd apps/api-node
npm test

# si toques Python:
cd apps/python-service
python -m pytest
```

La CI (`ci-node` / `ci-python`) corre a les PR cap a `development` i `main` quan canvien els paths corresponents.

## Estil de codi

- `api-node`: ESM (`"type": "module"`), errors via `errorHandler`, respostes coherents amb OpenAPI.
- No afegeixis secrets al repo; actualitza `.env.example` si afegeixes variables noves.
