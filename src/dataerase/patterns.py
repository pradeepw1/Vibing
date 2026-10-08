"""Turns a profile into regexes we can search text with.

Two kinds of search live here:
  * exact: look for the real values from your profile (needs the passphrase)
  * generic: look for anything that *looks* like an email, phone or SSN
    (needs nothing, so the git hook can use it)
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

from .profile import Profile

MIN_NAME_LEN = 5  # shorter names/aliases would match too much ordinary text
MIN_PHONE_DIGITS = 7


@dataclass(frozen=True)
class Matcher:
    label: str  # safe to print, e.g. "email #1"
    regex: re.Pattern[str]


def build_matchers(profile: Profile) -> tuple[list[Matcher], list[str]]:
    """Return (matchers, labels we had to skip because the value is too short)."""
    matchers: list[Matcher] = []
    skipped: list[str] = []

    def add(label: str, pattern: str) -> None:
        matchers.append(Matcher(label, re.compile(pattern, re.IGNORECASE)))

    def words(text: str) -> str:
        # Same words, any amount of whitespace between them, not inside a longer word.
        return r"(?<!\w)" + r"\s+".join(re.escape(w) for w in text.split()) + r"(?!\w)"

    for label, kind, value in profile.entries():
        value = value.strip()
        if kind == "email":
            add(label, re.escape(value))
        elif kind == "phone":
            digits = re.sub(r"\D", "", value)[-10:]  # ignore country code
            if len(digits) < MIN_PHONE_DIGITS:
                skipped.append(label)
                continue
            # Matches (212) 555-0147, 212.555.0147, +1 212 555 0147, 2125550147, ...
            add(label, r"(?<!\d)" + r"\D{0,3}".join(digits) + r"(?!\d)")
        elif kind == "address":
            add(label, words(value))
            street = value.split(",")[0].strip()
            if street != value and len(street) >= 6:
                add(label, words(street))
        elif kind == "date":
            forms = _date_forms(value)
            if not forms:
                skipped.append(label)
                continue
            for form in forms:
                add(label, r"(?<!\d)" + re.escape(form) + r"(?!\d)")
        else:  # names
            if len(value) < MIN_NAME_LEN:
                skipped.append(label)
                continue
            add(label, words(value))
    return matchers, skipped


def _date_forms(text: str) -> list[str]:
    try:
        d = date.fromisoformat(text.strip())
    except ValueError:
        return []
    return sorted(
        {
            d.isoformat(),
            f"{d:%m/%d/%Y}",
            f"{d:%d/%m/%Y}",
            f"{d.month}/{d.day}/{d.year}",
            f"{d.day}/{d.month}/{d.year}",
            f"{d:%B} {d.day}, {d.year}",
            f"{d.day} {d:%B} {d.year}",
        }
    )


# --- generic patterns (no profile needed) -------------------------------------

GENERIC = {
    "email address": re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}"),
    "phone number": re.compile(r"(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)"),
    "SSN": re.compile(r"(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)"),
}
OK_MARKER = "pii-ok"  # put this on a line to say "this one is fake"
_PLACEHOLDER_DOMAINS = ("example.com", "example.org", "example.net", ".invalid", ".test", ".localhost")
# Company inboxes, not people. Matched anywhere in the part before the @ ...
_ROLE_WORDS = ("privacy", "optout", "opt-out", "opt_out", "removal", "gdpr", "ccpa", "dataprotection",
               "data-protection", "unsubscribe", "compliance", "noreply", "no-reply", "donotreply")
# ... or as a whole word of it (info@, legal.team@, customer-support@).
_ROLE_TOKENS = {"info", "help", "support", "contact", "legal", "care", "hello", "service", "remove",
                "consumer", "requests", "dpo", "team", "sales", "admin"}
_TOLL_FREE = {"800", "833", "844", "855", "866", "877", "888"}  # business lines, never personal


def generic_hits(line: str) -> list[str]:
    """Labels of personal-looking data in a line.

    Ignored: lines marked `pii-ok`, placeholders (example.com, 555-01xx), company
    role inboxes (privacy@, support@) and toll-free numbers, so a list of broker
    contact details can be committed.
    """
    if OK_MARKER in line:
        return []
    return [
        label
        for label, regex in GENERIC.items()
        if any(not _is_not_personal(label, m.group()) for m in regex.finditer(line))
    ]


def _is_not_personal(label: str, text: str) -> bool:
    if label == "email address":
        local, _, domain = text.lower().rpartition("@")
        return (
            domain.endswith(_PLACEHOLDER_DOMAINS)
            or any(word in local for word in _ROLE_WORDS)
            or bool(_ROLE_TOKENS & set(re.split(r"[._+-]", local)))
        )
    if label == "phone number":
        digits = re.sub(r"\D", "", text)[-10:]
        # 555-0100..0199 are reserved for fiction
        return digits[:3] in _TOLL_FREE or bool(re.search(r"555[\s.-]?01\d\d", text))
    return False
