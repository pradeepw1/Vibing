"""Encrypted storage for the profile.

The file on disk is AES-256-GCM. The key comes from a passphrase through scrypt,
so the passphrase itself is never stored anywhere. The file lives outside any
git repo, in a folder only you can open (0700), and is readable only by you (0600).
"""
from __future__ import annotations

import os
import struct
import unicodedata
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

from .profile import Profile

MAGIC = b"DERASE01"
# magic, scrypt log2(N), r, p, salt, nonce
HEADER = struct.Struct(">8sBBB16s12s")
SCRYPT_LOG2_N, SCRYPT_R, SCRYPT_P = 15, 8, 1
MIN_PASSPHRASE_LEN = 12


class VaultError(Exception):
    """Something is wrong with the profile file. Messages never contain profile data."""


def default_path() -> Path:
    if home := os.environ.get("DATAERASE_HOME"):
        return Path(home) / "profile.enc"
    data_home = os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share"
    return Path(data_home) / "dataerase" / "profile.enc"


def save(profile: Profile, passphrase: str, path: Path | None = None) -> Path:
    path = Path(path) if path else default_path()
    _refuse_inside_repo(path)
    if len(passphrase) < MIN_PASSPHRASE_LEN:
        raise VaultError(f"Passphrase must be at least {MIN_PASSPHRASE_LEN} characters.")

    header = HEADER.pack(
        MAGIC, SCRYPT_LOG2_N, SCRYPT_R, SCRYPT_P, os.urandom(16), os.urandom(12)
    )
    _, log2n, r, p, salt, nonce = HEADER.unpack(header)
    key = _derive_key(passphrase, salt, log2n, r, p)
    # The header is bound in as associated data, so editing it breaks decryption.
    ciphertext = AESGCM(key).encrypt(nonce, profile.to_json().encode(), header)
    _write_private(path, header + ciphertext)
    return path


def load(passphrase: str, path: Path | None = None) -> Profile:
    path = Path(path) if path else default_path()
    _refuse_inside_repo(path)
    if not path.exists():
        raise VaultError(f"No profile found at {path}. Run `dataerase init` first.")
    _check_permissions(path)

    blob = path.read_bytes()
    if len(blob) < HEADER.size + 16:
        raise VaultError(f"{path} is not a valid profile file.")
    magic, log2n, r, p, salt, nonce = HEADER.unpack_from(blob)
    # Cap the scrypt settings so a doctored file can't make us allocate gigabytes.
    if magic != MAGIC or not (14 <= log2n <= 18 and 1 <= r <= 16 and 1 <= p <= 4):
        raise VaultError(f"{path} is not a valid profile file.")

    key = _derive_key(passphrase, salt, log2n, r, p)
    try:
        plaintext = AESGCM(key).decrypt(nonce, blob[HEADER.size :], blob[: HEADER.size])
    except InvalidTag:
        raise VaultError("Wrong passphrase, or the file was changed.") from None
    return Profile.from_json(plaintext.decode())


def _derive_key(passphrase: str, salt: bytes, log2n: int, r: int, p: int) -> bytes:
    # NFKC so the same passphrase typed on another keyboard/OS gives the same key.
    secret = unicodedata.normalize("NFKC", passphrase).encode()
    return Scrypt(salt=salt, length=32, n=2**log2n, r=r, p=p).derive(secret)


def _refuse_inside_repo(path: Path) -> None:
    for parent in path.resolve().parents:
        if (parent / ".git").exists():
            raise VaultError(
                f"{path} is inside a git repo ({parent}). Keep the profile outside "
                "any repo so it can't be committed by accident."
            )


def _check_permissions(path: Path) -> None:
    if os.name == "posix" and path.stat().st_mode & 0o077:
        raise VaultError(f"{path} can be read by other users. Run: chmod 600 {path}")


def _write_private(path: Path, data: bytes) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.unlink(missing_ok=True)
    # Created as 0600 from the start, so there is no moment where it's world-readable.
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)
