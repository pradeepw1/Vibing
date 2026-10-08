import logging

import pytest

from conftest import ADDRESS, EMAIL, NAME
from dataerase.patterns import build_matchers, generic_hits
from dataerase.profile import Profile
from dataerase.redact import REDACTED, RedactingFormatter, redact


def labels(text, matchers):
    return {m.label for m in matchers if m.regex.search(text)}


@pytest.mark.parametrize(
    "text",
    ["(212) 555-0147", "212-555-0147", "212.555.0147", "+1 212 555 0147", "2125550147", "call 1-212-555-0147 now"],
)
def test_phone_in_any_format(text, matchers):
    assert "phone #1" in labels(text, matchers)


def test_phone_not_inside_longer_number(matchers):
    assert "phone #1" not in labels("order 992125550147123", matchers)


def test_name_ignores_case_and_spacing(matchers):
    assert "full_name" in labels("by JANE   quincy doe, 2024", matchers)
    assert "full_name" not in labels("Jane Quincy Doerr", matchers)


def test_email_and_address(matchers):
    assert "email #1" in labels(f"contact: {EMAIL.upper()}", matchers)
    assert "address #1" in labels("lives at 12 maple street, somewhere", matchers)
    assert "address #1" not in labels("112 Maple Street", matchers)


def test_birth_date_in_common_formats(matchers):
    for text in ("1990-04-12", "04/12/1990", "4/12/1990", "April 12, 1990", "12 April 1990"):
        assert "birth_date" in labels(text, matchers), text
    assert "birth_date" not in labels("1990-04-123", matchers)


def test_short_values_are_skipped_and_reported():
    matchers, skipped = build_matchers(Profile(full_name="Jane Doe", aliases=["JQ"], phones=["12345"]))
    assert skipped == ["alias #1", "phone #1"]
    assert {m.label for m in matchers} == {"full_name"}


def test_redact_replaces_every_form(matchers):
    text = f"user {NAME} <{EMAIL}> phone 212.555.0147 at {ADDRESS}"
    out = redact(text, matchers)
    for secret in ("Jane", "example.com", "0147", "Maple"):
        assert secret not in out
    assert REDACTED in out


def test_logging_formatter_redacts_message_args_and_tracebacks(matchers):
    formatter = RedactingFormatter(matchers, "%(message)s")
    try:
        raise ValueError(f"could not reach {EMAIL}")
    except ValueError:
        import sys

        record = logging.LogRecord("t", logging.ERROR, __file__, 1, "sending for %s", (NAME,), sys.exc_info())
    out = formatter.format(record)
    assert NAME not in out and EMAIL not in out
    assert "sending for [REDACTED]" in out


# --- generic patterns used by the pre-commit hook -------------------------------


@pytest.mark.parametrize(
    "line,expected",
    [
        ("mail me at bob.smith@gmail.com", ["email address"]),  # pii-ok
        ("call (415) 555-2671", ["phone number"]),  # pii-ok
        ("ssn 123-45-6789", ["SSN"]),  # pii-ok
        ("fine: someone@example.com", []),
        ("fine: noreply@anthropic.com", []),
        ("fine: (212) 555-0147", []),
        ("fine: build 2024-10-08, id 1234567890", []),
        ("bob.smith@gmail.com  # pii-ok", []),  # pii-ok
    ],
)
def test_generic_hits(line, expected):
    assert generic_hits(line) == expected
