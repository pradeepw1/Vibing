import subprocess
from pathlib import Path

import pytest

from dataerase.patterns import build_matchers
from dataerase.profile import Profile

# Made-up person. Every value here is fake.
NAME = "Jane Quincy Doe"
EMAIL = "jane.doe@example.com"
PHONE = "(212) 555-0147"
ADDRESS = "12 Maple Street, Springfield, IL 62704"
BIRTH = "1990-04-12"
PASSPHRASE = "correct horse battery staple"


@pytest.fixture
def profile() -> Profile:
    return Profile(
        full_name=NAME,
        aliases=["Janie Doe", "JQ"],
        emails=[EMAIL],
        phones=[PHONE],
        addresses=[ADDRESS],
        birth_date=BIRTH,
    )


@pytest.fixture
def matchers(profile):
    return build_matchers(profile)[0]


def git(repo: Path, *args: str, author: tuple[str, str] = ("Test Person", "test@example.com")) -> str:
    name, email = author
    result = subprocess.run(
        ["git", "-C", str(repo), "-c", f"user.name={name}", "-c", f"user.email={email}",
         "-c", "commit.gpgsign=false", *args],
        check=True, capture_output=True, text=True,
    )
    return result.stdout


@pytest.fixture
def repo(tmp_path) -> Path:
    path = tmp_path / "repo"
    path.mkdir()
    git(path, "init", "-q", "-b", "main")
    return path
