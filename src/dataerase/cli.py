"""Command line entry point: init, show, leak-check."""
from __future__ import annotations

import argparse
import getpass
import sys
from datetime import date
from pathlib import Path

from . import leakcheck, vault
from .patterns import build_matchers
from .profile import Profile
from .redact import configure_logging

MAX_SHOWN = 200


def main(argv: list[str] | None = None) -> int:
    _disable_core_dumps()
    args = _parser().parse_args(argv)
    try:
        return args.run(args)
    except vault.VaultError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    except (KeyboardInterrupt, EOFError):
        print("\ncancelled", file=sys.stderr)
        return 130
    except Exception as e:
        # Deliberately no message and no traceback: either could contain your details.
        print(f"error: unexpected {type(e).__name__} (details hidden to protect your data)", file=sys.stderr)
        return 1


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="dataerase", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    init = sub.add_parser("init", help="enter your details and store them encrypted")
    init.add_argument("--path", type=Path, help="where to store the profile (default: ~/.local/share/dataerase)")
    init.add_argument("--force", action="store_true", help="overwrite an existing profile")
    init.set_defaults(run=_init)

    show = sub.add_parser("show", help="print your profile with every value masked")
    show.add_argument("--path", type=Path)
    show.set_defaults(run=_show)

    leak = sub.add_parser("leak-check", help="search a repo and its git history for your real details")
    leak.add_argument("repo", nargs="?", type=Path, default=Path("."), help="repo to scan (default: .)")
    leak.add_argument("--path", type=Path, help="profile location")
    leak.add_argument("--no-history", action="store_true", help="only scan current files")
    leak.set_defaults(run=_leak_check)
    return parser


def _init(args: argparse.Namespace) -> int:
    path = args.path or vault.default_path()
    if path.exists() and not args.force:
        raise vault.VaultError(f"{path} already exists. Use --force to replace it.")

    # Passphrase first, so a too-short one doesn't cost you all your typing.
    passphrase = _new_passphrase()
    print("\nType your details as they appear on broker sites. Press Enter on an empty line to move on.\n")
    profile = Profile(
        full_name=input("Full name: ").strip(),
        aliases=_ask_many("Other names you've used (nicknames, maiden name, ...)"),
        emails=_ask_many("Email address"),
        phones=_ask_many("Phone number"),
        addresses=_ask_many("Home address (one line, e.g. 12 Main St, Springfield, IL 62704)"),
        birth_date=_ask_date("Birth date YYYY-MM-DD (optional): "),
    )
    saved = vault.save(profile, passphrase, path)
    print(f"\nSaved, encrypted, to {saved}")
    _print_masked(profile)
    _, skipped = build_matchers(profile)
    if skipped:
        print(f"\nNote: too short to scan for leaks reliably: {', '.join(skipped)}")
    return 0


def _show(args: argparse.Namespace) -> int:
    _print_masked(vault.load(getpass.getpass("Passphrase: "), args.path))
    return 0


def _leak_check(args: argparse.Namespace) -> int:
    profile = vault.load(getpass.getpass("Passphrase: "), args.path)
    matchers, skipped = build_matchers(profile)
    configure_logging(matchers)

    findings = leakcheck.scan(args.repo.resolve(), matchers, history=not args.no_history)
    if skipped:
        print(f"Not scanned (too short): {', '.join(skipped)}")
    if not findings:
        print("Clean: none of your details were found.")
        return 0
    for f in findings[:MAX_SHOWN]:
        print(f"LEAK  {f}")
    if len(findings) > MAX_SHOWN:
        print(f"... and {len(findings) - MAX_SHOWN} more")
    print(f"\n{len(findings)} place(s) contain your details. Values are not shown on purpose.")
    return 1


def _print_masked(profile: Profile) -> None:
    for label, masked in profile.masked():
        print(f"  {label:<14} {masked}")


def _new_passphrase() -> str:
    while True:
        first = getpass.getpass(f"Choose a passphrase (at least {vault.MIN_PASSPHRASE_LEN} characters): ")
        if len(first) < vault.MIN_PASSPHRASE_LEN:
            print("Too short.")
        elif getpass.getpass("Again: ") != first:
            print("Those didn't match.")
        else:
            return first


def _ask_many(prompt: str) -> list[str]:
    values: list[str] = []
    while value := input(f"{prompt}{' (another?)' if values else ''}: ").strip():
        values.append(value)
    return values


def _ask_date(prompt: str) -> str:
    while value := input(prompt).strip():
        try:
            date.fromisoformat(value)
            return value
        except ValueError:
            print("Use the form 1990-04-12.")
    return ""


def _disable_core_dumps() -> None:
    """A crash dump would write our memory (and your details) to disk."""
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    except (ImportError, ValueError, OSError):
        pass  # not available on Windows
