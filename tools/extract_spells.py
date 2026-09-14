"""Extracts the spell catalog from the rulebook's spells.tex.

Reads every active `\\spell{Name}{key=value, ...}` block and writes
app/domain/spells.generated.ts: one entry per spell with the book's fields
parsed into the shape SpellSchema expects. The prose (effect, outcomes,
enhancement) is kept verbatim; the numbers the domain reads (cost, DL,
knowledge levels, damage, the two sides of a test) are parsed here so the
domain never has to look at book text. Anything the parser cannot read stays
in the raw text field beside the parsed value.

Ids are the slug of the spell's name.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
RULEBOOK = (REPO_ROOT / ".." / "RPG_Below_v7_en" / "spells.tex").resolve()
OUT = REPO_ROOT / "app" / "domain" / "spells.generated.ts"

TYPES = ("instant", "sustained", "charged", "curse")
# the book writes "cutting" where the domain's damage columns say "cut"
DAMAGE_KINDS = {"blunt": "blunt", "cut": "cut", "cutting": "cut", "burn": "burn",
                "electric": "electric", "radiant": "radiant", "corrosive": "corrosive"}


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
        out[key.strip()] = clean(value)
    return out


def clean(s: str) -> str:
    s = re.sub(r"\\textbf\{([^}]*)\}", r"\1", s)
    s = s.replace("\\%", "%").replace("\\\\", " ")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def strip_comments(text: str) -> str:
    return "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("%"))


def parse_cost(text: str) -> dict[str, int]:
    """'4 AP + 1 STA', '1 ET, +1 exhaustion per ET', '3AP or +1 exhaustion'.
    An `or` names the exploration alternative to the combat price, so both
    sides are kept; charges and materials are not a character resource and stay
    in the raw text only."""
    cost: dict[str, int] = {}
    for field, pattern in (("AP", r"(\d+)\s*AP\b"), ("STA", r"(\d+)\s*STA\b"),
                           ("exhaustion", r"(\d+)\s*[Ee]xhaustion"), ("ET", r"(\d+)\s*ETs?\b")):
        m = re.search(pattern, text)
        if m:
            cost[field] = int(m.group(1))
    return cost


def parse_knowledge(text: str) -> list[dict]:
    """'Animancy 3, Biomancy 1' -> [{name: 'animancy', level: 3}, ...]."""
    out = []
    for part in text.split(","):
        m = re.match(r"^\s*([A-Za-z ]+?)\s*(\d+)\s*$", part)
        if not m:
            raise ValueError(f"unreadable knowledge {part!r}")
        out.append({"name": m.group(1).strip().lower(), "level": int(m.group(2))})
    return out


def parse_duration(text: str) -> tuple[str, int]:
    if not text:
        return "none", 0
    if text == "permanent":
        return "permanent", 0
    m = re.match(r"^(\d+)\s*ETs?$", text)
    if not m:
        raise ValueError(f"unreadable duration {text!r}")
    return "ET", int(m.group(1))


def parse_damage(text: str) -> dict | None:
    """'20xDM blunt', '15 xDM electric', '10 cutting'."""
    if not text:
        return None
    m = re.match(r"^(\d+)\s*(xDM)?\s*([a-z]+)$", text)
    if not m or m.group(3) not in DAMAGE_KINDS:
        raise ValueError(f"unreadable damage {text!r}")
    return {"value": int(m.group(1)), "scaled": m.group(2) is not None, "kind": DAMAGE_KINDS[m.group(3)]}


def parse_test(text: str) -> dict | None:
    """'Charisma vs will' -> {dl: 'Charisma', roll: 'will'}: the left side is
    the DL the caster sets, the right side is what the defender rolls."""
    if not text:
        return None
    if " vs " not in text:
        raise ValueError(f"test without 'vs': {text!r}")
    dl, roll = text.split(" vs ", 1)
    return {"dl": dl.strip(), "roll": roll.strip()}


def extract(text: str) -> dict[str, dict]:
    text = strip_comments(text)
    entries: dict[str, dict] = {}
    section = ""
    token = re.compile(r"\\(section|spell)\{")
    pos = 0
    while True:
        m = token.search(text, pos)
        if not m:
            break
        if m.group(1) == "section":
            title, pos = read_arg(text, m.end() - 1)
            section = clean(title).rstrip(":")
            continue
        name, pos = read_arg(text, m.end() - 1)
        body, pos = read_arg(text, pos)
        name = clean(name)
        fields = split_keys(body)
        if fields["type"] not in TYPES:
            raise ValueError(f"{name}: unknown type {fields['type']!r}")
        duration, ets = parse_duration(fields.get("duration", ""))
        entry: dict = {
            "name": name,
            "section": section.lower(),
            "type": fields["type"],
            "cost": parse_cost(fields["cost"]),
            "costText": fields["cost"],
            "knowledge": parse_knowledge(fields["knowledge"]),
            "requirements": fields.get("requirements", ""),
            "DL": int(fields["dl"]) if fields["dl"].lstrip("-").isdigit() else None,
            "castRange": fields.get("cast range", ""),
            "castArea": fields.get("cast area", ""),
            "effectRange": fields.get("effect range", ""),
            "effectArea": fields.get("effect area", ""),
            "duration": duration,
            "durationETs": ets,
            "description": fields["effect"],
            "enhance": fields.get("enhance", ""),
        }
        damage = parse_damage(fields.get("damage", ""))
        if damage:
            entry["damage"] = damage
        test = parse_test(fields.get("test", ""))
        if test:
            entry["test"] = test
        outcomes = {k: fields[k] for k in ("miss", "graze", "hit", "crit") if fields.get(k)}
        if outcomes:
            entry["outcomes"] = outcomes
        key = slug(name)
        if key in entries:
            raise ValueError(f"duplicate spell {name!r}")
        entries[key] = entry
    return entries


def render(entries: dict[str, dict]) -> str:
    lines = [
        "// Generated by tools/extract_spells.py from the rulebook's spells.tex —",
        "// do not edit by hand; re-run the script after a rulebook change.",
        "import type { SpellInput } from './types'",
        "",
        "export const SPELL_TEXT = {",
    ]
    for key, entry in entries.items():
        lines.append(f"  {json.dumps(key)}: {json.dumps(entry, ensure_ascii=False)},")
    lines += ["} satisfies Record<string, SpellInput>", ""]
    return "\n".join(lines)


def main() -> None:
    entries = extract(RULEBOOK.read_text(encoding="utf-8"))
    OUT.write_text(render(entries), encoding="utf-8")
    print(f"wrote {len(entries)} entries to {OUT.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
