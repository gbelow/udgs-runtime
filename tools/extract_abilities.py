"""Extracts the ability catalog text from the rulebook's abilities.tex.

Reads every active `\\abil{...}`, `\\inna{...}` and `\\convic{...}` block and
writes app/domain/abilities.generated.ts: one entry per stage, with the
book's name, section, usage and description. Effects are not in the book's
text and are authored by hand in app/domain/abilities.ts, keyed by the ids
this script emits — so re-running it after a rulebook edit refreshes the
prose without touching the numbers.

Ids are `<family-slug>` for a single-stage ability and `<family-slug>-<n>` for
stage n of a multi-stage one; a conviction's levels are its stages.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
RULEBOOK = (REPO_ROOT / ".." / "RPG_Below_v7_en" / "abilities.tex").resolve()
OUT = REPO_ROOT / "app" / "domain" / "abilities.generated.ts"

ROMAN = {0: "0", 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V"}
ROMAN_VALUE = {v: k for k, v in ROMAN.items()}


def read_args(text: str, start: int, count: int) -> tuple[list[str], int]:
    """Reads `count` brace-delimited arguments starting at `start`."""
    args: list[str] = []
    i = start
    for _ in range(count):
        while i < len(text) and text[i] in " \t\n":
            i += 1
        if i >= len(text) or text[i] != "{":
            raise ValueError(f"expected '{{' at {i}")
        depth = 0
        j = i
        while j < len(text):
            if text[j] == "{":
                depth += 1
            elif text[j] == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        args.append(text[i + 1 : j])
        i = j + 1
    return args, i


def clean(s: str) -> str:
    s = s.replace("\\magic", "★ ")
    s = re.sub(r"\$\\star\$", "★", s)
    s = re.sub(r"\\textbf\{([^}]*)\}", r"\1", s)
    s = s.replace("\\%", "%").replace("\\\\", " ")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower().replace("★", "")).strip("-")


def split_stages(name: str) -> tuple[str, list[int]]:
    """'Sprinter I/II' -> ('Sprinter', [1, 2]); 'Archer' -> ('Archer', [])."""
    m = re.match(r"^(.*?)\s+((?:I{1,3}|IV|V)(?:/(?:I{1,3}|IV|V))+)\s*$", name)
    if not m:
        return name, []
    return m.group(1).strip(), [ROMAN_VALUE[r] for r in m.group(2).split("/")]


def split_description(desc: str, stages: list[int]) -> dict[int, str]:
    """Hands each stage the 'I. … II. …' segment addressed to it when the text
    is marked that way, and the whole text otherwise."""
    parts = re.split(r"(?:^|\s)(I{1,3}|IV|V)\.\s+", desc)
    if len(parts) > 1:
        lead = parts[0].strip()
        marked = {ROMAN_VALUE[parts[i]]: parts[i + 1].strip() for i in range(1, len(parts), 2)}
        if len(marked) == len(stages) and all(i + 1 in marked for i in range(len(stages))):
            return {stage: (lead + " " + marked[i + 1]).strip() for i, stage in enumerate(stages)}
    # a lone leading "I." introduces a "1/2/3" style text meant for every stage
    desc = re.sub(r"^I\.\s+", "", desc)
    return {stage: desc for stage in stages}


def usage_to_activation(usage: str) -> str:
    return "passive" if usage in ("", "passive") else "active"


def usage_to_cost(usage: str) -> dict[str, int]:
    cost: dict[str, int] = {}
    ap = re.search(r"(\d+)\s*AP", usage)
    sta = re.search(r"(\d+)\s*STA", usage)
    if ap:
        cost["AP"] = int(ap.group(1))
    if sta:
        cost["STA"] = int(sta.group(1))
    return cost


def strip_comments(text: str) -> str:
    return "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("%"))


def extract(text: str) -> dict[str, dict]:
    text = strip_comments(text)
    entries: dict[str, dict] = {}
    section = ""
    conviction: str | None = None
    # conviction levels collect text across several \convic lines
    conviction_levels: dict[str, dict[int, list[str]]] = {}

    token = re.compile(r"\\(section|subsection|subsubsection|abil|inna|convic)\b")
    pos = 0
    while True:
        m = token.search(text, pos)
        if not m:
            break
        kind = m.group(1)
        if m.start() > 0 and text[m.start() - 1] == "{":
            # the macro's own newcommand definition, not a use of it
            pos = m.end()
            continue
        if kind in ("section", "subsection", "subsubsection"):
            (title,), pos = read_args(text, m.end(), 1)
            title = clean(title).rstrip(":").replace("★ ", "")
            cm = re.match(r"^(?:Conviction of\s+(.*)|(.*?)\s+Conviction)$", title)
            if cm:
                conviction = (cm.group(1) or cm.group(2)).strip()
                section = "Convictions"
                conviction_levels.setdefault(conviction, {})
            else:
                conviction = None
                section = title
            continue

        if kind == "convic":
            (levels, body), pos = read_args(text, m.end(), 2)
            assert conviction, "\\convic outside a conviction section"
            stages = [int(x) for x in levels.split("/")]
            body = clean(body)
            for stage, desc in split_description(body, stages).items():
                conviction_levels[conviction].setdefault(stage, []).append(desc)
            continue

        argc = 5 if kind == "abil" else 7
        args, pos = read_args(text, m.end(), argc)
        args = [clean(a) for a in args]
        if kind == "abil":
            name, usage, _cost, _req, desc = args
        else:
            name, usage, _cost, _req, area, duration, desc = args
            desc = f"Range/Area: {area}. Duration: {duration}. {desc}"
        family, stages = split_stages(name)
        key_base = slug(family)
        common = {
            "family": family,
            "section": section,
            "usage": usage,
            "activation": usage_to_activation(usage),
        }
        cost = usage_to_cost(usage)
        if cost:
            common["cost"] = cost
        if not stages:
            entries[key_base] = {"name": family, "stage": 1, **common, "description": desc}
            continue
        texts = split_description(desc, stages)
        for i, stage in enumerate(stages):
            key = f"{key_base}-{stage}"
            entry = {"name": f"{family} {ROMAN[stage]}", "stage": stage, **common, "description": texts[stage]}
            if i > 0:
                entry["requires"] = [f"{key_base}-{stages[i - 1]}"]
            entries[key] = entry

    # creating.tex "Convictions": levels run to 5 and start at 0, so every
    # level is a stage even where the book grants nothing new at it.
    for name, levels in conviction_levels.items():
        key_base = slug(name)
        ordered = list(range(min(min(levels), 1), 6))
        for i, stage in enumerate(ordered):
            entry = {
                "name": f"{name} {ROMAN[stage]}",
                "family": name,
                "stage": stage,
                "section": "Convictions",
                "usage": "passive",
                "activation": "passive",
                "description": " ".join(levels.get(stage, [])),
            }
            if i > 0:
                entry["requires"] = [f"{key_base}-{ordered[i - 1]}"]
            entries[f"{key_base}-{stage}"] = entry
    return entries


def render(entries: dict[str, dict]) -> str:
    lines = [
        "// Generated by tools/extract_abilities.py from the rulebook's abilities.tex —",
        "// do not edit by hand; re-run the script after a rulebook change.",
        "import type { AbilityInput } from './types'",
        "",
        "export const ABILITY_TEXT = {",
    ]
    for key, entry in entries.items():
        lines.append(f"  {json.dumps(key)}: {json.dumps(entry, ensure_ascii=False)},")
    lines += ["} satisfies Record<string, AbilityInput>", ""]
    return "\n".join(lines)


def main() -> None:
    entries = extract(RULEBOOK.read_text(encoding="utf-8"))
    OUT.write_text(render(entries), encoding="utf-8")
    print(f"wrote {len(entries)} entries to {OUT.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
