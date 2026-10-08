import os
import stat

import pytest

from conftest import EMAIL, NAME, PASSPHRASE
from dataerase import vault
from dataerase.profile import Profile


def test_round_trip(tmp_path, profile):
    path = vault.save(profile, PASSPHRASE, tmp_path / "vault" / "profile.enc")
    assert vault.load(PASSPHRASE, path) == profile


def test_file_on_disk_is_not_readable_text(tmp_path, profile):
    path = vault.save(profile, PASSPHRASE, tmp_path / "profile.enc")
    blob = path.read_bytes()
    for secret in (NAME, EMAIL, "Maple", "212"):
        assert secret.encode() not in blob


@pytest.mark.skipif(os.name != "posix", reason="unix permissions")
def test_file_and_folder_are_private(tmp_path, profile):
    path = vault.save(profile, PASSPHRASE, tmp_path / "vault" / "profile.enc")
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert stat.S_IMODE(path.parent.stat().st_mode) == 0o700
    assert not list(path.parent.glob("*.tmp"))


def test_wrong_passphrase(tmp_path, profile):
    path = vault.save(profile, PASSPHRASE, tmp_path / "profile.enc")
    with pytest.raises(vault.VaultError, match="Wrong passphrase"):
        vault.load("not the right passphrase", path)


def test_tampering_is_detected(tmp_path, profile):
    path = vault.save(profile, PASSPHRASE, tmp_path / "profile.enc")
    blob = bytearray(path.read_bytes())
    blob[-1] ^= 1  # flip a bit in the ciphertext
    path.write_bytes(bytes(blob))
    with pytest.raises(vault.VaultError):
        vault.load(PASSPHRASE, path)


def test_header_tampering_is_detected(tmp_path, profile):
    path = vault.save(profile, PASSPHRASE, tmp_path / "profile.enc")
    blob = bytearray(path.read_bytes())
    blob[vault.HEADER.size - 1] ^= 1  # last byte of the nonce
    path.write_bytes(bytes(blob))
    with pytest.raises(vault.VaultError):
        vault.load(PASSPHRASE, path)


def test_two_saves_use_different_salts(tmp_path, profile):
    a = vault.save(profile, PASSPHRASE, tmp_path / "a.enc").read_bytes()
    b = vault.save(profile, PASSPHRASE, tmp_path / "b.enc").read_bytes()
    assert a != b


def test_short_passphrase_rejected(tmp_path, profile):
    with pytest.raises(vault.VaultError, match="at least"):
        vault.save(profile, "short", tmp_path / "profile.enc")
    assert not (tmp_path / "profile.enc").exists()


def test_refuses_to_store_inside_a_git_repo(tmp_path, profile):
    (tmp_path / "project" / ".git").mkdir(parents=True)
    with pytest.raises(vault.VaultError, match="inside a git repo"):
        vault.save(profile, PASSPHRASE, tmp_path / "project" / "sub" / "profile.enc")


@pytest.mark.skipif(os.name != "posix", reason="unix permissions")
def test_refuses_file_others_can_read(tmp_path, profile):
    path = vault.save(profile, PASSPHRASE, tmp_path / "profile.enc")
    path.chmod(0o644)
    with pytest.raises(vault.VaultError, match="chmod 600"):
        vault.load(PASSPHRASE, path)


def test_missing_file_message_has_no_data(tmp_path):
    with pytest.raises(vault.VaultError, match="dataerase init"):
        vault.load(PASSPHRASE, tmp_path / "nope.enc")


def test_garbage_file(tmp_path):
    path = tmp_path / "profile.enc"
    path.write_bytes(b"x" * 100)
    path.chmod(0o600)
    with pytest.raises(vault.VaultError, match="not a valid"):
        vault.load(PASSPHRASE, path)


def test_default_path_follows_env(monkeypatch, tmp_path):
    monkeypatch.setenv("DATAERASE_HOME", str(tmp_path))
    assert vault.default_path() == tmp_path / "profile.enc"


def test_profile_never_prints_its_values(profile):
    for text in (repr(profile), str(profile), f"{profile}", f"{profile!r}"):
        assert NAME not in text and EMAIL not in text


def test_masked_output_hides_values(profile):
    shown = " ".join(f"{label} {value}" for label, value in profile.masked())
    for secret in (NAME, "Jane", "Doe", EMAIL, "example", "0147", "Maple", "62704", "1990"):
        assert secret not in shown
    assert Profile.from_json(profile.to_json()) == profile
