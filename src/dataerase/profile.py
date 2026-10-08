"""The personal details we want brokers to delete.

Nothing here ever prints its values. repr() and str() are hidden on purpose so
a stray print() or a debugger can't spill them.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field, fields
from typing import Iterator


@dataclass(repr=False)
class Profile:
    full_name: str = ""
    aliases: list[str] = field(default_factory=list)
    emails: list[str] = field(default_factory=list)
    phones: list[str] = field(default_factory=list)
    addresses: list[str] = field(default_factory=list)
    birth_date: str = ""  # YYYY-MM-DD

    def __repr__(self) -> str:
        return "Profile(<hidden>)"

    __str__ = __repr__

    def entries(self) -> Iterator[tuple[str, str, str]]:
        """Yield (label, kind, value) for every filled-in field.

        The label is safe to print (it never contains the value).
        """
        if self.full_name.strip():
            yield "full_name", "name", self.full_name
        for kind, label, values in (
            ("name", "alias", self.aliases),
            ("email", "email", self.emails),
            ("phone", "phone", self.phones),
            ("address", "address", self.addresses),
        ):
            for i, value in enumerate(v for v in values if v.strip()):
                yield f"{label} #{i + 1}", kind, value
        if self.birth_date.strip():
            yield "birth_date", "date", self.birth_date

    def masked(self) -> list[tuple[str, str]]:
        """(label, masked value) pairs that are safe to show on screen."""
        return [(label, mask(kind, value)) for label, kind, value in self.entries()]

    def to_json(self) -> str:
        return json.dumps(asdict(self))

    @classmethod
    def from_json(cls, text: str) -> "Profile":
        raw = json.loads(text)
        if not isinstance(raw, dict):
            raise ValueError("profile data is not an object")
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in raw.items() if k in known})


def mask(kind: str, value: str) -> str:
    value = value.strip()
    if kind == "email":
        local, _, domain = value.partition("@")
        return f"{local[:1]}***@{domain[:1]}***"
    if kind == "phone":
        digits = "".join(c for c in value if c.isdigit())
        return "*" * max(len(digits) - 2, 0) + digits[-2:]
    if kind == "date":
        return "****-**-**"
    return " ".join(word[:1] + "***" for word in value.split())
