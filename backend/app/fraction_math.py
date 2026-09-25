"""Exact reading of a student's typed answer. No floats anywhere."""

import re
from dataclasses import dataclass
from fractions import Fraction
from math import gcd

_NUMBER = r"-?\d+(?:\.\d+)?"
# Alternatives are tried in order at the first position that matches: mixed number, fraction, plain number.
_ANSWER = re.compile(
    rf"(?P<whole>-?\d+)\s+(?P<mnum>\d+)\s*/\s*(?P<mden>\d+)"
    rf"|(?P<num>{_NUMBER})\s*/\s*(?P<den>{_NUMBER})"
    rf"|(?P<plain>{_NUMBER})"
)


@dataclass(frozen=True)
class Parsed:
    value: Fraction
    form: str  # "mixed" | "fraction" | "decimal" | "integer"
    simplest: bool


def _clean(text: str) -> str:
    return text.replace("−", "-").replace("⁄", "/").replace("∕", "/")


def parse_answer(text: str | None) -> Parsed | None:
    """Read the first number in the text as an exact value. Returns None if there is none or it divides by 0."""
    if not text:
        return None
    m = _ANSWER.search(_clean(text))
    if not m:
        return None
    if m.group("whole") is not None:
        whole, num, den = int(m.group("whole")), int(m.group("mnum")), int(m.group("mden"))
        if den == 0:
            return None
        part = Fraction(num, den)
        value = whole - part if whole < 0 else whole + part
        return Parsed(value, "mixed", num < den and gcd(num, den) == 1)
    if m.group("num") is not None:
        num_s, den_s = m.group("num"), m.group("den")
        num, den = Fraction(num_s), Fraction(den_s)
        if den == 0:
            return None
        has_decimal = "." in num_s or "." in den_s
        simplest = not has_decimal and gcd(int(num_s), int(den_s)) == 1
        return Parsed(num / den, "fraction", simplest)
    plain = m.group("plain")
    return Parsed(Fraction(plain), "decimal" if "." in plain else "integer", True)


def same_value(a: str | None, b: str | None) -> bool:
    pa, pb = parse_answer(a), parse_answer(b)
    return pa is not None and pb is not None and pa.value == pb.value
