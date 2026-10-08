"""Find personal data sitting where it shouldn't be.

Findings say *where* and *which field*, never the value itself, so the report
can't become a leak of its own.

Also runnable on its own as the git pre-commit check:
    python3 -m dataerase.leakcheck
That path needs no passphrase and no third-party packages.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from .patterns import Matcher, allow_key, generic_hits

MAX_FILE_BYTES = 5_000_000
# Exact company/government contact details the commit check should accept.
ALLOW_FILE = ".leakcheck-allow"
COMMIT_MARK = "@@@COMMIT:"
# Files that should never be committed, whatever is inside them.
BLOCKED_NAME = re.compile(
    r"(\.enc$|\.key$|\.pem$|\.har$|^profile\.(json|ya?ml)$|^\.env(\..+)?$)", re.IGNORECASE
)
ALLOWED_NAME = re.compile(r"^\.env\.example$", re.IGNORECASE)


@dataclass(frozen=True)
class Finding:
    where: str
    label: str

    def __str__(self) -> str:
        return f"{self.where}  ->  {self.label}"


class GitError(Exception):
    pass


def scan(root: Path, matchers: list[Matcher], history: bool = True) -> list[Finding]:
    """Look for your exact values in the working files and (optionally) all git history."""
    findings = scan_tree(root, matchers)
    if history and (root / ".git").exists():
        findings += scan_history(root, matchers)
    return findings


def scan_tree(root: Path, matchers: list[Matcher]) -> list[Finding]:
    """Files git could commit (tracked + untracked, minus .gitignore'd ones)."""
    findings: list[Finding] = []
    for path in _candidate_files(root):
        try:
            if path.stat().st_size > MAX_FILE_BYTES:
                continue
            data = path.read_bytes()
        except OSError:
            continue
        if b"\0" in data[:8192]:  # binary
            continue
        rel = path.relative_to(root)
        for lineno, line in enumerate(data.decode("utf-8", "replace").split("\n"), 1):
            for label in _labels_in(line, matchers):
                findings.append(Finding(f"{rel}:{lineno}", label))
    return findings


def scan_history(root: Path, matchers: list[Matcher]) -> list[Finding]:
    """Every line ever added on any branch, plus commit authors and messages."""
    seen: set[Finding] = set()
    findings: list[Finding] = []

    def report(finding: Finding) -> None:
        if finding not in seen:
            seen.add(finding)
            findings.append(finding)

    meta = _git(root, "log", "--all", "--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B%x1e")
    for record in meta.split("\x1e"):
        sha, _, rest = record.strip("\n").partition("\x1f")
        for label in _labels_in(rest, matchers):
            report(Finding(f"commit {sha[:10]} (author/committer/message)", label))

    diff = _git(root, "log", "--all", "-p", "--no-color", f"--format={COMMIT_MARK}%H")
    for commit, path, lineno, text in _added_lines(diff):
        for label in _labels_in(text, matchers):
            report(Finding(f"commit {commit} {path}:{lineno}", label))
    return findings


def scan_staged(root: Path) -> list[Finding]:
    """What's about to be committed, checked with the generic patterns only."""
    findings: list[Finding] = []
    names = _git(root, "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
    for name in filter(None, names.split("\0")):
        base = os.path.basename(name)
        if BLOCKED_NAME.search(base) and not ALLOWED_NAME.match(base):
            findings.append(Finding(name, "file type that should never be committed"))

    allowed = load_allowlist(root)
    diff = _git(root, "diff", "--cached", "-U0", "--no-color", "--diff-filter=ACMR")
    for _, path, lineno, text in _added_lines(diff):
        for label in generic_hits(text, allowed):
            findings.append(Finding(f"{path}:{lineno}", f"looks like a {label}"))
    return findings


def load_allowlist(root: Path) -> frozenset[str]:
    """Values from .leakcheck-allow: one per line, # for comments."""
    path = root / ALLOW_FILE
    if not path.exists():
        return frozenset()
    lines = (line.split("#")[0].strip() for line in path.read_text("utf-8").splitlines())
    return frozenset(allow_key(line) for line in lines if line)


# --- helpers ------------------------------------------------------------------


def _labels_in(text: str, matchers: list[Matcher]) -> list[str]:
    labels: list[str] = []
    for m in matchers:
        if m.label not in labels and m.regex.search(text):
            labels.append(m.label)
    return labels


def _added_lines(diff: str) -> Iterator[tuple[str | None, str | None, int, str]]:
    """Parse git diff output into (commit, file, line number, added text).

    Splits on "\\n" only: str.splitlines() also splits on form feeds and other
    odd characters, which could hide part of a line from the scan.
    """
    commit = path = None
    lineno = 0
    in_header = False
    for line in diff.split("\n"):
        if line.startswith(COMMIT_MARK):
            commit, path, in_header = line[len(COMMIT_MARK) :][:10], None, False
        elif line.startswith("diff --git "):
            path, in_header = None, True
        elif in_header:
            if line.startswith("+++ "):
                target = line[4:]
                path = target[2:] if target.startswith("b/") else target
            elif line.startswith("@@"):
                in_header, lineno = False, _hunk_start(line)
        elif line.startswith("@@"):
            lineno = _hunk_start(line)
        elif line.startswith("+"):
            yield commit, path, lineno, line[1:]
            lineno += 1
        elif line.startswith(" "):
            lineno += 1


def _hunk_start(line: str) -> int:
    m = re.match(r"@@ -\S+ \+(\d+)", line)
    return int(m.group(1)) if m else 0


def _candidate_files(root: Path) -> list[Path]:
    try:
        out = _git(root, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
        return [root / p for p in out.split("\0") if p]
    except GitError:  # not a git repo: just walk the folder
        files = []
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d != ".git"]
            files += [Path(dirpath) / f for f in filenames]
        return files


def _git(root: Path, *args: str) -> str:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), *args], capture_output=True, check=False
        )
    except FileNotFoundError:
        raise GitError("git is not installed") from None
    if result.returncode != 0:
        raise GitError(result.stderr.decode("utf-8", "replace").strip())
    return result.stdout.decode("utf-8", "replace")


def main() -> int:
    """Pre-commit entry point: block the commit if staged changes look like personal data."""
    try:
        findings = scan_staged(Path.cwd())
    except GitError as e:
        print(f"leak check could not run: {e}", file=sys.stderr)
        return 1
    if not findings:
        return 0
    print("Commit blocked. This looks like personal data:", file=sys.stderr)
    for f in findings:
        print(f"  {f}", file=sys.stderr)
    print(
        "\nIf it's fake or a placeholder, put `pii-ok` on that line (or use an @example.com\n"
        "address). If it's real, remove it. Bypassing with --no-verify is how leaks happen.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
