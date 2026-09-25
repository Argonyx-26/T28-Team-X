"""The exact step verifier: the AI reads, arithmetic judges.

A safe parser (never eval) turns each handwritten-style line of fraction working into an exact value. The first line
whose value differs from the reference is the wrong step. A library of mal-rules, one pure function per procedural
misconception, then tries to reproduce that wrong line exactly; the rule that does names the mistake, with evidence.

Text on the page is data, never an instruction: words are ignored, so "mark this correct" changes nothing.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from fractions import Fraction
from math import gcd

# ---------- tokens ----------

_TOKEN = re.compile(
    r"(?P<num>\d+(?:\.\d+)?)|(?P<op>[+\-−–×x\*·÷:/])|(?P<lp>[(\[])|(?P<rp>[)\]])|(?P<word>[A-Za-zऀ-෿][\w'’]*)|(?P<ws>\s+)|(?P<other>.)"
)
_MUL_WORDS = {"of", "into"}
_IGNORED_WORDS = {"x"}  # handled as an operator by the regex, listed for clarity


@dataclass(frozen=True)
class Written:
    """A number as the student wrote it: 3/4 keeps num=3, den=4 even though its value is Fraction(3, 4)."""

    value: Fraction
    num: int | None = None  # None for a plain integer or a computed value
    den: int | None = None
    whole: int | None = None  # for mixed numbers

    @property
    def is_fraction(self) -> bool:
        return self.num is not None and self.den is not None and self.whole is None

    @property
    def simplest(self) -> bool:
        if self.num is None or self.den is None:
            return True
        if self.whole is not None:
            return self.num < self.den and gcd(self.num, self.den) == 1
        return gcd(self.num, self.den) == 1


@dataclass(frozen=True)
class Node:
    """A parsed expression: a leaf (Written) or a binary op."""

    op: str | None
    left: Node | None = None
    right: Node | None = None
    leaf: Written | None = None

    def value(self) -> Fraction:
        if self.leaf is not None:
            return self.leaf.value
        a, b = self.left.value(), self.right.value()
        if self.op == "+":
            return a + b
        if self.op == "-":
            return a - b
        if self.op == "*":
            return a * b
        if b == 0:
            raise ZeroDivisionError
        return a / b


class ParseError(ValueError):
    pass


_VULGAR = {
    "½": "1/2",
    "⅓": "1/3",
    "⅔": "2/3",
    "¼": "1/4",
    "¾": "3/4",
    "⅕": "1/5",
    "⅖": "2/5",
    "⅗": "3/5",
    "⅘": "4/5",
    "⅙": "1/6",
    "⅚": "5/6",
    "⅐": "1/7",
    "⅛": "1/8",
    "⅜": "3/8",
    "⅝": "5/8",
    "⅞": "7/8",
    "⅑": "1/9",
    "⅒": "1/10",
}
_SCRIPT_DIGITS = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉", "01234567890123456789")


def normalize(text: str) -> str:
    """Handwriting as a transcription may carry it: '1½' is 1 1/2, '¾' is 3/4, '3⁄4' and '³/₄' are 3/4."""
    for ch, frac in _VULGAR.items():
        if ch in text:
            text = text.replace(ch, f" {frac}")
    return text.replace("⁄", "/").replace("∕", "/").translate(_SCRIPT_DIGITS)


def _tokens(text: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for m in _TOKEN.finditer(text):
        kind = m.lastgroup
        tok = m.group()
        if kind == "ws":
            continue
        if kind == "word":
            low = tok.lower()
            if low in _MUL_WORDS:
                out.append(("op", "*"))
            elif low == "x":
                out.append(("op", "*"))
            else:
                out.append(("word", tok))
            continue
        if kind == "op":
            out.append(("op", {"−": "-", "–": "-", "×": "*", "x": "*", "·": "*", "÷": "div", ":": "div"}.get(tok, tok)))
            continue
        if kind == "other":
            out.append(("other", tok))
            continue
        out.append((kind, tok))
    return out


def _strip_words(tokens: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Leading and trailing words and units are ignored; a word between numbers means this isn't an expression."""
    while tokens and (tokens[0][0] in ("word", "other") or tokens[0] in (("op", "/"), ("op", "div"))):
        tokens = tokens[1:]  # "Ans: 4/8": the colon after a word is punctuation, not division
    while tokens and tokens[-1][0] in ("word", "other"):
        tokens = tokens[:-1]
    if any(k in ("word", "other") for k, _ in tokens):
        raise ParseError("words inside the expression")
    return tokens


class _Parser:
    def __init__(self, tokens: list[tuple[str, str]]):
        self.t = tokens
        self.i = 0

    def peek(self, kind: str | None = None, tok: str | None = None) -> bool:
        if self.i >= len(self.t):
            return False
        k, v = self.t[self.i]
        return (kind is None or k == kind) and (tok is None or v == tok)

    def take(self) -> tuple[str, str]:
        tok = self.t[self.i]
        self.i += 1
        return tok

    def parse(self) -> Node:
        node = self.additive()
        if self.i != len(self.t):
            raise ParseError("trailing tokens")
        return node

    def additive(self) -> Node:
        node = self.multiplicative()
        while self.peek("op", "+") or self.peek("op", "-"):
            op = self.take()[1]
            node = Node(op, node, self.multiplicative())
        return node

    def multiplicative(self) -> Node:
        node = self.unary()
        while self.peek("op", "*") or self.peek("op", "/") or self.peek("op", "div"):
            op = self.take()[1]
            node = Node("/" if op == "div" else op, node, self.unary())
        return node

    def unary(self) -> Node:
        if self.peek("op", "-"):
            self.take()
            inner = self.unary()
            return Node("-", Node(None, leaf=Written(Fraction(0))), inner)
        return self.primary()

    def primary(self) -> Node:
        if self.peek("lp"):
            self.take()
            node = self.additive()
            if not self.peek("rp"):
                raise ParseError("missing )")
            self.take()
            return node
        if self.peek("num"):
            return Node(None, leaf=self.number())
        raise ParseError("expected a number")

    def number(self) -> Written:
        """An integer, a decimal, a fraction a/b, or a mixed number w a/b. The fraction bar binds tighter than any
        operator."""
        raw = self.take()[1]
        if "." in raw:
            value = Fraction(raw)
            if self.peek("op", "/") and self.i + 1 < len(self.t) and self.t[self.i + 1][0] == "num":
                self.take()
                den = Fraction(self.take()[1])
                if den == 0:
                    raise ParseError("division by zero")
                return Written(value / den)
            return Written(value)
        first = int(raw)
        # fraction a/b (integer over integer, written directly)
        if self.peek("op", "/") and self.i + 1 < len(self.t) and self.t[self.i + 1][0] == "num":
            self.take()
            den = int(self.take()[1])
            if den == 0:
                raise ParseError("division by zero")
            return Written(Fraction(first, den), first, den)
        # mixed number: w a/b
        if (
            self.peek("num")
            and self.i + 2 < len(self.t)
            and self.t[self.i + 1] == ("op", "/")
            and self.t[self.i + 2][0] == "num"
        ):
            num = int(self.take()[1])
            self.take()
            den = int(self.take()[1])
            if den == 0:
                raise ParseError("division by zero")
            return Written(first + Fraction(num, den), num, den, whole=first)
        return Written(Fraction(first))


_SPACED_SLASH = re.compile(
    r"^\s*([^/()\[\]]*[+\-−–][^/()\[\]]*)\s+/\s+([^/()\[\]]+)\s*$|^\s*([^/()\[\]]+)\s+/\s+([^/()\[\]]*[+\-−–][^/()\[\]]*)\s*$"
)


def _spaced_fraction(text: str) -> str:
    """A student writes '3+1 / 4+4' with the sums over and under one long fraction bar; a transcription keeps the
    spaces round the bar and drops the brackets. Read it as (3+1)/(4+4)."""
    if text.count("/") != 1 or len(text) > MAX_LINE:
        return text
    m = _SPACED_SLASH.match(text)
    if not m:
        return text
    left, right = (m.group(1), m.group(2)) if m.group(1) is not None else (m.group(3), m.group(4))
    tight = re.compile(r"\S[+\-−–]\S")
    if not (tight.search(left) or tight.search(right)):
        return text  # "2 + 3 / 4" is 2 + 3/4; "3+1 / 4+4" (tight sums, a spaced bar) is one long bar
    return f"({left.strip()}) / ({right.strip()})"


# a problem number at the start of a line: "Q1)", "Q.2", "Qn 3:", "1)", "2.", "(a)", "(iii)", "Ex 4)"
_ENUMERATOR = re.compile(
    r"^\s*(?:"
    r"(?:q|qn|ques|question|ex|exercise|sum|no)\.?\s*\d{1,3}[a-z]?\s*(?:[).:\]-]\s*|\s+)"
    r"|\d{1,3}[a-z]?\s*(?:[)\]]|\.(?!\d))\s*"
    r"|(?:i{1,3}|iv|vi{0,3}|ix|x)\s*[).]\s*"
    r"|[a-h]\s*[):\]]\s*"
    r"|\(\s*(?:\d{1,3}|[a-h]|[ivx]{1,4})\s*\)\s*"
    r")",
    re.IGNORECASE,
)


def strip_enumerator(text: str) -> str:
    """ "Q1) 2/3 + 4/7" -> "2/3 + 4/7". Only a numbering prefix is removed; the maths is untouched."""
    return _ENUMERATOR.sub("", text, count=1)


MAX_LINE = 200  # a line of working is short; longer text is never parsed (it can't be working, and it costs time)


def _parse(text: str) -> Node | None:
    if len(text) > MAX_LINE:
        return None
    try:
        tokens = _strip_words(_tokens(_spaced_fraction(text)))
        if not tokens:
            return None
        return _Parser(tokens).parse()
    except (ParseError, IndexError, ZeroDivisionError, ValueError, RecursionError):
        return None


_BLANK = re.compile(r"\?|_{2,}|□|☐")


def parse_expression(text: str) -> Node | None:
    """One side of an '=' as an exact expression tree, or None when it isn't one (words, empty, unbalanced).

    A blank to fill in ("?/6", "__/24", "□") is not a value: "2/3 = ?/6" states the problem, it doesn't claim 6.

    A problem number in front ("Q1)", "Q.2", "2.", "(a)") is read first as a number and dropped; if what is left
    doesn't parse, the line is read as written, so "(3) + 4" keeps its bracket but "(1) 3/4 + 1/4" loses its number."""
    text = normalize(text)
    if _BLANK.search(text):
        return None
    stripped = strip_enumerator(text)
    if stripped != text:
        node = _parse(stripped)
        if node is not None:
            return node
    return _parse(text)


def parse_value(text: str) -> Fraction | None:
    node = parse_expression(text)
    if node is None:
        return None
    try:
        return node.value()
    except ZeroDivisionError:
        return None


_WORD = re.compile(r"[A-Za-zऀ-෿]{2,}")
_ZERO_DEN = re.compile(r"\d\s*/\s*0(?![\d.])")


@dataclass
class Segment:
    text: str
    node: Node | None
    value: Fraction | None
    zero: bool = False  # a written a/0: never a value, always wrong

    @property
    def words(self) -> bool:
        return bool(_WORD.search(strip_enumerator(self.text)))


def split_chain(line: str) -> list[Segment]:
    """'3/4 + 1/4 = (3+1)/(4+4) = 4/8' → three segments; a leading '=' gives an empty first segment that is dropped."""
    out: list[Segment] = []
    line = normalize(line)
    if len(line) > 3 * MAX_LINE:
        return out
    for part in re.split(r"\s*(?:=>|⇒|→|=)\s*", line.replace("＝", "=")):
        if not part.strip():
            continue
        node = parse_expression(part)
        value = None
        if node is not None:
            try:
                value = node.value()
            except ZeroDivisionError:
                value = None
        out.append(Segment(part.strip(), node, value, zero=bool(_ZERO_DEN.search(part)) and value is None))
    return out


# ---------- the problem's structure, for the mal-rules ----------


@dataclass(frozen=True)
class Problem:
    op: str | None  # "+", "-", "*", "/" or None for a single number
    a: Written
    b: Written | None
    reference: Fraction
    word_problem: bool = False
    target_den: int | None = None  # for "3/8 = ?/24"


def _leaf(node: Node | None) -> Written | None:
    return node.leaf if node is not None and node.leaf is not None else None


def problem_from_node(node: Node, reference: Fraction, word_problem: bool = False) -> Problem | None:
    if node.leaf is not None:
        return Problem(None, node.leaf, None, reference, word_problem)
    a, b = _leaf(node.left), _leaf(node.right)
    if a is None or b is None:
        return None
    return Problem(node.op, a, b, reference, word_problem)


_BANK_F = re.compile(r"F\((\d+),(\d+)\)")
_BANK_INT = re.compile(r"F\((\d+)\)")


def problem_from_bank_expr(expr: str, word_problem: bool = False) -> Problem | None:
    """The bank writes problems as F(3,4)+F(1,4), F(3,5)*10 or max(F(1,4),F(1,6)). Comparisons have no arithmetic."""
    if expr.startswith(("max(", "min(")):
        return None
    # each F(a,b) is a bracketed fraction, so "/" between two of them is division, never a fraction bar
    text = _BANK_F.sub(lambda m: f"({m.group(1)}/{m.group(2)})", expr)
    text = _BANK_INT.sub(lambda m: m.group(1), text)
    node = parse_expression(text)
    if node is None:
        return None
    try:
        return problem_from_node(node, node.value(), word_problem)
    except ZeroDivisionError:
        return None


# ---------- mal-rules: one pure function per procedural misconception ----------
# Each rule returns the fractions its wrong procedure writes, as (numerator, denominator) exactly as written, so a
# wrong line is named only when the rule reproduces what the child wrote, not merely its value.

Pair = tuple[int, int]
MalRule = Callable[[Problem], set[Fraction]]


def _nd(w: Written) -> tuple[int, int]:
    """Numerator and denominator as written (an integer is n/1; a mixed number is converted)."""
    if w.num is not None and w.den is not None and w.whole is None:
        return w.num, w.den
    return w.value.numerator, w.value.denominator


def _pairs_add_denominators(p: Problem) -> list[Pair]:
    """3/4 + 1/4 = (3+1)/(4+4) = 4/8: adds (or subtracts) the denominators too."""
    if p.op not in ("+", "-") or p.b is None:
        return []
    (na, da), (nb, db) = _nd(p.a), _nd(p.b)
    if p.op == "+":
        return [(na + nb, da + db)]
    return [(na - nb, da + db), (na - nb, da - db)]


def _pairs_unlike_denominators(p: Problem) -> list[Pair]:
    """2/3 + 1/6 = 3/6: adds the numerators without making the denominators the same (keeps either denominator)."""
    if p.op not in ("+", "-") or p.b is None:
        return []
    (na, da), (nb, db) = _nd(p.a), _nd(p.b)
    if da == db:
        return []
    n = na + nb if p.op == "+" else na - nb
    return [(n, da), (n, db)]


def _pairs_multiply_cross(p: Problem) -> list[Pair]:
    """2/3 × 3/4 = 8/9: multiplies across the diagonal."""
    if p.op != "*" or p.b is None:
        return []
    (na, da), (nb, db) = _nd(p.a), _nd(p.b)
    return [(na * db, da * nb)]


def _pairs_whole_times_both(p: Problem) -> list[Pair]:
    """3 × 2/5 = 6/15: multiplies both the top and the bottom by the whole number."""
    if p.op != "*" or p.b is None:
        return []
    out: list[Pair] = []
    for whole, frac in ((p.a, p.b), (p.b, p.a)):
        if whole.value.denominator == 1 and whole.num is None and frac.is_fraction:
            k = whole.value.numerator
            n, d = _nd(frac)
            out.append((k * n, k * d))
    return out


def _pairs_divide_no_flip(p: Problem) -> list[Pair]:
    """3/5 ÷ 3/10 = 9/50: multiplies straight across without flipping the second fraction."""
    if p.op != "/" or p.b is None:
        return []
    (na, da), (nb, db) = _nd(p.a), _nd(p.b)
    return [(na * nb, da * db)]


def _pairs_divide_flip_first(p: Problem) -> list[Pair]:
    """3/5 ÷ 3/10 = 5/3 × 3/10 = 15/30: flips the first fraction instead of the second."""
    if p.op != "/" or p.b is None:
        return []
    (na, da), (nb, db) = _nd(p.a), _nd(p.b)
    return [(da * nb, na * db)]


def _pairs_word_problem_operation(p: Problem) -> list[Pair]:
    """A story that needs 2 × 3/4 answered with 2 + 3/4: the wrong operation, done correctly (value-based)."""
    if not p.word_problem or p.op is None or p.b is None:
        return []
    a, b = p.a.value, p.b.value
    others = {"+": a + b, "-": a - b, "*": a * b, "/": a / b if b else None}
    others.pop(p.op, None)
    return [(v.numerator, v.denominator) for v in others.values() if v is not None]


def _pairs_equivalence_additive(p: Problem) -> list[Pair]:
    """2/3 = 3/4, or 3/8 = ?/24 answered 19/24: adds the same number to the top and the bottom."""
    if p.op is not None or not p.a.is_fraction:
        return []
    n, d = _nd(p.a)
    out: list[Pair] = []
    if p.target_den:
        k = p.target_den - d
        out.append((n + k, p.target_den))
    for k in range(1, 25):
        out.append((n + k, d + k))
        if d - k > 0 and n - k > 0:
            out.append((n - k, d - k))
    return out


def _pairs_simplify_one_part(p: Problem) -> list[Pair]:
    """6/8 = 3/8 or 8/20 = 2/20: divides (or multiplies) only the top or only the bottom."""
    if p.op is not None or not p.a.is_fraction:
        return []
    n, d = _nd(p.a)
    out: list[Pair] = []
    for k in range(2, 13):
        if n % k == 0:
            out.append((n // k, d))
        if d % k == 0:
            out.append((n, d // k))
        out += [(n * k, d), (n, d * k)]
    return out


def _pairs_careless_arithmetic(p: Problem) -> list[Pair]:
    """The right method with one slip (value-based): the numerator of the correctly built fraction off by one
    (3/4 + 1/4 = 5/4), or the answer off by one in its own denominator. A lone fraction to simplify has no
    calculation to slip on, so a wrong simplification is never called a slip."""
    if p.op is None:
        return []
    r = p.reference
    out = [r + Fraction(1, r.denominator), r - Fraction(1, r.denominator)]
    if p.b is not None and p.op is not None:
        (na, da), (nb, db) = _nd(p.a), _nd(p.b)
        if p.op in ("+", "-"):
            common = da * db // gcd(da, db)
            n = na * (common // da) + (nb * (common // db) if p.op == "+" else -nb * (common // db))
            out += [Fraction(n + 1, common), Fraction(n - 1, common)]
        elif p.op == "*" and da * db:
            out += [Fraction(na * nb + 1, da * db), Fraction(na * nb - 1, da * db)]
        elif da * nb:
            out += [Fraction(na * db + 1, da * nb), Fraction(na * db - 1, da * nb)]
    return [(v.numerator, v.denominator) for v in out if v != r]


MAL_PAIRS: dict[str, Callable[[Problem], list[Pair]]] = {
    "add_denominators": _pairs_add_denominators,
    "unlike_denominators": _pairs_unlike_denominators,
    "multiply_cross": _pairs_multiply_cross,
    "whole_times_both": _pairs_whole_times_both,
    "divide_no_flip": _pairs_divide_no_flip,
    "divide_flip_first": _pairs_divide_flip_first,
    "word_problem_operation": _pairs_word_problem_operation,
    "equivalence_additive": _pairs_equivalence_additive,
    "simplify_one_part": _pairs_simplify_one_part,
    "careless_arithmetic": _pairs_careless_arithmetic,
}
# rules whose evidence is a value, not a written form: a match by value counts as reproduced
_VALUE_RULES = {"word_problem_operation", "careless_arithmetic"}


def _values(rule: Callable[[Problem], list[Pair]]) -> MalRule:
    return lambda p: {Fraction(n, d) for n, d in rule(p) if d}


MAL_RULES: dict[str, MalRule] = {tag: _values(rule) for tag, rule in MAL_PAIRS.items()}

RULE_WORDS = {
    "add_denominators": "adding the denominators too",
    "unlike_denominators": "adding the numerators without a common denominator",
    "multiply_cross": "multiplying across the diagonal",
    "whole_times_both": "multiplying both the top and the bottom by the whole number",
    "divide_no_flip": "multiplying straight across without flipping the second fraction",
    "divide_flip_first": "flipping the first fraction instead of the second",
    "word_problem_operation": "using the wrong operation for the story",
    "equivalence_additive": "adding the same number to the top and the bottom",
    "simplify_one_part": "changing only the top or only the bottom",
    "careless_arithmetic": "the right method with one calculation slip",
}


# rules with one answer: a child who follows them and then simplifies ("4/8 = 1/2") still shows the same mistake
_ONE_ANSWER_RULES = {
    "add_denominators",
    "unlike_denominators",
    "multiply_cross",
    "whole_times_both",
    "divide_no_flip",
    "divide_flip_first",
}


def _written_matches(pair: Pair, written: Pair, tag: str) -> bool:
    """The rule's fraction is what the child wrote, or (for a one-answer rule) its lowest terms when the child wrote
    lowest terms. Rules that try many numbers (simplify, equivalence) must match exactly, or anything would match."""
    n, d = pair
    if not d:
        return False
    if (n, d) == written:
        return True
    wn, wd = written
    return tag in _ONE_ANSWER_RULES and gcd(wn, wd) == 1 and Fraction(n, d) == Fraction(wn, wd)


def reproduce_written(
    problem: Problem, wrong_value: Fraction, written: list[Pair], only: set[str] | None = None
) -> tuple[str | None, bool]:
    """The first mal-rule that reproduces the wrong line. Returns (tag, exact): exact when the rule writes the same
    fraction the child wrote; a match on value alone names the rule but isn't proof."""
    tags = [t for t in MAL_PAIRS if only is None or t in only]
    for tag in tags:
        pairs = MAL_PAIRS[tag](problem)
        if tag in _VALUE_RULES:
            if any(d and Fraction(n, d) == wrong_value for n, d in pairs):
                return tag, True
        elif written and any(_written_matches(pr, w, tag) for pr in pairs for w in written):
            return tag, True
    if written:
        return None, False  # the child wrote a fraction no rule writes: no name
    for tag in tags:
        if any(d and Fraction(n, d) == wrong_value for n, d in MAL_PAIRS[tag](problem)):
            return tag, False
    return None, False


def reproduce(problem: Problem, wrong_value: Fraction) -> str | None:
    """The first mal-rule whose procedure gives `wrong_value` (by value); careless_arithmetic is tried last."""
    for tag, rule in MAL_RULES.items():
        if wrong_value in rule(problem):
            return tag
    return None


# ---------- the verdict ----------


def _f(x: Fraction | None) -> str | None:
    if x is None:
        return None
    return str(x.numerator) if x.denominator == 1 else f"{x.numerator}/{x.denominator}"


@dataclass
class LineCheck:
    text: str
    value: str | None  # the exact value of the line's last parsable segment, as a/b
    values: list[str | None] = field(default_factory=list)  # one per '=' segment
    ok: bool | None = None  # None: no arithmetic on this line


@dataclass
class Verdict:
    status: str  # "verified" (arithmetic decided) | "checked" (the model decides) | "unanswered" | "unverified"
    correct: bool | None
    error_step: int | None
    tag: str | None
    reproduced_by: str | None
    evidence: str
    reference: str | None
    final: str | None
    lines: list[LineCheck]
    problem_line: int = 0  # 0-based index of the line that states the problem

    def as_dict(self) -> dict:
        return {
            "status": self.status,
            "correct": self.correct,
            "error_step": self.error_step,
            "tag": self.tag,
            "reproduced_by": self.reproduced_by,
            "evidence": self.evidence,
            "reference": self.reference,
            "final": self.final,
            "problem_line": self.problem_line,
            "lines": [{"text": x.text, "value": x.value, "values": x.values, "ok": x.ok} for x in self.lines],
        }


def _is_problem(node: Node) -> bool:
    """A problem has an operator or a fraction bar; a bare integer ("Roll 7", "Q1", a page number) is a header."""
    if node.leaf is None:
        return True
    return node.leaf.num is not None


_HAS_MATHS = re.compile(r"[\d+\-−–×x*·÷:/=()]")


def is_header(line: str) -> bool:
    """A name, a roll number, a question number or a date at the top of the page: not a line of working."""
    text = line.strip()
    if not text:
        return True
    if not re.search(r"\d", text) and len(text.split()) <= 4:
        return True  # "Asha", "Maths homework"
    node = parse_expression(text)
    if node is not None and node.leaf is not None and node.leaf.num is None and len(text.split()) <= 3:
        return True  # "Roll 7", "Q1", "12" alone; a sentence with one number in it is a question, not a header
    if re.fullmatch(r"(?:q|question|qn|ex|exercise|sum)\.?\s*\d+[a-z)]?\.?", text, flags=re.I):
        return True
    if re.match(r"^\s*date\b", text, flags=re.I):
        return True  # "Date: 25/9/26"
    if re.search(r"(?<![\d/])\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}(?![\d/])", text) and not re.search(
        r"[+×x*÷=]", text
    ):
        return True  # a date
    return False


def strip_headers(lines: list[str]) -> tuple[list[str], int]:
    """Drops leading header lines; returns the working and how many lines were dropped."""
    n = 0
    while n < len(lines) - 1 and is_header(lines[n]):
        n += 1
    return lines[n:], n


_A_FRACTION = re.compile(r"\d\s*/\s*\d")


def has_fraction(lines: list[str]) -> bool:
    """Whole-number arithmetic ("12 x 3 = 38") is checked and shown, but it is no fractions answer to file."""
    return any(_A_FRACTION.search(normalize(line)) for line in lines)


def looks_like_working(lines: list[str]) -> bool:
    """True when some line is arithmetic: an operator, an '=' chain, or a problem with a task word ("Simplify 8/12").
    A shopping list ("Sugar 1/2 kg", "Milk - 2 packets"), a name or a lone number is not fraction working and must
    never be filed as a wrong answer."""
    for line in lines:
        segs = split_chain(line)
        valued = [x for x in segs if x.value is not None or x.zero]
        if any(x.node is not None and x.node.leaf is None and not x.words for x in segs):
            return True
        if len(valued) >= 2 or (valued and _CHAIN_START.match(line)):
            return True
        if any(x.node is not None and _TASK_ANY.search(x.text) for x in segs):
            return True
    return False


def written_fractions(text: str) -> list[str]:
    """The fractions as written ("3/4", "12/14"), without spaces, sorted: to compare a problem with another."""
    return sorted(re.sub(r"\s+", "", m) for m in re.findall(r"\d+\s*/\s*\d+", text or ""))


_CHAIN_START = re.compile(r"^\s*(?:=|=>|⇒|→|∴)")
_ANSWER_LABEL = re.compile(r"^\s*(?:ans(?:wer)?|so|therefore|hence|total|result|final)\b", re.I)
_TASK_SIMPLEST = re.compile(r"\b(?:simplif\w*|simplest|lowest\s+terms?)\b", re.I)
_TASK_MIXED = re.compile(r"\bmixed\b", re.I)
_TASK_IMPROPER = re.compile(r"\bimproper\b", re.I)
_TASK_COMPARE = re.compile(
    r"\b(?:bigger|biggest|smaller|smallest|greater|greatest|larger|largest|less|more|compare|order|which)\b", re.I
)
_TASK_ANY = re.compile(
    r"\b(?:simplif\w*|simplest|lowest|mixed|improper|bigger|smaller|greater|larger|compare|write|convert|find)\b", re.I
)
_BLANK_DEN = re.compile(r"[?_□☐]+\s*/\s*(\d+)")
_BLANK_NUM = re.compile(r"(\d+)\s*/\s*[?_□☐]+")


_COMPARISON = re.compile(r"^(?P<left>[^<>≤≥=]+?)\s*(?P<sign><=|>=|<|>|≤|≥)\s*(?P<right>[^<>≤≥=]+)$")


def comparison(line: str) -> tuple[bool, str] | None:
    """A line that compares two values ("3/5 < 5/8", "iii) 7/9 > 2/3"): whether it is true, and the sentence that says
    what is true. None when the line isn't a comparison of two readable values."""
    m = _COMPARISON.match(strip_enumerator(normalize(line)).strip())
    if not m:
        return None
    left, right = parse_value(m.group("left")), parse_value(m.group("right"))
    if left is None or right is None:
        return None
    sign = {"≤": "<=", "≥": ">="}.get(m.group("sign"), m.group("sign"))
    ok = {"<": left < right, ">": left > right, "<=": left <= right, ">=": left >= right}[sign]
    truth = "equal to" if left == right else ("smaller than" if left < right else "bigger than")
    return ok, f"{m.group('left').strip()} is {truth} {m.group('right').strip()}"


def _first_expression(lines: list[str]) -> tuple[int, int, Node] | None:
    """(line, segment, expression) of the problem: the first segment, on a line that doesn't continue a chain, that
    is an operation or a fraction. A segment with words counts only when it carries a task ("Simplify 8/12");
    "2 cakes" or "Sugar 1/2 kg" is a label, not the problem."""
    for i, line in enumerate(lines):
        if _CHAIN_START.match(line) or is_header(line):
            continue
        for j, seg in enumerate(split_chain(line)):
            if seg.node is None or seg.value is None or not _is_problem(seg.node):
                continue
            if seg.words and not _TASK_ANY.search(seg.text):
                continue
            return i, j, seg.node
    return None


def _written_pair(seg: Segment) -> tuple[int, int] | None:
    """The fraction as the child wrote it: '4/8' -> (4, 8); '(3+1)/(4+4)' -> (4, 8); '5' -> (5, 1)."""
    node = seg.node
    if node is None:
        return None
    if node.leaf is not None:
        w = node.leaf
        if w.is_fraction:
            return (w.num, w.den)
        if w.whole is None and w.value.denominator == 1:
            return (w.value.numerator, 1)
        return None
    if node.op == "/" and node.left is not None and node.right is not None:
        try:
            a, b = node.left.value(), node.right.value()
        except ZeroDivisionError:
            return None
        if a.denominator == 1 and b.denominator == 1 and b != 0:
            return (a.numerator, b.numerator)
    return None


def verify(
    lines: list[str],
    *,
    reference: Fraction | None = None,
    problem: Problem | None = None,
    simplest_required: bool = False,
    word_problem: bool = False,
) -> Verdict:
    """Checks handwritten working line by line with exact arithmetic.

    `reference` is the right answer (the bank's expression when the problem is known); when it is None, the problem is
    whatever the student wrote first, and its exact value is the reference.

    Lines that continue the working (they start with '=', or state the answer) must equal the right answer. Side
    working ('2/3 = 4/6', '3 + 1 = 4') only has to be true in itself, and notes with words ('LCM = 6', 'Check: ...')
    aren't judged. When the problem is stated in words and isn't a known bank problem, the arithmetic can check the
    working but not whether it answers the question: the verdict is then 'checked' and the model decides.
    """
    lines = [x.strip() for x in lines if x and x.strip()][:40]
    known = reference is not None
    found = _first_expression(lines)
    problem_line, problem_seg = (found[0], found[1]) if found is not None else (0, 0)
    if problem is None and reference is None:
        if found is not None:
            try:
                reference = found[2].value()
                problem = problem_from_node(found[2], reference, word_problem)
            except ZeroDivisionError:
                reference = None
    elif problem is None and reference is not None and found is not None:
        problem = problem_from_node(found[2], reference, word_problem)
        if problem is not None and problem.reference != reference:
            # the first line isn't the problem itself (a word problem restated); keep the reference we were given
            problem = Problem(problem.op, problem.a, problem.b, reference, word_problem)

    # what the problem asks for, from the lines up to and including the problem line
    stated = [x for x in lines[: problem_line + 1] if not is_header(x)]
    statement = " ".join(stated)
    before = [x for x in lines[:problem_line] if not is_header(x)]
    in_words = any(_WORD.search(x) and re.search(r"\d", x) for x in before)
    if lines and found is not None:
        pre = split_chain(lines[problem_line])[:problem_seg]
        in_words = in_words or any(x.words and re.search(r"\d", x.text) for x in pre)
    wants_simplest = simplest_required or bool(_TASK_SIMPLEST.search(statement))
    wants_mixed = bool(_TASK_MIXED.search(statement))
    wants_improper = bool(_TASK_IMPROPER.search(statement))
    compare = bool(_TASK_COMPARE.search(statement)) and not known
    blank_den = _BLANK_DEN.search(lines[problem_line]) if lines else None
    blank_num = _BLANK_NUM.search(lines[problem_line]) if lines else None

    # which lines are the working's chain, which are side sums, and which are notes
    kinds: list[str] = []
    rows = [split_chain(line) for line in lines]
    last_valued = max(
        (i for i, segs in enumerate(rows) if any((x.value is not None or x.zero) and not x.words for x in segs)),
        default=-1,
    )
    for i, (line, segs) in enumerate(zip(lines, rows, strict=True)):
        if comparison(line) is not None:
            kinds.append("compare")
        elif i < problem_line:
            kinds.append("header")
        elif compare and not known and any((x.value is not None or x.zero) and not x.words for x in segs):
            kinds.append("side")  # "which is bigger": each line is its own sum ("3/5 = 24/40"), with no one answer
        elif i == problem_line:
            kinds.append("problem")
        elif _CHAIN_START.match(line) or _ANSWER_LABEL.match(line):
            kinds.append("chain")
        else:
            plain = [x for x in segs if (x.value is not None or x.zero) and not x.words]
            if not plain:
                kinds.append("note")
            elif any(x.words for x in segs):
                kinds.append("side")  # "2 cakes = 2 x 3/4": the labelled parts are skipped
            elif i == last_valued or len(plain) == 1:
                kinds.append("chain")
            elif reference is not None and plain[0].value == reference:
                kinds.append("chain")  # the problem written again, then its working
            else:
                kinds.append("side")  # "2/3 = 4/6", "3 + 1 = 4"

    checks: list[LineCheck] = []
    error_step: int | None = None
    error_kind = ""
    wrong_value: Fraction | None = None
    wrong_seg: Segment | None = None
    zero_line = False
    final: Fraction | None = None
    final_written: Written | None = None
    reached_answer = False
    last_right: Written | None = None
    compare_wrong = side_first = ""
    for i, (line, segs, kind) in enumerate(zip(lines, rows, kinds, strict=True)):
        values = [x.value for x in segs]
        parsable = [v for v in values if v is not None]
        check = LineCheck(line, _f(parsable[-1]) if parsable else None, [_f(v) for v in values])
        if kind == "compare":
            ok, truth = comparison(line) or (True, "")
            check.ok, check.value, check.values = ok, None, []
            if not ok and error_step is None:
                error_step, error_kind, compare_wrong = i + 1, "compare", truth
            checks.append(check)
            continue
        if kind in ("header", "note") or reference is None:
            if kind == "header":
                check.value, check.values = None, [None] * len(values)
            checks.append(check)
            continue
        if kind == "problem":
            judged = [(j, x) for j, x in enumerate(segs) if j >= problem_seg and (x.value is not None or x.zero)]
        elif kind == "chain":
            judged = [(j, x) for j, x in enumerate(segs) if x.value is not None or x.zero]
        else:
            judged = [(j, x) for j, x in enumerate(segs) if (x.value is not None or x.zero) and not x.words]
        if kind == "side":
            first_seg = next((x for _, x in judged if x.value is not None), None)
            first = first_seg.value if first_seg is not None else None
            bad = [x for _, x in judged if x.zero or (x.value is not None and x.value != first)]
            if bad and error_step is None and first_seg is not None:
                side_first = first_seg.text
        else:
            bad = [x for _, x in judged if x.zero or x.value != reference]
            for j, x in judged:
                if x.value == reference and not (kind == "problem" and j == problem_seg) and error_step is None:
                    reached_answer = True
                    leaf = _leaf(x.node)
                    if leaf is not None and leaf.is_fraction:
                        last_right = leaf
        check.ok = (not bad) if judged else None
        if bad and error_step is None:
            error_step, error_kind, wrong_seg = i + 1, kind, bad[0]
            wrong_value, zero_line = wrong_seg.value, wrong_seg.zero
        if kind in ("problem", "chain") and judged:
            last = judged[-1][1]
            final = last.value
            final_written = _leaf(last.node) if last.value is not None else None
        checks.append(check)

    def verdict(status, correct, step, tag, reproduced, evidence):
        # "which is bigger" has no one answer: the first fraction's value is not a reference to show
        shown_ref = None if compare and not known else _f(reference)
        return Verdict(status, correct, step, tag, reproduced, evidence, shown_ref, _f(final), checks, problem_line)

    if error_kind == "compare":
        return verdict("verified", False, error_step, None, None, f"Line {error_step} isn't true: {compare_wrong}.")
    if all(c.ok is None for c in checks) or (reference is None and not any(k == "compare" for k in kinds)):
        return verdict("unverified", None, None, None, None, "No line could be read as arithmetic.")
    answered = any(k == "compare" for k in kinds) or any(
        x.value is not None or x.zero
        for i, segs in enumerate(rows)
        if i >= problem_line and kinds[i] in ("problem", "chain", "side")
        for j, x in enumerate(segs)
        if not (i == problem_line and j <= problem_seg) and not (kinds[i] == "side" and any(y.words for y in segs))
    )
    if not answered:
        # the problem copied out and left ("5/6 - 1/6 =", "= ?", "= 4/"): not right, and not a mistake either
        return verdict("unanswered", None, None, None, None, "No answer is written after the problem.")
    if reference is None:
        return verdict(
            "checked",
            None,
            None,
            None,
            None,
            "Every comparison holds; whether it answers the question as asked is the model's reading.",
        )

    if error_step is None:
        written = final_written
        if wants_simplest and written is not None and not written.simplest and final == reference:
            return verdict(
                "verified",
                False,
                len(checks),
                "not_fully_simplified",
                None,
                f"{written.num}/{written.den} equals {_f(reference)} but is not in simplest form.",
            )
        form = None
        if blank_den and written is not None and written.is_fraction and written.den != int(blank_den.group(1)):
            form = f"The blank asks for a fraction with denominator {blank_den.group(1)}."
        elif blank_num and written is not None and written.is_fraction and written.num != int(blank_num.group(1)):
            form = f"The blank asks for a fraction with numerator {blank_num.group(1)}."
        elif wants_mixed and written is not None and written.whole is None and final and final.denominator != 1:
            form = "The question asks for a mixed number."
        elif wants_improper and written is not None and written.whole is not None:
            form = "The question asks for an improper fraction."
        if form:
            return verdict("verified", False, len(checks), None, None, form)
        if (in_words or compare) and not known:
            return verdict(
                "checked",
                None,
                None,
                None,
                None,
                "Every line's arithmetic holds; whether it answers the question as asked is the model's reading.",
            )
        return verdict("verified", True, None, None, None, f"Every line equals {_f(reference)} (exact arithmetic).")

    if zero_line:
        return verdict("verified", False, error_step, None, None, f"Line {error_step} divides by zero.")
    if error_kind == "side":
        return verdict(
            "verified",
            False,
            error_step,
            None,
            None,
            f"Line {error_step} isn't true: {side_first} is not equal to {wrong_seg.text}.",
        )

    # name the mistake: only when a rule writes what the child wrote
    written: list[tuple[int, int]] = []
    pair = _written_pair(wrong_seg) if wrong_seg is not None else None
    if pair:
        written.append(pair)
    else:
        # "(3+1)/(4+4)" or "5/3 × 3/10" is the wrong step; the fraction the child writes for it later is its form
        for row in rows[error_step - 1 :]:
            for x in row:
                leaf = _leaf(x.node)
                if leaf is not None and leaf.is_fraction and x.value == wrong_value:
                    written.append((leaf.num, leaf.den))
    tag = reproduced = None
    if problem is not None and wrong_value is not None:
        p = problem
        only = None
        if reached_answer:
            # the answer was already right: only a simplification or a slip can go wrong now
            only = {"simplify_one_part", "careless_arithmetic"}
            if last_right is not None:
                p = Problem(None, last_right, None, reference, word_problem)
        elif p.op is None and p.b is None and pair and pair[1] != 1:
            p = Problem(None, p.a, None, p.reference, p.word_problem, target_den=pair[1])
        if p.word_problem and wrong_seg is not None and wrong_seg.node is not None and wrong_seg.node.leaf is None:
            if wrong_seg.node.op != p.op and wrong_value in MAL_RULES["word_problem_operation"](p):
                tag, reproduced = "word_problem_operation", "word_problem_operation"
        if tag is None:
            tag, exact = reproduce_written(p, wrong_value, written, only)
            reproduced = tag if exact else None
    shown = f"{written[0][0]}/{written[0][1]}" if written and written[0][1] != 1 else _f(wrong_value)
    if reproduced:
        evidence = f"{RULE_WORDS[reproduced]} gives exactly {shown}."
    elif tag:
        evidence = f"Line {error_step} equals {_f(wrong_value)}, the same value {RULE_WORDS[tag]} gives."
    else:
        evidence = f"Line {error_step} equals {_f(wrong_value)}, not {_f(reference)}; no known mistake reproduces it."
    return verdict("verified", False, error_step, tag, reproduced, evidence)


def guess_concept(problem: Problem | None) -> str:
    """Which concept a problem outside the bank belongs to, from its operator."""
    if problem is None:
        return "C4"
    if problem.word_problem:
        return "C8"
    return {"+": "C4", "-": "C4", "*": "C6", "/": "C7", None: "C1"}.get(problem.op, "C4")
