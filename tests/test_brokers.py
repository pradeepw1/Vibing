import json
from datetime import date
from pathlib import Path

import pytest

from dataerase import brokers, leakcheck
from dataerase.brokers import BrokerListError
from dataerase.cli import main
from dataerase.patterns import generic_hits


def entry(**overrides):
    base = {
        "id": "acme",
        "name": "Acme People Search",
        "website": "https://www.acme.example.com",
        "category": "people-search",
        "owner": None,
        "covers": [],
        "opt_out_url": "https://www.acme.example.com/optout",
        "method": "web-form",
        "contact_email": None,
        "needs_listing_url": True,
        "requires": ["listing_url", "email"],
        "verification": ["email-link"],
        "processing_days": 3,
        "regions": ["US"],
        "search_url": None,
        "notes": "",
        "sources": ["https://www.acme.example.com/optout"],
        "confidence": "checked-live",
        "checked": "2026-10-08",
    }
    return {**base, **overrides}


def write(tmp_path, *entries):
    path = tmp_path / "brokers.json"
    path.write_text(json.dumps({"brokers": list(entries)}))
    return path


# --- the list that ships with the tool ------------------------------------------


@pytest.fixture(scope="module")
def catalog():
    return brokers.load()


@pytest.fixture(scope="module")
def shipped(catalog):
    return catalog.brokers


def test_shipped_list_loads_and_is_not_empty(shipped):
    assert len(shipped) >= 30
    assert {b.category for b in shipped} == set(brokers.CATEGORIES)


def test_shipped_list_is_safe_to_commit():
    # The pre-commit hook must accept every line: company contact details only.
    allowed = leakcheck.load_allowlist(Path(__file__).resolve().parent.parent)
    text = brokers.resources.files("dataerase").joinpath("data/brokers.json").read_text("utf-8")
    flagged = [(n, generic_hits(line, allowed)) for n, line in enumerate(text.split("\n"), 1)]
    assert [f for f in flagged if f[1]] == []


def test_shipped_entries_are_dated_and_sourced(shipped):
    for b in shipped:
        assert date.fromisoformat(b.checked) <= date.today()
        assert all(s.startswith("https://") for s in b.sources), b.id


def test_shipped_search_urls_use_placeholders_only(shipped):
    for b in shipped:
        if b.search_url:
            assert "{" in b.search_url, b.id


def test_california_drop_is_listed(shipped):
    drop = [b for b in shipped if b.category == "official-tool" and "US-CA" in b.regions]
    assert drop, "the California one-stop deletion tool should be on the list"


def test_retired_and_reference_lists_ship(catalog):
    assert catalog.retired and catalog.references
    retired = {brokers._domain(r.url) for r in catalog.retired}
    assert not retired & {b.domain for b in catalog.brokers}


# --- validation -------------------------------------------------------------------


def test_good_entry_loads(tmp_path):
    [b] = brokers.load(write(tmp_path, entry())).brokers
    assert b.domain == "acme.example.com"
    assert b.requires == ("listing_url", "email")
    assert b.red_flags == ()


def test_red_flags_for_id_ssn_and_payment(tmp_path):
    [b] = brokers.load(write(tmp_path, entry(requires=["listing_url", "id_document", "ssn", "payment"]))).brokers
    assert b.red_flags == ("id_document", "ssn", "payment")


def test_opt_out_may_live_on_your_listing_page(tmp_path):
    [b] = brokers.load(write(tmp_path, entry(opt_out_url=None))).brokers
    assert b.opt_out_url is None and b.needs_listing_url


@pytest.mark.parametrize(
    "overrides,message",
    [
        ({"category": "spy"}, "category"),
        ({"method": "carrier-pigeon"}, "method"),
        ({"requires": ["listing_url", "mothers_maiden_name"]}, "requires has unknown"),
        ({"verification": ["vibes"]}, "verification has unknown"),
        ({"website": "http://acme.example.com"}, "https://"),
        ({"opt_out_url": "javascript:alert(1)"}, "https://"),
        ({"method": "email", "contact_email": None}, "no contact_email"),
        ({"opt_out_url": None, "needs_listing_url": False, "requires": ["email"]}, "needs an opt_out_url"),
        ({"needs_listing_url": False}, "disagree"),
        ({"processing_days": -1}, "processing_days"),
        ({"processing_days": True}, "processing_days"),
        ({"checked": "last week"}, "checked"),
        ({"sources": []}, "source"),
        ({"id": "Acme Corp"}, "slug"),
        ({"name": "  "}, "can't be empty"),
        ({"surprise": 1}, "unknown keys"),
    ],
)
def test_bad_entries_are_rejected(tmp_path, overrides, message):
    with pytest.raises(BrokerListError, match=message):
        brokers.load(write(tmp_path, entry(**overrides)))


def test_missing_key_is_rejected(tmp_path):
    bad = entry()
    del bad["regions"]
    with pytest.raises(BrokerListError, match="missing"):
        brokers.load(write(tmp_path, bad))


def test_duplicate_id_and_website(tmp_path):
    with pytest.raises(BrokerListError, match="duplicate id"):
        brokers.load(write(tmp_path, entry(), entry(website="https://other.example.com")))
    with pytest.raises(BrokerListError, match="same website"):
        brokers.load(write(tmp_path, entry(), entry(id="acme2", website="https://acme.example.com/")))


def test_site_covered_by_sibling_cannot_have_own_entry(tmp_path):
    parent = entry(covers=["sister.example.com"])
    sister = entry(id="sister", website="https://www.sister.example.com")
    with pytest.raises(BrokerListError, match="covers sister.example.com"):
        brokers.load(write(tmp_path, parent, sister))


def test_retired_site_cannot_come_back(tmp_path):
    path = tmp_path / "brokers.json"
    gone = {"id": "acme", "name": "Acme", "url": "https://acme.example.com", "notes": "shut down", "checked": "2026-10-08"}
    path.write_text(json.dumps({"brokers": [entry()], "retired": [gone]}))
    with pytest.raises(BrokerListError, match="marked retired"):
        brokers.load(path)


def test_bad_retired_or_reference_entry(tmp_path):
    path = tmp_path / "brokers.json"
    path.write_text(json.dumps({"brokers": [], "references": [{"id": "x", "name": "X", "url": "http://x.example.com", "notes": "n", "checked": "2026-10-08"}]}))
    with pytest.raises(BrokerListError, match="https"):
        brokers.load(path)
    path.write_text(json.dumps({"brokers": [], "retired": [{"id": "x"}]}))
    with pytest.raises(BrokerListError, match="needs exactly"):
        brokers.load(path)


def test_not_json_or_wrong_shape(tmp_path):
    path = tmp_path / "b.json"
    path.write_text("{nope")
    with pytest.raises(BrokerListError, match="not valid JSON"):
        brokers.load(path)
    path.write_text("[]")
    with pytest.raises(BrokerListError, match='"brokers" list'):
        brokers.load(path)


# --- the command ------------------------------------------------------------------


def test_cli_lists_brokers(capsys, shipped):
    assert main(["brokers"]) == 0
    out = capsys.readouterr().out
    assert f"{len(shipped)} brokers." in out
    assert shipped[0].id in out


def test_cli_filters_by_region(capsys, shipped):
    main(["brokers", "--region", "US"])
    us_only = capsys.readouterr().out
    main(["brokers", "--region", "US-CA"])
    california = capsys.readouterr().out
    # California residents can use everything a US resident can, plus state-only tools.
    count = lambda out: int(out.split(" brokers.")[0].split("\n")[-1])
    assert count(california) > count(us_only)


def test_cli_shows_one_broker(capsys, shipped):
    b = shipped[0]
    assert main(["brokers", b.id]) == 0
    out = capsys.readouterr().out
    assert b.name in out and (b.opt_out_url or b.contact_email) in out


def test_cli_unknown_broker(capsys):
    assert main(["brokers", "no-such-broker"]) == 1


def test_cli_explains_retired_broker(capsys, catalog):
    gone = catalog.retired[0]
    assert main(["brokers", gone.id]) == 1
    assert "retired" in capsys.readouterr().err


def test_cli_warns_about_red_flags(capsys, shipped):
    flagged = next(b for b in shipped if b.red_flags)
    main(["brokers"])
    assert flagged.id in capsys.readouterr().out.split("never gives:")[1]
    main(["brokers", flagged.id])
    assert "WARNING" in capsys.readouterr().out
