# Recomanador — Caliu

Paràmetres del model de recomanació (HU #10) i com ajustar-los sense tocar el codi ni redesplegar.

## Pesos

Cada pes indica quanta importància té un senyal quan es puntua un esdeveniment per a un usuari.
Com més alt és un pes respecte dels altres, més influeix aquell senyal en l'ordre de les recomanacions.

| Pes | Per defecte | Què mesura |
|-----|-------------|------------|
| `favoriteCategories` | 3 | L'esdeveniment és d'una categoria dels favorits de l'usuari |
| `favoriteTags` | 1 | L'esdeveniment comparteix etiquetes amb els favorits de l'usuari |
| `preferences` | 2 | L'esdeveniment és d'una categoria de les preferències de l'usuari (`/users/me/preferences`) |
| `proximity` | 2 | L'esdeveniment és a prop, dins del radi d'activitat de l'usuari (`proximitatKm`) |

Els valors per defecte són un punt de partida per calibrar. La fórmula que combina els pesos per calcular
la puntuació la defineix l'algorisme de scoring (#119); quan estigui fet, aquest document s'ha d'actualitzar.

Codi: valors per defecte i validació a `apps/api-node/src/domain/recommenderWeights.js`; lectura i escriptura
a `apps/api-node/src/models/RecommenderConfig.js`.

## On es guarden

| Camp | Valor |
|------|-------|
| Col·lecció | `recommenderconfigs` |
| Document | un de sol, amb `_id: "default"` |
| Pesos | camp `weights` (`{ favoriteCategories, favoriteTags, preferences, proximity }`) |

- **Sense document**, el recomanador fa servir els pesos per defecte.
- Si el document té un pes **no vàlid** (p. ex. editat a mà), aquell pes s'ignora i es fa servir el per defecte.
- Si tots els pesos resultants són **0**, es fan servir tots els per defecte (amb tot a 0 no s'ordenaria res).
- Els pesos es llegeixen de la base de dades cada vegada que es demanen (`loadRecommenderWeights()`, sense
  memòria cau): un canvi s'aplica a la lectura següent, **sense reiniciar ni redesplegar**.

## Com canviar-los

Amb l'script `recommender:weights`, des de `apps/api-node`. Necessita la variable `MONGO_URI` de la base de dades.

```powershell
npm run recommender:weights                                   # mostra els pesos vigents
npm run recommender:weights -- proximity=3                    # canvia un pes (la resta es mantenen)
npm run recommender:weights -- favoriteCategories=4 favoriteTags=0.5
npm run recommender:weights -- --reset                        # torna als pesos per defecte
```

El `--` passa els arguments a l'script. Cada argument té el format `pes=valor`.

**Amb Docker Compose** (el contenidor ja té `MONGO_URI`):

```powershell
docker compose exec api-node npm run recommender:weights -- proximity=3
```

**Fora de Docker** cal definir `MONGO_URI` (no es llegeix el `.env` automàticament):

```powershell
$env:MONGO_URI = "mongodb://..."
npm run recommender:weights
```

## Validació

Un canvi es rebutja, i **no es desa res**, si:

- un argument no té el format `pes=valor`;
- el nom del pes no és cap dels quatre de la taula;
- el valor no és un número, és buit, negatiu o infinit;
- després del canvi, tots els pesos quedarien a 0.

Els errors de validació expliquen què cal corregir. Els errors de connexió es mostren amb un missatge genèric
perquè no surti la URI de la base de dades.

## Permisos i precaucions

- Només pot canviar els pesos qui té accés a la base de dades (`MONGO_URI`). No hi ha cap ruta a l'API per
  fer-ho, així que un usuari de l'app no els pot modificar.
- **Contra Atlas el canvi afecta les recomanacions reals a l'instant.** Proveu els valors primer amb el Mongo
  local de Docker Compose.
- Abans de canviar-los, consulteu els vigents (`npm run recommender:weights`) per poder-los recuperar.
