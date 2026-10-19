import re
from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.ingest.categories import EVENT_CATEGORIES, categorize
from app.ingest.normalize import (
    SkipEvent,
    hour_from_schedule,
    gencat_taxonomy,
    normalize_event,
    parse_date,
    parse_location,
    parse_place,
    parse_price,
    pick_event_url,
    slug_to_label,
)
from app.ingest.runner import build_operation, convert

# Document REAL de la col·lecció font (Atlas), retallat.
GENCAT_SEARCH = (
    "https://agenda.cultura.gencat.cat/content/agenda/ca/results.html?c=eyJrZXl3b3JkcyI6IiIsImRhdGFPcHRpb24iOiIiLCJkYXRhRGVzZGUiOiIiLCJkYXRhRmluc2EiOiIiLCJlc3BhaSI6IiIsInBvYmxhY2lvIjoiIiwiYW1iaXRzIjpbImFnZW5kYTphbWJpdHMvbXVzaWNhIl0sImNhdGVnb3JpZXMiOlsiYWdlbmRhOmNhdGVnb3JpZXMvZmVzdGl2YWxzLWktbW9zdHJlcyJdfQ__&page=0"
)
RAW = {
    "_id": "6ace1abe9a0e71351ff1a31e",
    "codiGencat": "20240605022",
    "actualitzatEl": "2026-10-15 04:00:05.515000",
    "dataFi": "2924-06-30 00:00:00",  # errata de la font
    "dataInici": "2024-06-28 00:00:00",
    "descripcio": "Espai Vapor pretén ser un lloc obert a la ciutat.   Podeu consultar la programació.",
    "esGratuit": True,
    "etiquetes": [],
    "horari": "",
    "localitzacio": {"type": "Point", "coordinates": [2.0117083, 41.5652128]},
    "preu": "Consultar condicions",
    "titol": "Espai Vapor",
    "ubicacio": {
        "municipi": "agenda:ubicacions/barcelona/valles-occidental/terrassa",
        "comarca": "agenda:ubicacions/barcelona/valles-occidental",
        "adreca": "",
    },
    "urlOficial": f"https://www.espaivapor.com/,{GENCAT_SEARCH},https://agenda.cultura.gencat.cat",
    "imatge": "https://cultura.gencat.cat/content/dam/agenda/articles/2024/06/05/022/espai-vapor-1.jpg",
}


def test_categories_match_node_source_of_truth():
    js = Path(__file__).parents[2] / "api-node/src/domain/eventCategories.js"
    if not js.exists():
        pytest.skip("api-node no disponible")
    body = js.read_text(encoding="utf-8").split("[", 1)[1].split("]", 1)[0]
    in_js = [ln.strip().rstrip(",")[1:-1] for ln in body.splitlines() if ln.strip().startswith(("'", '"'))]
    assert in_js == EVENT_CATEGORIES


def test_normalize_real_document():
    ev = normalize_event(RAW)
    assert ev["code"] == "20240605022"
    assert ev["title"] == "Espai Vapor"
    assert ev["startDate"] == datetime(2024, 6, 27, 22, 0, tzinfo=timezone.utc)  # 00:00 CEST -> UTC
    # dataFi 2924 descartada -> es queda a l'últim moment del dia d'inici (23:59:59 locals)
    assert ev["endDate"] == datetime(2024, 6, 28, 21, 59, 59, tzinfo=timezone.utc)
    assert ev["municipality"] == "Terrassa"
    assert ev["comarca"] == "Vallès Occidental"
    assert ev["location"] == {"type": "Point", "coordinates": [2.0117083, 41.5652128]}
    assert "price" not in ev  # esGratuit=True del trigger NO és fiable; preu = "Consultar condicions"
    assert ev["url"] == "https://www.espaivapor.com/"
    assert ev["images"] == [RAW["imatge"].replace("://cultura.gencat.cat/", "://agenda.cultura.gencat.cat/")]
    assert "Música" in ev["categories"]  # ve de l'àmbit codificat a l'URL del cercador
    assert ev["source"] == "ingest"


def test_gencat_taxonomy_decodes_search_url():
    assert gencat_taxonomy(GENCAT_SEARCH) == ["musica", "festivals i mostres"]
    assert gencat_taxonomy("https://example.cat/?c=%%%") == []
    assert gencat_taxonomy(None) == []


def test_pick_event_url_skips_search_links():
    assert pick_event_url(f"{GENCAT_SEARCH},https://agenda.cultura.gencat.cat") == ""
    assert pick_event_url("https://a.cat/x,https://b.cat") == "https://a.cat/x"


def test_skips_invalid():
    with pytest.raises(SkipEvent, match="sense_codi"):
        normalize_event({"titol": "x", "dataInici": "2026-01-01 10:00:00"})
    with pytest.raises(SkipEvent, match="sense_titol"):
        normalize_event({"codiGencat": "1", "dataInici": "2026-01-01 10:00:00"})
    with pytest.raises(SkipEvent, match="sense_data_inici"):
        normalize_event({"codiGencat": "1", "titol": "x"})


def test_end_date_rules():
    base = {"codiGencat": "1", "titol": "x", "dataInici": "2026-05-02 10:00:00"}
    assert normalize_event({**base, "dataFi": "2026-05-01 10:00:00"})["endDate"] == normalize_event(base)["startDate"]
    assert normalize_event(base)["endDate"] == normalize_event(base)["startDate"]
    ok = normalize_event({**base, "dataFi": "2026-08-01 20:00:00"})  # exposició de mesos: es respecta
    assert ok["endDate"] > ok["startDate"]


@pytest.mark.parametrize(
    "coords,expected",
    [
        ([2.17, 41.38], [2.17, 41.38]),
        ([41.38, 2.17], [2.17, 41.38]),  # [lat, lng] intercanviats
        ([0, 0], None),
        ([2.35, 48.85], None),  # París
        ([2.1], None),
        (["a", "b"], None),
    ],
)
def test_parse_location(coords, expected):
    loc = parse_location({"type": "Point", "coordinates": coords})
    assert (loc["coordinates"] if loc else None) == expected


def test_parse_location_not_geojson():
    assert parse_location(None) is None
    assert parse_location("41,2") is None


@pytest.mark.parametrize(
    "text,free,expected",
    [
        ("Consultar condicions", "Sí", 0.0),  # gratuita = "Sí"
        ("Consultar condicions", "No", None),
        ("Preu: 3 €", "No", 3.0),
        ("Els concerts són d'accés gratuït.", "No", 0.0),
        ("12,50 €", None, 12.5),
        ("", "No", None),
        (None, None, None),
        (None, True, 0.0),
        ("Reserva al 938 123 456", "No", None),  # un telèfon no és un preu
        ("Entrades a partir de les 18 h", "No", None),
        ("Aforament limitat a 50 persones", "No", None),
        ("5 euros", "No", 5.0),
        ("Preu: € 7,50", "No", 7.5),
    ],
)
def test_parse_price(text, free, expected):
    assert parse_price(text, free) == expected


def test_parse_date_naive_values_are_local_time():
    assert parse_date("2026-01-10 10:00:00") == datetime(2026, 1, 10, 9, 0, tzinfo=timezone.utc)  # CET
    # un BSON Date del trigger porta l'hora local com si fos UTC: es llegeix com a hora local
    assert parse_date(datetime(2026, 1, 10, 10, 0)) == datetime(2026, 1, 10, 9, 0, tzinfo=timezone.utc)
    assert parse_date(datetime(2026, 7, 10, 10, 0)) == datetime(2026, 7, 10, 8, 0, tzinfo=timezone.utc)  # CEST
    assert parse_date("no és una data") is None


def test_parse_place_and_labels():
    assert parse_place("agenda:ubicacions/barcelona/barcelones/barcelona", "agenda:ubicacions/barcelona/barcelones") == ("Barcelona", "Barcelonès")
    assert parse_place("Girona", "Gironès") == ("Girona", "Gironès")  # text pla: es respecta
    assert parse_place(None, None) == ("", "")
    assert slug_to_label("vilafranca-del-penedes") == "Vilafranca del Penedes"
    assert slug_to_label("l-hospitalet-de-llobregat") == "L'Hospitalet de Llobregat"


def test_categorize():
    assert categorize("agenda:categories/teatre") == ["Teatre"]
    assert "Nit" in categorize("res", start_hour_local=22)
    assert categorize("res", start_hour_local=None) == []


@pytest.mark.parametrize(
    "title,expected",
    [
        ("11è Festival Internacional d’Orgue de Capellades", ["Música"]),
        ("Frame Film Festival", ["Arts"]),
        ("Festival Internacional de Pallassos 2026", ["Teatre"]),
        ("Mostra Internacional de Films de Dones", ["Arts"]),
        ("Festival Empremtes", []),  # "festival" sol no és prou
        ("Circuit de curses", []),  # "circ$" és paraula exacta: no ha de coincidir amb "circuit"
        ("Concert de Nadal", ["Música"]),
    ],
)
def test_categorize_titles(title, expected):
    assert categorize(title) == expected


def test_description_needs_two_hits():
    assert categorize("Josafat", "Una sola menció de concert.") == []
    assert categorize("Josafat", "Un concert de jazz i música en directe.") == ["Música"]


def test_midnight_start_is_not_night():
    ev = normalize_event({"codiGencat": "1", "titol": "Fira", "dataInici": "2026-05-02 00:00:00"})
    assert "Nit" not in ev["categories"]


def test_convert_counts_and_dedupes():
    ok = {"codiGencat": "3", "titol": "ok", "dataInici": "2026-01-01 10:00:00"}
    docs = [RAW, {**RAW, "titol": "Nou títol"}, {"codiGencat": "2"}, ok]
    events, skipped = convert(docs)
    assert [e["code"] for e in events] == ["20240605022", "3"]
    assert events[0]["title"] == "Nou títol"  # l'últim guanya
    assert skipped["codi_duplicat"] == 1 and skipped["sense_titol"] == 1


def test_build_operation_unsets_missing_optionals():
    ev = normalize_event({"codiGencat": "1", "titol": "x", "dataInici": "2026-05-02 10:00:00"})
    flt, upd = build_operation(ev, datetime.now(timezone.utc))
    assert flt == {"code": "1"}
    assert set(upd["$unset"]) == {"location", "price"}
    assert "createdAt" in upd["$setOnInsert"] and "createdAt" not in upd["$set"]



@pytest.mark.parametrize(
    "text,expected",
    [
        ("A les 18 h", 18),
        ("21.30 h", 21),
        ("A partir de les 18.30 h", 18),
        ("20 h Durada aproximada: 1 hora i 30 minuts.", 20),
        ("Dimarts: de 16 a 20 h De dimecres a dissabtes: d'11 a 22 h", None),  # horari d'obertura
        ("1 hora de durada", None),
        ("", None),
        (None, None),
    ],
)
def test_hour_from_schedule(text, expected):
    assert hour_from_schedule(text) == expected


def test_single_day_event_stays_active_all_day():
    ev = normalize_event({"codiGencat": "1", "titol": "Fira", "dataInici": "2026-05-02 00:00:00", "dataFi": "2026-05-02 00:00:00"})
    assert ev["endDate"] == datetime(2026, 5, 2, 21, 59, 59, tzinfo=timezone.utc)  # 23:59:59 CEST


def test_night_comes_from_schedule_not_from_midnight_date():
    base = {"codiGencat": "1", "titol": "x", "dataInici": "2026-05-02 00:00:00"}
    assert "Nit" in normalize_event({**base, "horari": "21.30 h"})["categories"]
    assert "Nit" not in normalize_event({**base, "horari": "A les 18 h"})["categories"]


def test_raw_dataset_fields_and_relative_images():
    raw = {
        "codiGencat": "20260430004",
        "titol": "30 elefants sota un paraigua",
        "dataInici": "2026-05-30 00:00:00",
        "dataFi": "2026-05-30 00:00:00",
        "horari": "17 h",
        "tags_categor_es": "agenda:categories/teatre,agenda:categories/infantil",
        "tags_mbits": "agenda:ambits/espectacles",
        "entrades": "Preu: 3 €",
        "gratuita": "No",
        "espai": 'Centre Cultural Municipal "Lo Casino"',
        "imatges": "/content/dam/agenda/a.jpg,/content/dam/agenda/b.jpg",
        "esGratuit": True,  # valor erroni del trigger: s'ha d'ignorar
    }
    ev = normalize_event(raw)
    assert ev["price"] == 3.0
    assert ev["venue"] == 'Centre Cultural Municipal "Lo Casino"'
    assert ev["tags"] == ["Teatre", "Infantil"]
    assert "Teatre" in ev["categories"]
    assert ev["images"] == ["https://agenda.cultura.gencat.cat/content/dam/agenda/a.jpg", "https://agenda.cultura.gencat.cat/content/dam/agenda/b.jpg"]


def test_legacy_absolute_image_host_is_rewritten():
    ev = normalize_event({
        "codiGencat": "1", "titol": "x", "dataInici": "2026-01-01 10:00:00",
        "imatge": "https://cultura.gencat.cat/content/dam/agenda/a.jpg",
    })
    assert ev["images"] == ["https://agenda.cultura.gencat.cat/content/dam/agenda/a.jpg"]
