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
            out.append(("op", {"−": "-", "–": "-", "×": "*", "x": "*", "·": "*", "÷": "/", ":": "/"}.get(tok, tok)))
            continue
        if kind == "other":
            out.append(("other", tok))
            continue
        out.append((kind, tok))
    return out


def _strip_words(tokens: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Leading and trailing words and units are ignored; a word between numbers means this isn't an expression."""
    while tokens and (tokens[0][0] in ("word", "other") or tokens[0] == ("op", "/")):
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
        while self.peek("op", "*") or self.peek("op", "/"):
            op = self.take()[1]
            node = Node(op, node, self.unary())
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
    m = _SPACED_SLASH.match(text)
    if not m or text.count("/") != 1:
        return text
    left, right = (m.group(1), m.group(2)) if m.group(1) is not None else (m.group(3), m.group(4))
    return f"({left.strip()}) / ({right.strip()})"


# a problem number at the start of a line: "Q1)", "Q.2", "Qn 3:", "1)", "2.", "(a)", "(iii)", "Ex 4)"
_ENUMERATOR = re.compile(
    r"^\s*(?:"
    r"(?:q|qn|ques|question|ex|exercise|sum|no)\.?\s*\d{1,3}[a-z]?\s*(?:[).:\]-]\s*|\s+)"
    r"|\d{1,3}[a-z]?\s*(?:[)\]]|\.(?!\d))\s*"
    r"|[a-h]\s*[):\]]\s*"
    r"|\(\s*(?:\d{1,3}|[a-h]|[ivx]{1,4})\s*\)\s*"
    r")",
    re.IGNORECASE,
)


def strip_enumerator(text: str) -> str:
    """ "Q1) 2/3 + 4/7" -> "2/3 + 4/7". Only a numbering prefix is removed; the maths is untouched."""
    return _ENUMERATOR.sub("", text, count=1)


def _parse(text: str) -> Node | None:
    try:
        tokens = _strip_words(_tokens(_spaced_fraction(text)))
        if not tokens:
            return None
        return _Parser(tokens).parse()
    except (ParseError, IndexError, ZeroDivisionError, ValueError):
        return None


_BLANK = re.compile(r"\?|_{2,}|□|☐")


def parse_expression(text: str) -> Node | None:
    """One side of an '=' as an exact expression tree, or None when it isn't one (words, empty, unbalanced).

    A blank to fill in ("?/6", "__/24", "□") is not a value: "2/3 = ?/6" states the problem, it doesn't claim 6.

    A problem number in front ("Q1)", "Q.2", "2.", "(a)") is read first as a number and dropped; if what is left
    doesn't parse, the line is read as written, so "(3) + 4" keeps its bracket but "(1) 3/4 + 1/4" loses its number."""
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


@dataclass
class Segment:
    text: str
    node: Node | None
    value: Fraction | None


def split_chain(line: str) -> list[Segment]:
    """'3/4 + 1/4 = (3+1)/(4+4) = 4/8' → three segments; a leading '=' gives an empty first segment that is dropped."""
    out = []
    for part in re.split(r"\s*=\s*", line.replace("＝", "=")):
        if not part.strip():
            continue
        node = parse_expression(part)
        value = None
        if node is not None:
            try:
                value = node.value()
            except ZeroDivisionError:
                value = None
        out.append(Segment(part.strip(), node, value))
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
    text = _BANK_F.sub(lambda m: f"{m.group(1)}/{m.group(2)}", expr)
    text = _BANK_INT.sub(lambda m: m.group(1), text)
    # in the bank, "/" between two fractions is division and "*" is multiplication
    text = re.sub(r"\)\s*/\s*\(", ") ÷ (", text)
    text = re.sub(r"(\d)\s*/\s*(\d+/\d+)", r"\1 ÷ \2", text)  # 2/(3/4) style never occurs, but keep "/" safe
    text = re.sub(r"(\d+/\d+)\s*/\s*(\d)", r"\1 ÷ \2", text)
    node = parse_expression(text)
    if node is None:
        return None
    try:
        return problem_from_node(node, node.value(), word_problem)
    except ZeroDivisionError:
        return None


# ---------- mal-rules: one pure function per procedural misconception ----------

MalRule = Callable[[Problem], set[Fraction]]


def _frac(n: int, d: int) -> set[Fraction]:
    return {Fraction(n, d)} if d else set()


def _nd(w: Written) -> tuple[int, int]:
    """Numerator and denominator as written (an integer is n/1; a mixed number is converted)."""
    if w.num is not None and w.den is not None and w.whole is None:
        return w.num, w.den
    return w.value.numerator, w.value.denominator


def add_denominators(p: Problem) -> set[Fraction]:
    """3/4 + 1/4 = (3+1)/(4+4) = 4/8: adds (or subtracts) the denominators too."""
    if p.op not in ("+", "-") or p.b is None:
        return set()
    (na, da), (nb, db) = _nd(p.a), _nd(p.b)
    n = na + nb if p.op == "+" else na - nb
    return _frac(n, da + db)


def unlike_denominators(p: Problem) -> set[Fraction]:
    """2/3 + 1/6 = 3/6: adds the numerators without making the denominators the same (keeps either denominator)."""
    if p.op not in ("+", "-") or p.b is None:
        return set()
    (na, da), (nb, db) = _nd(p.a), _nd(p.b)
    if da == db:
        return set()
    n = na + nb if p.op == "+" else na - nb
    return _frac(n, da) | _frac(n, db)


def multiply_cross(p: Problem) -> set[Fraction]:
    """2/3 × 3/4 = 8/9: multiplies across the diagonal."""
    if p.op != "*" or p.b is None:
        return set()
    (na, da), (nb, db) = _nd(p.a), _nd(p.b)
    return _frac(na * db, da * nb)


def whole_times_both(p: Problem) -> set[Fraction]:
    """3 × 2/5 = 6/15: multiplies both the top and the bottom by the whole number."""
    if p.op != "*" or p.b is None:
        return set()
    out: set[Fraction] = set()
    for whole, frac in ((p.a, p.b), (p.b, p.a)):
        if whole.value.denominator == 1 and whole.num is None and frac.is_fraction:
            k = whole.value.numerator
            n, d = _nd(frac)
            out |= _frac(k * n, k * d)
    return out


def divide_no_flip(p: Problem) -> set[Fraction]:
    """3/5 ÷ 3/10 = 9/50: multiplies straight across without flipping the second fraction."""
    if p.op != "/" or p.b is None:
        return set()
    (na, da), (nb, db) = _nd(p.a), _nd(p.b)
    return _frac(na * nb, da * db)


def divide_flip_first(p: Problem) -> set[Fraction]:
    """3/5 ÷ 3/10 = 5/3 × 3/10 = 1/2: flips the first fraction instead of the second."""
    if p.op != "/" or p.b is None:
        return set()
    (na, da), (nb, db) = _nd(p.a), _nd(p.b)
    return _frac(da * nb, na * db)


def word_problem_operation(p: Problem) -> set[Fraction]:
    """A story that needs 2 × 3/4 answered with 2 + 3/4: the wrong operation, done correctly."""
    if not p.word_problem or p.op is None or p.b is None:
        return set()
    a, b = p.a.value, p.b.value
    others = {"+": a + b, "-": a - b, "*": a * b, "/": a / b if b else None}
    others.pop(p.op, None)
    return {v for v in others.values() if v is not None}


def equivalence_additive(p: Problem) -> set[Fraction]:
    """2/3 = 3/4, or 3/8 = ?/24 answered 19: adds the same number to the top and the bottom."""
    if p.op is not None or not p.a.is_fraction:
        return set()
    n, d = _nd(p.a)
    out: set[Fraction] = set()
    if p.target_den:
        k = p.target_den - d
        out |= _frac(n + k, p.target_den)
    for k in range(1, 13):
        out |= _frac(n + k, d + k)
        if d - k > 0 and n - k > 0:
            out |= _frac(n - k, d - k)
    return out


def simplify_one_part(p: Problem) -> set[Fraction]:
    """6/8 = 3/8 or 8/20 = 2/20: divides (or multiplies) only the top or only the bottom."""
    if p.op is not None or not p.a.is_fraction:
        return set()
    n, d = _nd(p.a)
    out: set[Fraction] = set()
    for k in range(2, 13):
        if n % k == 0:
            out |= _frac(n // k, d)
        if d % k == 0:
            out |= _frac(n, d // k)
        out |= _frac(n * k, d) | _frac(n, d * k)
    return out


def careless_arithmetic(p: Problem) -> set[Fraction]:
    """The right method with one slip: the numerator of the correctly built fraction off by one (3/4 + 1/4 = 5/4),
    or the answer off by one in its own denominator."""
    r = p.reference
    out = {r + Fraction(1, r.denominator), r - Fraction(1, r.denominator)}
    if p.b is not None and p.op is not None:
        (na, da), (nb, db) = _nd(p.a), _nd(p.b)
        if p.op in ("+", "-"):
            common = da * db // gcd(da, db)
            n = na * (common // da) + (nb * (common // db) if p.op == "+" else -nb * (common // db))
            out |= _frac(n + 1, common) | _frac(n - 1, common)
        elif p.op == "*":
            out |= _frac(na * nb + 1, da * db) | _frac(na * nb - 1, da * db)
        else:
            out |= _frac(na * db + 1, da * nb) | _frac(na * db - 1, da * nb)
    return out - {r}


MAL_RULES: dict[str, MalRule] = {
    "add_denominators": add_denominators,
    "unlike_denominators": unlike_denominators,
    "multiply_cross": multiply_cross,
    "whole_times_both": whole_times_both,
    "divide_no_flip": divide_no_flip,
    "divide_flip_first": divide_flip_first,
    "word_problem_operation": word_problem_operation,
    "equivalence_additive": equivalence_additive,
    "simplify_one_part": simplify_one_part,
    "careless_arithmetic": careless_arithmetic,
}

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


def reproduce(problem: Problem, wrong_value: Fraction) -> str | None:
    """The first mal-rule whose procedure gives exactly `wrong_value`; careless_arithmetic is tried last."""
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
    status: str  # "verified" (arithmetic decided) | "unverified" (nothing to compute)
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
    if node is not None and node.leaf is not None and node.leaf.num is None:
        return True  # "Roll 7", "Q1", "12" alone
    if re.fullmatch(r"(?:q|question|qn|ex|exercise|sum)\.?\s*\d+[a-z)]?\.?", text, flags=re.I):
        return True
    if re.fullmatch(r"\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}", text):
        return True  # a date
    return False


def strip_headers(lines: list[str]) -> tuple[list[str], int]:
    """Drops leading header lines; returns the working and how many lines were dropped."""
    n = 0
    while n < len(lines) - 1 and is_header(lines[n]):
        n += 1
    return lines[n:], n


def _first_expression(lines: list[str]) -> tuple[int, Node] | None:
    for i, line in enumerate(lines):
        if line.lstrip().startswith("="):
            continue
        segs = split_chain(line)
        if segs and segs[0].node is not None and segs[0].value is not None and _is_problem(segs[0].node):
            return i, segs[0].node
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
    """
    lines = [x.strip() for x in lines if x and x.strip()]
    found = _first_expression(lines)
    problem_line = found[0] if found is not None else 0
    if problem is None and reference is None:
        if found is not None:
            _, node = found
            try:
                reference = node.value()
                problem = problem_from_node(node, reference, word_problem)
            except ZeroDivisionError:
                reference = None
    elif problem is None and reference is not None:
        if found is not None:
            problem = problem_from_node(found[1], reference, word_problem)
            if problem is not None and problem.reference != reference:
                # the first line isn't the problem itself (a word problem restated); keep the reference we were given
                problem = Problem(problem.op, problem.a, problem.b, reference, word_problem)
    elif found is None:
        problem_line = 0

    checks: list[LineCheck] = []
    error_step: int | None = None
    wrong_value: Fraction | None = None
    wrong_written: Written | None = None
    final: Fraction | None = None
    final_written: Written | None = None
    for i, line in enumerate(lines):
        segs = split_chain(line)
        values = [s.value for s in segs]
        parsable = [v for v in values if v is not None]
        check = LineCheck(line, _f(parsable[-1]) if parsable else None, [_f(v) for v in values])
        if i < problem_line:
            check.value, check.values = None, [None] * len(values)  # a header: "Roll 7", "Q1"
            checks.append(check)
            continue
        if parsable and reference is not None:
            bad = [(s.value, s) for s in segs if s.value is not None and s.value != reference]
            check.ok = not bad
            if bad and error_step is None:
                error_step = i + 1
                wrong_value, seg = bad[0]
                wrong_written = _leaf(seg.node)
            if parsable:
                final = parsable[-1]
                final_written = _leaf(segs[-1].node) if segs[-1].value is not None else None
        checks.append(check)

    if reference is None or all(c.ok is None for c in checks):
        return Verdict(
            "unverified",
            None,
            None,
            None,
            None,
            "No line could be read as arithmetic.",
            None,
            None,
            checks,
            problem_line,
        )

    if error_step is None:
        if simplest_required and final_written is not None and not final_written.simplest and final == reference:
            return Verdict(
                "verified",
                False,
                len(checks),
                "not_fully_simplified",
                None,
                f"{_f(final)} equals {_f(reference)} but is not in simplest form.",
                _f(reference),
                _f(final),
                checks,
                problem_line,
            )
        return Verdict(
            "verified",
            True,
            None,
            None,
            None,
            f"Every line equals {_f(reference)} (exact arithmetic).",
            _f(reference),
            _f(final),
            checks,
            problem_line,
        )

    tag = None
    reproduced = None
    shown = _f(wrong_value)
    if wrong_written is not None and wrong_written.is_fraction:
        shown = f"{wrong_written.num}/{wrong_written.den}"
    else:
        # "(3+1)/(4+4)" is the wrong step; the student writes its value, 4/8, further down: quote that form
        for line in lines[error_step - 1 :]:
            for seg in split_chain(line):
                leaf = _leaf(seg.node)
                if leaf is not None and leaf.is_fraction and leaf.value == wrong_value:
                    shown = f"{leaf.num}/{leaf.den}"
                    break
            else:
                continue
            break
    if problem is not None and wrong_value is not None:
        p = problem
        if p.op is None and p.b is None and wrong_written is not None and wrong_written.is_fraction:
            p = Problem(None, p.a, None, p.reference, p.word_problem, target_den=wrong_written.den)
        reproduced = reproduce(p, wrong_value)
        tag = reproduced
    if reproduced:
        evidence = f"{RULE_WORDS[reproduced]} gives exactly {shown}."
    else:
        evidence = f"Line {error_step} equals {_f(wrong_value)}, not {_f(reference)}; no known mistake reproduces it."
    return Verdict(
        "verified", False, error_step, tag, reproduced, evidence, _f(reference), _f(final), checks, problem_line
    )


def guess_concept(problem: Problem | None) -> str:
    """Which concept a problem outside the bank belongs to, from its operator."""
    if problem is None:
        return "C4"
    if problem.word_problem:
        return "C8"
    return {"+": "C4", "-": "C4", "*": "C6", "/": "C7", None: "C1"}.get(problem.op, "C4")
