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
# Company inboxes, not people. These two lists are only trusted in the broker
# list file (company_contacts=True): anywhere else a personal address, like a
# +optout alias at Gmail or hello@ at your own domain, must still be caught.
# Matched anywhere in the part before the @ (and before any +tag) ...
_ROLE_WORDS = ("privacy", "optout", "opt-out", "opt_out", "removal", "gdpr", "ccpa", "dataprotection",
               "data-protection", "unsubscribe", "compliance", "noreply", "no-reply", "donotreply")
# ... or as a whole word of it (info@, legal.team@, customer-support@).
_ROLE_TOKENS = {"info", "help", "support", "contact", "legal", "care", "hello", "service", "remove",
                "consumer", "requests", "dpo", "team", "sales", "admin"}
_TOLL_FREE = {"800", "833", "844", "855", "866", "877", "888"}  # business lines, never personal
# Personal mailbox providers: never a company inbox, whatever the address says.
_WEBMAIL = {"gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
            "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com",
            "yandex.com", "zoho.com", "fastmail.com", "hey.com", "tutanota.com"}


def generic_hits(line: str, allowed: frozenset[str] = frozenset(), company_contacts: bool = False) -> list[str]:
    """Labels of personal-looking data in a line.

    Always ignored: lines marked `pii-ok`, placeholders (example.com, 555-01xx)
    and exact values in `allowed` (see allow_key).
    With company_contacts=True (only for the broker list file), company role
    inboxes (a broker's privacy@ address) and toll-free numbers are ignored too.
    """
    if OK_MARKER in line:
        return []
    return [
        label
        for label, regex in GENERIC.items()
        if any(
            not _is_not_personal(label, m.group(), company_contacts) and allow_key(m.group()) not in allowed
            for m in regex.finditer(line)
        )
    ]


def allow_key(value: str) -> str:
    """How a value is compared with the allow-list: emails ignore case, numbers ignore formatting."""
    value = value.strip()
    if "@" in value:
        return value.lower()
    return re.sub(r"\D", "", value)[-10:]


def _is_not_personal(label: str, text: str, company_contacts: bool = False) -> bool:
    if label == "email address":
        local, _, domain = text.lower().rpartition("@")
        if domain.endswith(_PLACEHOLDER_DOMAINS) or local.startswith(("noreply", "no-reply")):
            return True
        if not company_contacts or domain in _WEBMAIL:
            return False
        base = local.split("+")[0]  # jane+optout@ is Jane, not an opt-out team
        return any(word in base for word in _ROLE_WORDS) or bool(_ROLE_TOKENS & set(re.split(r"[._-]", base)))
    if label == "phone number":
        if re.search(r"555[\s.-]?01\d\d", text):  # 555-0100..0199 are reserved for fiction
            return True
        return company_contacts and re.sub(r"\D", "", text)[-10:][:3] in _TOLL_FREE
    return False
