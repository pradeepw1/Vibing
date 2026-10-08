import subprocess
import sys
from pathlib import Path

from conftest import EMAIL, NAME, git
from dataerase import leakcheck

SRC = str(Path(__file__).resolve().parent.parent / "src")


def commit(repo, message="change", **kw):
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", message, **kw)


def test_finds_value_in_working_file_with_line_number(repo, matchers):
    (repo / "notes.txt").write_text(f"hello\nmy mail is {EMAIL}\n")
    findings = leakcheck.scan_tree(repo, matchers)
    assert [(f.where, f.label) for f in findings] == [("notes.txt:2", "email #1")]


def test_report_never_contains_the_value(repo, matchers):
    (repo / "a.txt").write_text(f"{NAME} {EMAIL} (212) 555-0147\n")
    commit(repo, f"added {NAME}")
    text = "\n".join(str(f) for f in leakcheck.scan(repo, matchers))
    assert text  # something was found...
    for secret in ("Jane", "Doe", "example.com", "0147"):
        assert secret not in text  # ...but none of it is printed


def test_gitignored_files_are_not_scanned(repo, matchers):
    (repo / ".gitignore").write_text("private.txt\n")
    (repo / "private.txt").write_text(EMAIL)
    assert leakcheck.scan_tree(repo, matchers) == []


def test_binary_files_are_skipped(repo, matchers):
    (repo / "blob.bin").write_bytes(b"\0\0" + EMAIL.encode())
    assert leakcheck.scan_tree(repo, matchers) == []


def test_value_removed_later_is_still_found_in_history(repo, matchers):
    (repo / "a.txt").write_text(f"{EMAIL}\n")
    commit(repo, "oops")
    (repo / "a.txt").write_text("cleaned\n")
    commit(repo, "remove it")
    assert leakcheck.scan_tree(repo, matchers) == []  # gone from the files...
    findings = leakcheck.scan_history(repo, matchers)  # ...but not from history
    assert [f.label for f in findings] == ["email #1"]
    assert "a.txt:1" in findings[0].where


def test_history_covers_other_branches(repo, matchers):
    (repo / "a.txt").write_text("ok\n")
    commit(repo)
    git(repo, "checkout", "-q", "-b", "side")
    (repo / "b.txt").write_text(f"{EMAIL}\n")
    commit(repo)
    git(repo, "checkout", "-q", "main")
    assert [f.label for f in leakcheck.scan_history(repo, matchers)] == ["email #1"]


def test_commit_author_and_message_are_checked(repo, matchers):
    (repo / "a.txt").write_text("ok\n")
    commit(repo, "initial", author=(NAME, EMAIL))
    labels = {f.label for f in leakcheck.scan_history(repo, matchers)}
    assert labels == {"full_name", "email #1"}


def test_clean_repo_is_clean(repo, matchers):
    (repo / "a.txt").write_text("nothing personal here\n")
    commit(repo)
    assert leakcheck.scan(repo, matchers) == []


def test_works_outside_a_git_repo(tmp_path, matchers):
    (tmp_path / "x.txt").write_text(EMAIL)
    assert [f.label for f in leakcheck.scan(tmp_path, matchers)] == ["email #1"]


# --- the pre-commit check --------------------------------------------------------


def stage(repo, name, text):
    (repo / name).write_text(text)
    git(repo, "add", name)


def test_staged_flags_real_looking_email_with_location(repo):
    stage(repo, "a.py", "x = 1\nowner = 'bob.smith@gmail.com'\n")  # pii-ok
    findings = leakcheck.scan_staged(repo)
    assert [(f.where, f.label) for f in findings] == [("a.py:2", "looks like a email address")]


def test_staged_line_numbers_after_an_edit(repo):
    stage(repo, "a.py", "1\n2\n3\n")
    commit(repo)
    stage(repo, "a.py", "1\n2\n3\n4\nssn 123-45-6789\n")  # pii-ok
    assert [f.where for f in leakcheck.scan_staged(repo)] == ["a.py:5"]


def test_staged_allows_placeholders(repo):
    stage(repo, "a.py", "mail = 'someone@example.com'\ntel = '(212) 555-0147'\n")
    assert leakcheck.scan_staged(repo) == []


def test_staged_blocks_sensitive_file_names(repo):
    for name in ("profile.enc", ".env", "profile.json", "export.har"):
        stage(repo, name, "x")
    stage(repo, ".env.example", "KEY=")
    assert {f.where for f in leakcheck.scan_staged(repo)} == {"profile.enc", ".env", "profile.json", "export.har"}


def test_allowlist_accepts_only_exact_values(repo):
    (repo / ".leakcheck-allow").write_text("# business lines\nPress@Acme-Data.com  # their press office\n(415) 201-4455\n")  # pii-ok
    stage(repo, "a.txt", "press@acme-data.com\ncall 415.201.4455\n")  # pii-ok
    assert leakcheck.scan_staged(repo) == []
    stage(repo, "b.txt", "bob.smith@gmail.com\n(415) 201-4456\n")  # pii-ok
    assert {f.where for f in leakcheck.scan_staged(repo)} == {"b.txt:1", "b.txt:2"}


def test_allowlist_file_passes_its_own_check(repo):
    (repo / ".leakcheck-allow").write_text("press@acme-data.com\n")  # pii-ok
    git(repo, "add", ".leakcheck-allow")
    assert leakcheck.scan_staged(repo) == []


def test_line_with_form_feed_is_not_hidden(repo):
    stage(repo, "a.txt", "ok\x0cbob.smith@gmail.com\n")  # pii-ok
    assert len(leakcheck.scan_staged(repo)) == 1


def run_hook(repo):
    return subprocess.run(
        [sys.executable, "-m", "dataerase.leakcheck"],
        cwd=repo, env={"PYTHONPATH": SRC, "PATH": "/usr/bin:/bin:/usr/local/bin"},
        capture_output=True, text=True,
    )


def test_hook_exit_codes_and_message(repo):
    stage(repo, "ok.txt", "nothing here\n")
    assert run_hook(repo).returncode == 0

    stage(repo, "bad.txt", "bob.smith@gmail.com\n")  # pii-ok
    result = run_hook(repo)
    assert result.returncode == 1
    assert "bad.txt:1" in result.stderr
    assert "bob.smith" not in result.stderr  # the block message doesn't repeat the data
