"""Shared reading of the rulebook's `\\macro{Name}{key=value, ...}` stat blocks.

`abilities.tex` and `spells.tex` write every entry through a pgfkeys macro of
the same shape, so the brace and key=value handling lives here and the
extractors keep only their own field grammars.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
RULEBOOK = (REPO_ROOT / ".." / "RPG_Below_v7_en").resolve()


def read_arg(text: str, i: int) -> tuple[str, int]:
    """Reads one brace-delimited argument starting at the '{' at `i`."""
    while text[i] in " \t\n%":
        i += 1
    if text[i] != "{":
        raise ValueError(f"expected '{{' at {i}: {text[i:i+30]!r}")
    depth = 0
    j = i
    while j < len(text):
        if text[j] == "{":
            depth += 1
        elif text[j] == "}":
            depth -= 1
            if depth == 0:
                return text[i + 1 : j], j + 1
        j += 1
    raise ValueError("unbalanced braces")


def split_keys(body: str) -> dict[str, str]:
    """`key=value, key={a, b}` -> {key: value}; a braced value may hold commas."""
    parts: list[str] = []
    depth = 0
    cur = ""
    for ch in body:
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    out: dict[str, str] = {}
    for part in parts:
        part = part.strip().lstrip("%").strip()
        if not part:
            continue
        if "=" not in part:
            raise ValueError(f"fragment without '=': {part!r}")
        key, value = part.split("=", 1)
        value = value.strip()
        if value.startswith("{") and value.endswith("}"):
            value = value[1:-1]
        key = key.strip()
        if key in out:
            raise ValueError(f"duplicate key {key!r}")
        out[key] = clean(value)
    return out


def clean(s: str) -> str:
    s = s.replace("\\magic", "★ ")
    s = re.sub(r"\$\\star\$", "★", s)
    s = re.sub(r"\\textbf\{([^}]*)\}", r"\1", s)
    s = s.replace("\\%", "%").replace("\\\\", " ")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower().replace("★", "")).strip("-")


def strip_comments(text: str) -> str:
    """Blanks commented-out lines instead of dropping them so that positions
    still map to the book's line numbers."""
    return "\n".join("" if line.lstrip().startswith("%") else line for line in text.splitlines())


def line_of(text: str, pos: int) -> int:
    return text.count("\n", 0, pos) + 1


def macro_names(path: Path, macro: str) -> set[str]:
    """Every name given as the first argument of `\\macro{...}` in a file."""
    text = strip_comments(path.read_text(encoding="utf-8"))
    names: set[str] = set()
    for m in re.finditer(rf"\\{macro}\{{", text):
        name, _ = read_arg(text, m.end() - 1)
        names.add(clean(name).replace("★ ", ""))
    return names
