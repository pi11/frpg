"""Account keys: a 100-bit code the player can write down and enter on another device."""

import hashlib
import hmac
import uuid

from app.services.tokens import digest, require_jwt_secret

# Crockford base32: no I, L, O, U, so a handwritten key is hard to misread.
ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
KEY_LENGTH = 20
GROUP = 5
LOOKALIKES = str.maketrans({"O": "0", "I": "1", "L": "1"})


def derive_key(user_id: uuid.UUID, version: int) -> str:
    """Same key for the same account and version; the database keeps only its hash."""
    raw = hmac.new(
        require_jwt_secret().encode(), f"recovery:{user_id}:{version}".encode(), hashlib.sha256
    ).digest()
    number = int.from_bytes(raw)
    chars = []
    for _ in range(KEY_LENGTH):
        number, index = divmod(number, len(ALPHABET))
        chars.append(ALPHABET[index])
    return "".join(chars)


def format_key(key: str) -> str:
    return "-".join(key[start:start + GROUP] for start in range(0, KEY_LENGTH, GROUP))


def normalize_key(text: str) -> str | None:
    """Forgives case, spaces, dashes and look-alike letters; None if it cannot be a key."""
    key = "".join(text.upper().replace("-", " ").split()).translate(LOOKALIKES)
    return key if len(key) == KEY_LENGTH and all(char in ALPHABET for char in key) else None


def key_digest(key: str) -> str:
    return digest(f"recovery:{key}")
