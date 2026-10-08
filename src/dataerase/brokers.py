"""The list of data brokers and how to get off each one.

The list lives in data/brokers.json and has no personal data in it, only
public company details. load() checks every entry, so a typo in the file
fails loudly instead of sending a broken request later.

Besides the brokers, the file keeps two short lists:
  retired     sites that shut down or changed hands, and why, so nobody re-adds them
  references  public broker lists (state registries etc.) to find new brokers from
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from importlib import resources
from pathlib import Path
from urllib.parse import urlparse

# official-tool  one request reaches many companies (government or industry run)
# people-search  public sites that show a profile of you
# aggregator     behind-the-scenes sellers: marketing, risk, identity, property data
# b2b-contacts   work contact databases
CATEGORIES = ("official-tool", "people-search", "aggregator", "b2b-contacts")
METHODS = ("web-form", "email", "account-dashboard", "phone", "mail", "official-portal")
VERIFICATION = ("email-link", "phone-call", "sms-code", "captcha", "id-document", "account-login", "none", "unknown")
CONFIDENCE = ("checked-live", "recent-guides", "unsure")

# What a broker can ask for. These map onto profile fields, except listing_url
# (found per site) and signature (you do that yourself).
FIELDS = ("full_name", "email", "phone", "street_address", "city_state", "zip", "birth_date", "age",
          "listing_url", "signature", "id_document", "ssn", "payment")
# The tool never sends or does these automatically. A broker that wants them
# is flagged so you can decide by hand (often you can skip it, or black out
# everything but your name and address).
NEVER_SEND = frozenset({"id_document", "ssn", "payment"})


class BrokerListError(Exception):
    pass


@dataclass(frozen=True)
class Broker:
    id: str
    name: str
    website: str
    category: str
    owner: str | None
    covers: tuple[str, ...]
    opt_out_url: str | None
    method: str
    contact_email: str | None
    needs_listing_url: bool
    requires: tuple[str, ...]
    verification: tuple[str, ...]
    processing_days: int | None
    regions: tuple[str, ...]
    search_url: str | None
    notes: str
    sources: tuple[str, ...]
    confidence: str
    checked: str  # YYYY-MM-DD this entry was last checked

    @property
    def domain(self) -> str:
        return _domain(self.website)

    @property
    def red_flags(self) -> tuple[str, ...]:
        """Things the broker asks for that the tool won't hand over."""
        return tuple(f for f in self.requires if f in NEVER_SEND)


@dataclass(frozen=True)
class Link:
    """A retired site or a reference list: just a name, a URL and why it's here."""

    id: str
    name: str
    url: str
    notes: str
    checked: str


@dataclass(frozen=True)
class Catalog:
    brokers: tuple[Broker, ...]
    retired: tuple[Link, ...]
    references: tuple[Link, ...]

    def get(self, broker_id: str) -> Broker | None:
        return next((b for b in self.brokers if b.id == broker_id), None)


def load(path: Path | None = None) -> Catalog:
    if path is None:
        text = resources.files("dataerase").joinpath("data/brokers.json").read_text("utf-8")
    else:
        text = Path(path).read_text("utf-8")
    try:
        raw = json.loads(text)
    except json.JSONDecodeError as e:
        raise BrokerListError(f"brokers file is not valid JSON: {e}") from None
    if not isinstance(raw, dict) or not isinstance(raw.get("brokers"), list):
        raise BrokerListError('brokers file must be an object with a "brokers" list')

    brokers = [_parse(entry, i) for i, entry in enumerate(raw["brokers"])]
    retired = [_parse_link(entry, "retired") for entry in raw.get("retired", [])]
    references = [_parse_link(entry, "references") for entry in raw.get("references", [])]
    _check_whole_list(brokers, retired)
    return Catalog(tuple(brokers), tuple(retired), tuple(references))


def _parse_link(entry: object, section: str) -> Link:
    keys = set(Link.__dataclass_fields__)
    if not isinstance(entry, dict) or entry.keys() != keys:
        raise BrokerListError(f"each {section} entry needs exactly {sorted(keys)}")
    if not all(isinstance(entry[k], str) and entry[k] for k in keys):
        raise BrokerListError(f"{section} {entry.get('id')!r}: every field must be non-empty text")
    if urlparse(entry["url"]).scheme != "https":
        raise BrokerListError(f"{section} {entry['id']!r}: url must be https://")
    return Link(**entry)


def _parse(entry: object, index: int) -> Broker:
    where = f"broker #{index + 1}"
    if not isinstance(entry, dict):
        raise BrokerListError(f"{where} is not an object")
    where = f"broker {entry.get('id', index + 1)!r}"

    expected = set(Broker.__dataclass_fields__)
    if missing := expected - entry.keys():
        raise BrokerListError(f"{where} is missing {sorted(missing)}")
    if extra := entry.keys() - expected:
        raise BrokerListError(f"{where} has unknown keys {sorted(extra)}")

    def one_of(key: str, allowed: tuple[str, ...]) -> str:
        if entry[key] not in allowed:
            raise BrokerListError(f"{where}: {key} {entry[key]!r} is not one of {allowed}")
        return entry[key]

    def all_of(key: str, allowed: tuple[str, ...]) -> tuple[str, ...]:
        values = entry[key]
        if not isinstance(values, list) or not all(isinstance(v, str) for v in values):
            raise BrokerListError(f"{where}: {key} must be a list of strings")
        if bad := [v for v in values if allowed and v not in allowed]:
            raise BrokerListError(f"{where}: {key} has unknown values {bad}")
        return tuple(values)

    def url(key: str, optional: bool = True) -> str | None:
        value = entry[key]
        if value is None and optional:
            return None
        if not isinstance(value, str) or urlparse(value).scheme != "https" or not urlparse(value).netloc:
            raise BrokerListError(f"{where}: {key} must be an https:// URL")
        return value

    def text(key: str, optional: bool = False) -> str | None:
        value = entry[key]
        if value is None and optional:
            return None
        if not isinstance(value, str):
            raise BrokerListError(f"{where}: {key} must be text")
        return value

    if not (isinstance(entry["id"], str) and entry["id"]) or not (isinstance(entry["name"], str) and entry["name"].strip()):
        raise BrokerListError(f"{where}: id and name can't be empty")

    if not isinstance(entry["needs_listing_url"], bool):
        raise BrokerListError(f"{where}: needs_listing_url must be true or false")
    days = entry["processing_days"]
    if days is not None and (not isinstance(days, int) or isinstance(days, bool) or days < 0):
        raise BrokerListError(f"{where}: processing_days must be a whole number or null")
    try:
        date.fromisoformat(entry["checked"])
    except (TypeError, ValueError):
        raise BrokerListError(f"{where}: checked must be a date like 2026-10-08") from None

    broker = Broker(
        id=text("id"),
        name=text("name"),
        website=url("website", optional=False),
        category=one_of("category", CATEGORIES),
        owner=text("owner", optional=True),
        covers=tuple(c.lower() for c in all_of("covers", ())),
        opt_out_url=url("opt_out_url"),
        method=one_of("method", METHODS),
        contact_email=text("contact_email", optional=True),
        needs_listing_url=entry["needs_listing_url"],
        requires=all_of("requires", FIELDS),
        verification=all_of("verification", VERIFICATION),
        processing_days=days,
        regions=all_of("regions", ()),
        search_url=url("search_url"),
        notes=text("notes"),
        sources=all_of("sources", ()),
        confidence=one_of("confidence", CONFIDENCE),
        checked=entry["checked"],
    )
    if broker.id != broker.id.strip().lower() or " " in broker.id:
        raise BrokerListError(f"{where}: id must be a lowercase slug")
    if broker.method == "email" and not broker.contact_email:
        raise BrokerListError(f"{where}: method is email but there is no contact_email")
    # No fixed opt-out page is fine only when the link lives on your own listing.
    if broker.method != "email" and not broker.opt_out_url and not broker.needs_listing_url:
        raise BrokerListError(f"{where}: needs an opt_out_url")
    if broker.needs_listing_url != ("listing_url" in broker.requires):
        raise BrokerListError(f"{where}: needs_listing_url and requires['listing_url'] disagree")
    if not broker.sources:
        raise BrokerListError(f"{where}: needs at least one source")
    return broker


def _check_whole_list(brokers: list[Broker], retired: list[Link]) -> None:
    seen_ids: set[str] = set()
    by_domain: dict[str, str] = {}
    for b in brokers:
        if b.id in seen_ids:
            raise BrokerListError(f"duplicate id {b.id!r}")
        seen_ids.add(b.id)
        if b.domain in by_domain:
            raise BrokerListError(f"{b.id!r} and {by_domain[b.domain]!r} have the same website")
        by_domain[b.domain] = b.id
    for r in retired:
        if _domain(r.url) in by_domain:
            raise BrokerListError(f"{by_domain[_domain(r.url)]!r} is listed but {r.url} is marked retired")
    # A site removed by a sibling's request shouldn't also have its own entry,
    # or we'd send two requests and double the exposure.
    for b in brokers:
        for covered in b.covers:
            other = by_domain.get(_domain(covered))
            if other and other != b.id:
                raise BrokerListError(f"{b.id!r} covers {covered}, which also has its own entry {other!r}")


def _domain(url_or_host: str) -> str:
    host = urlparse(url_or_host).netloc or url_or_host
    host = host.lower().split(":")[0]
    return host[4:] if host.startswith("www.") else host
