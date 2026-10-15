"""Ingesta: llegeix la col·lecció font (dades obertes ja carregades a Mongo), normalitza
i fa upsert a la col·lecció `events` de Caliu (la que llegeix api-node via Mongoose).

Ús:
    python -m app.ingest              # ingesta real
    python -m app.ingest --dry-run    # no escriu res, només mostra l'estadística
    python -m app.ingest --limit 50   # només els 50 primers (per provar)
"""
import argparse
import logging
import os
import sys
from collections import Counter
from datetime import datetime, timezone

from .normalize import SkipEvent, normalize_event

log = logging.getLogger("caliu.ingest")

BATCH_SIZE = 500
# Camps que només tenen sentit si la font els té: si desapareixen, s'han d'esborrar.
OPTIONAL_FIELDS = ("location", "price")


def build_operation(doc: dict, now: datetime) -> tuple[dict, dict]:
    """(filtre, update) per a un upsert idempotent per `code`. Funció pura."""
    unset = {f: "" for f in OPTIONAL_FIELDS if f not in doc}
    update: dict = {
        "$set": {**doc, "updatedAt": now},
        "$setOnInsert": {"createdAt": now},
    }
    if unset:
        update["$unset"] = unset
    return {"code": doc["code"]}, update


def convert(raw_docs, limit: int | None = None) -> tuple[list[dict], Counter]:
    """Normalitza els documents. Retorna (events vàlids, comptador de motius d'omissió)."""
    events: dict[str, dict] = {}
    skipped: Counter = Counter()
    for i, raw in enumerate(raw_docs):
        if limit is not None and i >= limit:
            break
        try:
            ev = normalize_event(raw)
        except SkipEvent as e:
            skipped[str(e)] += 1
            continue
        except Exception as e:  # un document estrany no ha de tombar tota la ingesta
            log.warning("Document %s no processable: %s", raw.get("_id"), e)
            skipped["error_inesperat"] += 1
            continue
        if ev["code"] in events:
            skipped["codi_duplicat"] += 1
        events[ev["code"]] = ev  # l'últim guanya
    return list(events.values()), skipped


def run_ingest(source_coll, target_coll, *, dry_run=False, limit=None) -> dict:
    from pymongo import UpdateOne  # import aquí perquè els tests de lògica pura no el necessitin

    events, skipped = convert(source_coll.find({}), limit)
    stats = {
        "read_ok": len(events),
        "skipped": dict(skipped),
        "inserted": 0,
        "updated": 0,
        "no_location": sum(1 for e in events if "location" not in e),
        "no_category": sum(1 for e in events if not e["categories"]),
    }
    if dry_run or not events:
        return stats

    now = datetime.now(timezone.utc)
    for start in range(0, len(events), BATCH_SIZE):
        ops = []
        for ev in events[start:start + BATCH_SIZE]:
            flt, upd = build_operation(ev, now)
            ops.append(UpdateOne(flt, upd, upsert=True))
        res = target_coll.bulk_write(ops, ordered=False)
        stats["inserted"] += res.upserted_count
        stats["updated"] += res.modified_count
    return stats


def main(argv=None) -> int:
    from pymongo import MongoClient

    parser = argparse.ArgumentParser(description="Ingesta d'esdeveniments a Caliu")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    target_uri = os.environ.get("MONGO_URI")
    if not target_uri:
        log.error("Falta MONGO_URI")
        return 1
    # Per defecte la font és el mateix servidor Mongo; es pot apuntar a un altre.
    source_uri = os.environ.get("SOURCE_MONGO_URI") or target_uri
    source_db = os.environ.get("SOURCE_DB")
    source_coll = os.environ.get("SOURCE_COLLECTION")
    if not source_db or not source_coll:
        log.error("Falten SOURCE_DB i/o SOURCE_COLLECTION")
        return 1

    source_client = MongoClient(source_uri)
    target_client = source_client if source_uri == target_uri else MongoClient(target_uri)
    target_db = target_client.get_default_database()  # nom de la BD dins de MONGO_URI

    stats = run_ingest(
        source_client[source_db][source_coll],
        target_db["events"],
        dry_run=args.dry_run,
        limit=args.limit,
    )
    log.info("Ingesta %s: %s", "(dry-run)" if args.dry_run else "completada", stats)
    return 0


if __name__ == "__main__":
    sys.exit(main())
