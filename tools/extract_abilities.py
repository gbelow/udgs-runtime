"""Extracts the ability catalog from the rulebook's abilities.tex.

Reads every active `\\abil{Name}{key=value, ...}` block and writes
app/domain/abilities.generated.ts: one entry per stage, with the book's
name, section, usage, price, talent, requirements and effect text. The
three short fields follow the grammar documented beside the macro in
main.tex and are parsed strictly: anything off-grammar stops the run with
the book's line number rather than degrading to prose. What each stage does
to a number is authored by hand in app/domain/abilities.ts, keyed by the ids
this script emits — so re-running it after a rulebook edit refreshes the
book's side without touching the numbers.

Ids are `<family-slug>` for a single-stage ability and `<family-slug>-<n>` for
stage n of a multi-stage one. Per-level values (`a|b|c`) hand each stage its
own member; a stage's effect text is the `I. II. III.` segment addressed to
it when the text is marked that way, and the whole text otherwise.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from rulebook import REPO_ROOT, RULEBOOK, clean, line_of, macro_names, read_arg, slug, split_keys, strip_comments

SOURCE = RULEBOOK / "abilities.tex"
OUT = REPO_ROOT / "app" / "domain" / "abilities.generated.ts"

ROMAN = ["I", "II", "III", "IV", "V"]
STAGE = r"(?:I|II|III|IV|V)"
TALENTS = ("CON", "DEX", "INT", "SPI")
ATTRIBUTES = ("STR", "AGI", "STA")
ZERO_COST = {"AP": 0, "STA": 0, "exhaustion": 0, "IL": 0, "ET": 0}

# main.tex "Ability entry" grammar
COST_UNIT = r"(?:\d+ AP|\d+ STA|\d+ AP \+ \d+ STA|attack(?: \+ \d+ STA)?|\d+ ET|\d+ IL)"
USAGE_RE = re.compile(
    rf"^(?:passive|(?P<action>{COST_UNIT})|reaction(?:, (?P<reaction>{COST_UNIT}))?"
    rf"|sustained, (?P<sustained>{COST_UNIT})/turn|full turn|ritual)$"
)
PRICE_RE = re.compile(rf"^(?P<amount>-?\d+(?:\|-?\d+)*) (?P<unit>XP|Karma)(?:, (?P<talent>{'|'.join(TALENTS)}) (?P<level>\d+(?:\|\d+)*))?$")
LEVEL_RE = re.compile(r"^(?P<name>[A-Z][A-Za-z' ]*?) (?P<level>\d+(?:\|\d+)*)$")
ATTRIBUTE_RE = re.compile(rf"^(?P<name>{'|'.join(ATTRIBUTES)}) (?P<op>>=|<=|>|<) (?P<value>\d+)$")
NAME_RE = re.compile(rf"^(?P<family>.+?)(?: (?P<stages>{STAGE}(?:\|{STAGE})+))?$")
REFERENCE_RE = re.compile(rf"^(?P<family>[A-Z][A-Za-z' ]*?)(?: (?P<stage>{STAGE}))?$")


class BookError(Exception):
    pass


def per_level(value: str, stages: int, what: str) -> list[str]:
    """'2|4|6' -> one member per stage; a single value repeats for every stage."""
    members = value.split("|")
    if len(members) == 1:
        return members * stages
    if len(members) != stages:
        raise BookError(f"{what} {value!r} lists {len(members)} levels for {stages} stages")
    return members


def parse_cost_unit(unit: str | None) -> dict[str, int]:
    cost = dict(ZERO_COST)
    for field, pattern in (("AP", r"(\d+) AP"), ("STA", r"(\d+) STA"), ("ET", r"(\d+) ET"), ("IL", r"(\d+) IL")):
        m = re.search(pattern, unit or "")
        if m:
            cost[field] = int(m.group(1))
    return cost


def parse_usage(usage: str) -> tuple[str, dict[str, int], list[dict]]:
    """The book's usage word decides how the domain holds the ability: always
    on, fired for a price, or switched on and paid at every round change."""
    m = USAGE_RE.match(usage)
    if not m:
        raise BookError(f"usage {usage!r} is off-grammar")
    if usage == "passive":
        return "passive", dict(ZERO_COST), []
    if m.group("sustained"):
        upkeep = {"type": "cost", "trigger": "end_round", "effect": parse_cost_unit(m.group("sustained"))}
        return "toggle", dict(ZERO_COST), [upkeep]
    return "active", parse_cost_unit(m.group("action") or m.group("reaction")), []


def parse_price(price: str, stages: int) -> list[dict]:
    """'6 XP, DEX 2|4|6' -> per stage {XPcost, karma, talent}."""
    m = PRICE_RE.match(price)
    if not m:
        raise BookError(f"cost {price!r} is off-grammar")
    amounts = [int(a) for a in per_level(m.group("amount"), stages, "price")]
    if m.group("unit") == "Karma":
        if m.group("talent"):
            raise BookError(f"cost {price!r}: karma prices have no talent")
        return [{"XPcost": 0, "karma": a, "talent": []} for a in amounts]
    if not m.group("talent"):
        if any(amounts):
            raise BookError(f"cost {price!r}: an XP price names its talent")
        return [{"XPcost": 0, "karma": 0, "talent": []} for _ in amounts]
    levels = [int(l) for l in per_level(m.group("level"), stages, "talent level")]
    return [{"XPcost": a, "karma": 0, "talent": [{"property": m.group("talent"), "level": l}]} for a, l in zip(amounts, levels)]


class Catalog:
    """Names the requirements grammar can point at, gathered before any
    requirement is read so a reference is checked against the whole book."""

    def __init__(self, abilities: dict[str, list[str]], spells: set[str], gear: set[str]):
        self.abilities = abilities  # family -> stage roman numerals ([] for single-stage)
        self.spells = spells
        self.gear = gear

    def ability_key(self, reference: str) -> str | None:
        m = REFERENCE_RE.match(reference)
        if not m or m.group("family") not in self.abilities:
            return None
        family, stage = m.group("family"), m.group("stage")
        stages = self.abilities[family]
        if not stages:
            if stage:
                raise BookError(f"{reference!r}: {family!r} has no levels")
            return slug(family)
        if stage and stage not in stages:
            raise BookError(f"{reference!r}: {family!r} has no level {stage}")
        # abilities.tex "Requirements": a bare family name asks for its first level
        return f"{slug(family)}-{ROMAN.index(stage or stages[0]) + 1}"


def parse_requirement(item: str, stages: int, catalog: Catalog) -> list[dict]:
    """One item of the requirements list, per stage."""
    negated = item.startswith("not ")
    item = item[4:] if negated else item
    if item[:1].islower() or item[:1].isdigit():
        return [{"kind": "condition", "name": item, "not": negated}] * stages
    m = ATTRIBUTE_RE.match(item)
    if m:
        return [{"kind": "attribute", "name": m.group("name"), "op": m.group("op"), "level": int(m.group("value")), "not": negated}] * stages
    m = LEVEL_RE.match(item)
    if m:
        return [{"kind": "trainable", "name": m.group("name"), "level": int(l), "not": negated}
                for l in per_level(m.group("level"), stages, f"requirement {item!r}")]
    key = catalog.ability_key(item)
    if key:
        return [{"kind": "ability", "name": key, "not": negated}] * stages
    if item in catalog.spells:
        return [{"kind": "spell", "name": slug(item), "not": negated}] * stages
    if item in catalog.gear:
        return [{"kind": "gear", "name": item, "not": negated}] * stages
    raise BookError(f"requirement {item!r} names nothing in the book")


def parse_requirements(text: str, stages: int, catalog: Catalog) -> list[list[list[dict]]]:
    """'A, B or C' -> per stage [[A], [B, C]]: every outer item is needed, any
    inner alternative satisfies it."""
    if not text:
        return [[] for _ in range(stages)]
    per_stage: list[list[list[dict]]] = [[] for _ in range(stages)]
    for item in text.split(","):
        alternatives = [parse_requirement(alt.strip(), stages, catalog) for alt in re.split(r"\bor\b", item.strip())]
        for stage in range(stages):
            per_stage[stage].append([alt[stage] for alt in alternatives])
    return per_stage


def split_effect(text: str, stages: int) -> list[str]:
    """Hands each stage its `I. … II. …` segment when the text is marked that
    way; otherwise the whole text, with every `a|b|c` collapsed to the stage's
    own value."""
    marks = re.findall(rf"(?:^|\s)({STAGE})\.\s", text)
    if marks:
        if marks != ROMAN[:stages]:
            raise BookError(f"effect segments {marks} do not match {stages} stages")
        parts = re.split(rf"(?:^|\s){STAGE}\.\s+", text)
        lead = parts[0].strip()
        return [(lead + " " + part.strip()).strip() for part in parts[1:]]
    if stages == 1:
        return [text]
    out = []
    for stage in range(stages):
        def pick(m: re.Match) -> str:
            members = m.group(0).split("|")
            if len(members) != stages:
                raise BookError(f"effect value {m.group(0)!r} lists {len(members)} levels for {stages} stages")
            return members[stage]
        out.append(re.sub(r"(?<![\d|])\d+(?:\|\d+)+(?![\d|])", pick, text))
    return out


def scan(text: str) -> list[tuple[int, str, str, dict[str, str]]]:
    """(line, section, name, fields) for every active \\abil, in book order."""
    entries = []
    section = ""
    token = re.compile(r"\\(section|subsection|subsubsection|abil)\{")
    pos = 0
    while True:
        m = token.search(text, pos)
        if not m:
            break
        if m.group(1) != "abil":
            title, pos = read_arg(text, m.end() - 1)
            section = clean(title).rstrip(":").replace("★ ", "")
            continue
        line = line_of(text, m.start())
        try:
            name, pos = read_arg(text, m.end() - 1)
            body, pos = read_arg(text, pos)
            entries.append((line, section, clean(name), split_keys(body)))
        except ValueError as e:
            raise BookError(f"abilities.tex:{line}: {e}") from None
    return entries


def extract(text: str) -> dict[str, dict]:
    text = strip_comments(text)
    scanned = scan(text)
    families: dict[str, list[str]] = {}
    for line, _, name, _ in scanned:
        m = NAME_RE.match(name.replace("★ ", ""))
        stages = m.group("stages").split("|") if m.group("stages") else []
        if stages and stages != ROMAN[: len(stages)]:
            raise BookError(f"abilities.tex:{line}: levels {m.group('stages')!r} do not run I|II|III")
        if m.group("family") in families:
            raise BookError(f"abilities.tex:{line}: duplicate ability {m.group('family')!r}")
        families[m.group("family")] = stages
    catalog = Catalog(families, macro_names(RULEBOOK / "spells.tex", "spell"), macro_names(RULEBOOK / "gear.tex", "gitem"))

    entries: dict[str, dict] = {}
    for line, section, name, fields in scanned:
        try:
            unknown = set(fields) - {"usage", "cost", "requirements", "range", "duration", "effect"}
            if unknown:
                raise BookError(f"unknown keys {sorted(unknown)}")
            for key in ("usage", "cost", "effect"):
                if key not in fields:
                    raise BookError(f"missing {key}")
            m = NAME_RE.match(name.replace("★ ", ""))
            family = ("★ " if "★" in name else "") + m.group("family")
            stages = families[m.group("family")]
            count = max(1, len(stages))
            activation, cost, effect = parse_usage(fields["usage"])
            prices = parse_price(fields["cost"], count)
            requirements = parse_requirements(fields.get("requirements", ""), count, catalog)
            texts = split_effect(fields["effect"], count)
            if ("range" in fields) != ("duration" in fields):
                raise BookError("range and duration come together")
            if "range" in fields:
                texts = [f"Range/Area: {fields['range']}. Duration: {fields['duration']}. {t}" for t in texts]
        except BookError as e:
            raise BookError(f"abilities.tex:{line}: {name}: {e}") from None
        for i in range(count):
            key = slug(m.group("family")) + (f"-{i + 1}" if stages else "")
            requires = [alt["name"] for group in requirements[i] for alt in group if alt["kind"] == "ability" and not alt["not"]]
            if i > 0:
                requires.insert(0, f"{slug(m.group('family'))}-{i}")
            entry = {
                "name": f"{family} {stages[i]}" if stages else family,
                "family": family,
                "stage": i + 1,
                "section": section,
                "usage": fields["usage"],
                "activation": activation,
                "cost": cost,
                **prices[i],
                "requires": requires,
                "requirements": requirements[i],
                "description": texts[i],
            }
            if effect:
                entry["effect"] = effect
            entries[key] = entry
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
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else SOURCE
    try:
        entries = extract(source.read_text(encoding="utf-8"))
    except BookError as e:
        sys.exit(str(e))
    OUT.write_text(render(entries), encoding="utf-8")
    print(f"wrote {len(entries)} entries to {OUT.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
