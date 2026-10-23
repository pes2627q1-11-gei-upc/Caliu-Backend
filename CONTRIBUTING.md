# Com contribuir — Caliu Backend

Gràcies per contribuir al backend de Caliu.

## Abans de començar

1. Llegeix [docs/onboarding.md](docs/onboarding.md) i aixeca Docker.
2. Mira el contracte [docs/openapi.yaml](docs/openapi.yaml) abans de canviar rutes o camps.
3. Agafa la història a **Taiga** (*Cultura't - Caliu*) i marca-la *In progress*.

## Flux

1. Branca des de `main` (o `development`).
2. Canvis petits i enfocats a una història.
3. Tests: `cd apps/api-node && npm test` (i pytest si toques Python).
4. PR amb `Refs: #NN` al cos o als commits.
5. Quan es mergeï, actualitza Taiga (*Ready for test* / *Closed*).

Detall de branques i missatges: [docs/git-workflow.md](docs/git-workflow.md).

## Estil de codi

- `api-node`: ESM (`"type": "module"`), errors via `errorHandler`, respostes coherents amb OpenAPI.
- No afegeixis secrets al repo; actualitza `.env.example` si afegeixes variables noves.
