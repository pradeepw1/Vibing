"""Keep personal data out of logs and error output."""
from __future__ import annotations

import logging
import sys
from typing import Iterable

from .patterns import Matcher

REDACTED = "[REDACTED]"


def redact(text: str, matchers: Iterable[Matcher]) -> str:
    for m in matchers:
        text = m.regex.sub(REDACTED, text)
    return text


class RedactingFormatter(logging.Formatter):
    """Masks profile values in the final line, including exception and stack text."""

    def __init__(self, matchers: Iterable[Matcher], fmt: str | None = None) -> None:
        super().__init__(fmt)
        self._matchers = list(matchers)

    def format(self, record: logging.LogRecord) -> str:
        return redact(super().format(record), self._matchers)


def configure_logging(matchers: Iterable[Matcher], level: int = logging.INFO) -> None:
    """Send all logging through the redactor.

    Third-party libraries (HTTP clients, browser automation) log request
    details at DEBUG, so we keep their loggers at WARNING.
    """
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(RedactingFormatter(matchers, "%(levelname)s %(name)s: %(message)s"))
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.WARNING)
    logging.getLogger("dataerase").setLevel(level)
