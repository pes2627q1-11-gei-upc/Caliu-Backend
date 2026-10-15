import re
from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.ingest.categories import EVENT_CATEGORIES, categorize
from app.ingest.normalize import (
    SkipEvent,
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
    assert ev["endDate"] == ev["startDate"]  # dataFi 2924 descartada
    assert ev["municipality"] == "Terrassa"
    assert ev["comarca"] == "Vallès Occidental"
    assert ev["location"] == {"type": "Point", "coordinates": [2.0117083, 41.5652128]}
    assert ev["price"] == 0.0  # esGratuit=True
    assert ev["url"] == "https://www.espaivapor.com/"
    assert ev["images"] == [RAW["imatge"]]
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
    [("Consultar condicions", True, 0.0), ("Gratuït", None, 0.0), ("12,50 €", False, 12.5),
     ("5€ anticipada", None, 5.0), ("Consultar condicions", False, None), ("", None, None), (None, None, None)],
)
def test_parse_price(text, free, expected):
    assert parse_price(text, free) == expected


def test_parse_date_naive_string_is_local_and_bson_datetime_is_utc():
    assert parse_date("2026-01-10 10:00:00") == datetime(2026, 1, 10, 9, 0, tzinfo=timezone.utc)  # CET
    assert parse_date(datetime(2026, 1, 10, 10, 0)) == datetime(2026, 1, 10, 10, 0, tzinfo=timezone.utc)
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

