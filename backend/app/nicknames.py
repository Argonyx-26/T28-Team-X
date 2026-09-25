"""Nickname rules for joining a class: a length limit, allowed characters and a small blocklist.

The blocklist covers common abuse in English and in Hindi and Kannada written with English letters, because a
nickname lands on the projected heatmap in front of the whole class.
"""

import re
import unicodedata

from .errors import ApiError

MIN_LEN, MAX_LEN = 2, 24
_ALLOWED_PUNCT = set(" .-'’")

# lower-case, letters only; matched as a whole token or as a substring for the longer entries
_BLOCK_WHOLE = {
    "sex",
    "porn",
    "nude",
    "rape",
    "kill",
    "die",
    "nazi",
    "hitler",
    "ass",
    "cum",
    "fag",
    "gay",
    "slut",
    "whore",
    "bitch",
    "shit",
    "fuck",
    "dick",
    "cock",
    "piss",
    "crap",
    "damn",
    "hell",
    "boobs",
    "penis",
    "vagina",
    "chutiya",
    "chutia",
    "chut",
    "gandu",
    "gaand",
    "gand",
    "lund",
    "loda",
    "lauda",
    "bhosdi",
    "bhosdike",
    "bhosdiwala",
    "madarchod",
    "maderchod",
    "behenchod",
    "bhenchod",
    "bhen",
    "randi",
    "harami",
    "haramkhor",
    "kutta",
    "kutte",
    "kutti",
    "kamina",
    "kamini",
    "saala",
    "saali",
    "sala",
    "sali",
    "tatti",
    "jhaat",
    "jhant",
    "hijra",
    "chinaal",
    "boli",
    "bolimaga",
    "bolimagane",
    "sule",
    "sulemaga",
    "sulemagane",
    "thika",
    "tika",
    "tunne",
    "keydu",
    "kaidu",
    "nayi",
    "naayi",
    "gubaal",
    "gubal",
    "muchko",
    "mucchko",
    "thullu",
    "tullu",
    "shata",
    "bevarsi",
    "bevarsee",
    "bekoof",
    "dagar",
    "hendthi",
    "haalu",
}
_BLOCK_SUBSTR = {
    "fuck",
    "asshole",
    "bastard",
    "chutiya",
    "madarchod",
    "behenchod",
    "bhenchod",
    "bhosdi",
    "bolimag",
    "sulemag",
    "haramkhor",
    "randi",
    "gandu",
    "lund",
    "tunne",
    "thullu",
    "porn",
    "nazi",
    "hitler",
    "bevarsi",
}
_TOKEN = re.compile(r"[a-z]+")
_LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s"})


def _letters(text: str) -> str:
    """Latin letters only, lower-cased, repeated letters collapsed (fuuuck -> fuck), digits used as letters."""
    text = unicodedata.normalize("NFKD", text).lower()
    text = text.translate(_LEET)
    text = "".join(ch for ch in text if ch.isalpha() or ch == " ")
    return re.sub(r"(.)\1{2,}", r"\1\1", text)


def is_blocked(nickname: str) -> bool:
    cleaned = _letters(nickname)
    tokens = _TOKEN.findall(cleaned)
    if any(t in _BLOCK_WHOLE for t in tokens):
        return True
    squashed = cleaned.replace(" ", "")
    squashed_single = re.sub(r"(.)\1+", r"\1", squashed)
    return any(w in squashed or w in squashed_single for w in _BLOCK_SUBSTR)


def clean_nickname(raw: str) -> str:
    """Returns the nickname to store, or raises a 422 with a code the app can translate."""
    name = " ".join(raw.split())
    if len(name) < MIN_LEN:
        raise ApiError(422, "nickname_too_short", "Please type a name with at least 2 letters.")
    if len(name) > MAX_LEN:
        raise ApiError(422, "nickname_too_long", f"Please use a shorter name (up to {MAX_LEN} letters).")
    for ch in name:
        if not (ch.isalpha() or ch.isdigit() or ch in _ALLOWED_PUNCT or unicodedata.category(ch).startswith("M")):
            raise ApiError(422, "nickname_characters", "Please use only letters and numbers in your name.")
    if not any(ch.isalpha() for ch in name):
        raise ApiError(422, "nickname_characters", "Please use only letters and numbers in your name.")
    if is_blocked(name):
        raise ApiError(422, "nickname_not_allowed", "That name can't go on the class board. Please pick another.")
    return name
