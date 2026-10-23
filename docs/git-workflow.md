# Flux de Git — Caliu

## Branques

- `main` — branca estable; el que es demostra i es revisa
- `feature/...` o `fix/...` — treball en curs (opcional però recomanat)
- Alguns canvis van per la branca `development` i es fusionen amb PR

## Pull requests

1. Obre un PR cap a `main` (o `development` si l’equip ho acorda).
2. Descripció: què canvia, com provar-ho, enllaç Taiga (`#NN`).
3. La CI ha de passar (api-node / python-service / Flutter segons el repo).
4. Almenys una revisió abans de merge, quan sigui possible.

## Commits

Estil [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(api): filtre per categoria a GET /events

Refs: #80
```

Tipus habituals: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`.

## Secrets

Mai commits amb `.env`, claus d’Atlas, Maps API keys ni `local.properties`.
