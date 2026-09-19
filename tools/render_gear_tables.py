"""Renders the app's gear catalogs as the rulebook's gear stattables.

Direction is app -> book: weapons.json, armors.json and items.json are the
authoring source, and this writes tools/out/gear-tables.tex holding one
`\\begin{stattable}` per book table, to be pasted over the tables in gear.tex
by hand. Every weapon table gains an Attack column naming its rows, and the
Shields table gains the columns of the shield's attack row.

What the app does not hold is carried over from the book's current tables:
which table a weapon sits in, and every price. A weapon the book has never
seen lands in a final "Unplaced Weapons" table, a missing price prints as
"?", and a book entry the app no longer has is reported and dropped.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

from rulebook import REPO_ROOT, RULEBOOK, read_arg, strip_comments

SOURCE = RULEBOOK / "gear.tex"
ASSETS = REPO_ROOT / "app" / "assets"
OUT = REPO_ROOT / "tools" / "out" / "gear-tables.tex"

SHIELDS_CAPTION = "Shields"
ARMORS_CAPTION = "Armors"
UNPLACED_CAPTION = "Unplaced Weapons"
UNPLACED_COLUMNS = ["Weapon", "RES", "Blunt", "Cut", "AP", "Hands", "Range", "Properties", "Price", "Bulk"]
UNPLACED_COLSPEC = "@{}lccccccp{2.4cm}cc@{}"
SHIELD_COLUMNS = ["Name", "Attack", "RES", "Blunt", "Cut", "Hand", "Range", "Properties",
                  "Burden Pen", "Cover", "Insulation", "Bulk", "Value"]
SHIELD_COLSPEC = "@{}llcccccp{2.2cm}ccccc@{}"
ARMOR_COLUMNS = ["Name", "RES", "Protection", "Insulation", "Deflection", "Burden Pen", "Price", "Bulk"]
ARMOR_COLSPEC = "@{}lccccccc@{}"

# gear.tex "Containers and Burden": the named bulk steps; larger stays numeric
BULK_WORDS = {0: "tiny", 1: "small", 2: "medium", 3: "large"}
LISTS = REPO_ROOT / "app" / "domain" / "lists.ts"

# gear.tex "Weapons Properties" lists Heavy between Hook and Piercing
HEAVY_PRECEDES = "piercing"
# gear.tex "Weapons Properties": "All weapon attacks are made out of metal,
# unless otherwise stated", and the Armors table heads its metal group "Metallic"
ASSUMED_MATERIAL = "metal"
MATERIAL_WORDS = {"metal": "Metallic"}

TINT = r"\rowcolor{fallowtint}"


class BookError(Exception):
    pass


@dataclass
class BookTable:
    caption: str
    colspec: str
    columns: list[str]
    entries: dict[str, dict[str, str]] = field(default_factory=dict)  # casefolded name -> first-row cells


def item_name(cell: str) -> str:
    """`\\textbf{Short Bow*}` -> `short bow`; the star marks a footnote, not the name."""
    cell = re.sub(r"\\textbf\{([^}]*)\}", r"\1", cell).strip().rstrip("*").strip()
    return cell.casefold()


def book_tables(text: str) -> dict[str, BookTable]:
    """Every stattable of the book, its header and the first row of each entry."""
    text = strip_comments(text)
    tables: dict[str, BookTable] = {}
    for m in re.finditer(r"\\begin\{stattable\}", text):
        caption, pos = read_arg(text, m.end())
        colspec, pos = read_arg(text, pos)
        end = text.index(r"\end{stattable}", pos)
        rows = [line.strip() for line in text[pos:end].splitlines() if "&" in line and not line.lstrip().startswith(r"\multicolumn")]
        if not rows:
            raise BookError(f"stattable {caption!r} has no rows")
        table = BookTable(caption, colspec, cells(rows[0]))
        for row in rows[1:]:
            values = cells(row)
            if len(values) != len(table.columns):
                raise BookError(f"stattable {caption!r}: row {row!r} has {len(values)} cells for {len(table.columns)} columns")
            if values[0]:
                table.entries[item_name(values[0])] = dict(zip(table.columns, values))
        tables[caption] = table
    return tables


def cells(row: str) -> list[str]:
    row = re.sub(r"\\\\(\[[^\]]*\])?\s*$", "", row)
    return [c.strip() for c in row.split("&")]


def price_of(tables: dict[str, BookTable], name: str) -> str:
    for table in tables.values():
        entry = table.entries.get(name.casefold())
        if entry:
            return entry.get("Price") or entry.get("Value") or "?"
    return "?"


def number(n: float) -> str:
    return str(int(n)) if float(n).is_integer() else str(n)


def signed(n: float) -> str:
    return "0" if n == 0 else f"+{number(n)}"


def penalty(n: float) -> str:
    """The catalogs store a penalty as a positive magnitude; the book prints it negative."""
    return "0" if n == 0 else f"-{number(n)}"


def bulk_word(bulk: int | None) -> str:
    if bulk is None:
        return "-"
    return BULK_WORDS.get(bulk, str(bulk))


def vocabulary(name: str) -> list[str]:
    """The members of an `as const` list in app/domain/lists.ts, in its order."""
    m = re.search(rf"export const {name} = \[(.*?)\] as const", LISTS.read_text(encoding="utf-8"), re.S)
    if not m:
        raise BookError(f"no {name} list in {LISTS.name}")
    return re.findall(r"'([^']*)'", m.group(1))


WEAPON_PROPERTIES = vocabulary("WEAPON_PROPERTIES")


def roman(degree: int) -> str:
    return "I" * degree


def heavy(attack: dict) -> str | None:
    """gear.tex "Heavy I/II/III": a bare degree keeps the normal attack, a range
    forbids it — `heavy II` for min 0, `heavy I-II` otherwise."""
    if "heavy" not in attack:
        return None
    low, high = attack["heavy"]["min"], attack["heavy"]["max"]
    return f"heavy {roman(high)}" if low == 0 else f"heavy {roman(low)}-{roman(high)}"


def properties(attack: dict) -> str:
    """The properties cell as the app prints it (getAttackPropertyLabels): STR
    first, the vocabulary's order with heavy in its slot, and a material the
    book would not assume last."""
    order = WEAPON_PROPERTIES.index
    listed = sorted(attack["properties"], key=order)
    cell = [f"STR {number(attack['STRreq'])}"] if "STRreq" in attack else []
    cell += [p for p in listed if order(p) < order(HEAVY_PRECEDES)]
    if (h := heavy(attack)) is not None:
        cell.append(h)
    cell += [p for p in listed if order(p) >= order(HEAVY_PRECEDES)]
    if attack["material"] != ASSUMED_MATERIAL:
        cell.append(attack["material"])
    return ", ".join(cell)


def ap(attack: dict) -> str:
    # gear.tex Ranged Weapons table prints AP as "4+4": cost, then reload
    return f"{number(attack['AP'])}+{number(attack['reload'])}" if "reload" in attack else number(attack["AP"])


def attack_cell(column: str, attack: dict) -> str | None:
    """The cell an attack row fills, or None when the column belongs to the item."""
    match column:
        case "Attack":
            return attack["name"]
        case "RES":
            return number(attack["RES"])
        case "Blunt" | "Cut":
            return number(attack[column.lower()])
        case "AP":
            return ap(attack)
        case "Hand" | "Hands":
            return attack["handed"]
        case "Range":
            return attack["range"]
        case "Properties":
            return properties(attack)
    return None


def item_cell(column: str, weapon: dict, price: str, bulk: int | None) -> str:
    """The cell an item fills on its first row; the shield columns only exist for shields."""
    shield = weapon.get("shield")
    match column:
        case "Weapon":
            return rf"\textbf{{{weapon['name']}}}"
        case "Name":
            # gear.tex "Shields": "Body shields are marked with * in the table"
            return rf"\textbf{{{weapon['name']}{'*' if shield and shield['body'] else ''}}}"
        case "Price" | "Value":
            return price
        case "Bulk":
            return bulk_word(bulk)
        case "Burden Pen":
            return penalty(shield["burdenPenalty"])
        case "Cover":
            return signed(shield["cover"])
        case "Insulation":
            return number(shield["insulation"])
    raise BookError(f"no source for column {column!r}")


def weapon_rows(columns: list[str], weapon: dict, price: str, bulk: int | None) -> list[list[str]]:
    rows = []
    for i, attack in enumerate(weapon["attacks"]):
        row = []
        for column in columns:
            cell = attack_cell(column, attack)
            if cell is None:
                cell = item_cell(column, weapon, price, bulk) if i == 0 else ""
            row.append(cell)
        rows.append(row)
    return rows


def render_table(caption: str, colspec: str, columns: list[str], items: list[list[list[str]]], spaced: bool) -> list[str]:
    """One stattable; `items` is a list of items, each a list of rows. Every
    other item is tinted, and `spaced` puts the book's 3pt gap and rule
    between items."""
    lines = [rf"\begin{{stattable}}{{{caption}}}{{{colspec}}}", " & ".join(columns) + r" \\", r"\midrule"]
    for i, rows in enumerate(items):
        if spaced and i > 0:
            lines.append(r"\midrule")
        for j, row in enumerate(rows):
            if i % 2 == 1:
                lines.append(TINT)
            gap = "[3pt]" if spaced and j == len(rows) - 1 and i < len(items) - 1 else ""
            lines.append(re.sub("  +", " ", " & ".join(row) + r" \\") + gap)
    lines.append(r"\end{stattable}")
    return lines


def with_attack_column(table: BookTable) -> tuple[list[str], str]:
    """The book's header and colspec with an Attack column after the first,
    added unless a previous render already left one there."""
    if table.columns[0] != "Weapon" or not table.colspec.startswith("@{}l"):
        raise BookError(f"stattable {table.caption!r} does not start with a Weapon column")
    if table.columns[1:2] == ["Attack"]:
        return table.columns, table.colspec
    return [table.columns[0], "Attack", *table.columns[1:]], "@{}ll" + table.colspec[len("@{}l"):]


def bulks(items: dict) -> dict[tuple[str, str], int]:
    """(type, refId) -> bulk, from the item catalog that links to the gear catalogs."""
    return {(item["type"], item["refId"]): item["bulk"] for item in items.values() if item.get("refId")}


def armor_group(armor: dict) -> tuple[str, ...]:
    """gear.tex "Armors" groups its rows by material and construction: "Fiber",
    "Metallic", "Metallic, Rigid"."""
    return (armor["material"], *armor["properties"])


def group_label(group: tuple[str, ...]) -> str:
    return ", ".join(MATERIAL_WORDS.get(t, t.capitalize()) for t in group)


def render_armors(armors: dict, tables: dict[str, BookTable], bulk_of: dict[tuple[str, str], int]) -> list[str]:
    columns, colspec = ARMOR_COLUMNS, ARMOR_COLSPEC
    if ARMORS_CAPTION in tables:
        columns, colspec = tables[ARMORS_CAPTION].columns, tables[ARMORS_CAPTION].colspec
    lines = [rf"\begin{{stattable}}{{{ARMORS_CAPTION}}}{{{colspec}}}", " & ".join(columns) + r" \\"]
    groups: dict[tuple, list[tuple[str, dict]]] = {}
    for key, armor in armors.items():
        groups.setdefault(armor_group(armor), []).append((key, armor))
    i = 0
    for group, members in groups.items():
        lines += [r"\midrule", rf"\multicolumn{{{len(columns)}}}{{l}}{{\textbf{{\textit{{{group_label(group)}}}}}}} \\", r"\midrule"]
        for key, armor in members:
            row = []
            for column in columns:
                match column:
                    case "Name":
                        row.append(armor["name"])
                    case "RES":
                        row.append(number(armor["RES"]))
                    case "Protection":
                        row.append(number(armor["protection"]))
                    case "Insulation":
                        row.append(number(armor["INS"]))
                    case "Deflection":
                        row.append(signed(armor["deflection"]))
                    case "Burden Pen":
                        row.append(penalty(armor["burdenPenalty"]))
                    case "Price":
                        row.append(price_of(tables, armor["name"]))
                    case "Bulk":
                        row.append(bulk_word(bulk_of.get(("armor", key))))
                    case _:
                        raise BookError(f"stattable {ARMORS_CAPTION!r}: no source for column {column!r}")
            if i % 2 == 1:
                lines.append(TINT)
            lines.append(" & ".join(row) + r" \\")
            i += 1
    lines.append(r"\end{stattable}")
    return lines


def render(weapons: dict, armors: dict, items: dict, tables: dict[str, BookTable]) -> tuple[str, list[str]]:
    bulk_of = bulks(items)
    notes: list[str] = []
    placed: dict[str, list[dict]] = {}
    unplaced: list[dict] = []
    shields: list[dict] = []
    for weapon in weapons.values():
        if "shield" in weapon:
            shields.append(weapon)
            continue
        caption = next((t.caption for t in tables.values() if weapon["name"].casefold() in t.entries and t.columns[0] == "Weapon"), None)
        (placed.setdefault(caption, []) if caption else unplaced).append(weapon)

    chunks: list[list[str]] = []
    for table in tables.values():
        if table.columns[0] != "Weapon":
            continue
        columns, colspec = with_attack_column(table)
        rows = [weapon_rows(columns, w, price_of(tables, w["name"]), bulk_of.get(("weapon", w["name"]))) for w in placed.get(table.caption, [])]
        chunks.append(render_table(table.caption, colspec, columns, rows, spaced=True))
        dropped = sorted(set(table.entries) - {w["name"].casefold() for w in weapons.values()})
        notes += [f"{table.caption}: book entry {name!r} is not in weapons.json and was dropped" for name in dropped]
    if unplaced:
        columns = [UNPLACED_COLUMNS[0], "Attack", *UNPLACED_COLUMNS[1:]]
        rows = [weapon_rows(columns, w, "?", bulk_of.get(("weapon", w["name"]))) for w in unplaced]
        chunks.append(render_table(UNPLACED_CAPTION, "@{}ll" + UNPLACED_COLSPEC[len("@{}l"):], columns, rows, spaced=True))
        notes += [f"{w['name']!r} is in no book table and was placed under {UNPLACED_CAPTION!r}" for w in unplaced]

    rows = [weapon_rows(SHIELD_COLUMNS, w, price_of(tables, w["name"]), bulk_of.get(("weapon", w["name"]))) for w in shields]
    chunks.append(render_table(SHIELDS_CAPTION, SHIELD_COLSPEC, SHIELD_COLUMNS, rows, spaced=False))
    if SHIELDS_CAPTION in tables:
        dropped = sorted(set(tables[SHIELDS_CAPTION].entries) - {w["name"].casefold() for w in shields})
        notes += [f"{SHIELDS_CAPTION}: book entry {name!r} is not in weapons.json and was dropped" for name in dropped]

    chunks.append(render_armors(armors, tables, bulk_of))
    if ARMORS_CAPTION in tables:
        dropped = sorted(set(tables[ARMORS_CAPTION].entries) - {a["name"].casefold() for a in armors.values()})
        notes += [f"{ARMORS_CAPTION}: book entry {name!r} is not in armors.json and was dropped" for name in dropped]

    for weapon in weapons.values():
        if price_of(tables, weapon["name"]) == "?":
            notes.append(f"{weapon['name']!r}: no price in the book, printed as '?'")
    for armor in armors.values():
        if price_of(tables, armor["name"]) == "?":
            notes.append(f"{armor['name']!r}: no price in the book, printed as '?'")

    header = [
        "% Generated by tools/render_gear_tables.py from app/assets/{weapons,armors,items}.json.",
        "% Prices and table membership are carried over from the book's current gear.tex;",
        "% paste each table over its counterpart by hand.",
    ]
    body = "\n".join(header + [""] + ["\n".join(chunk) + "\n" for chunk in chunks])
    return body, notes


def load(name: str) -> dict:
    return json.loads((ASSETS / name).read_text(encoding="utf-8"))


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else OUT
    try:
        tables = book_tables(SOURCE.read_text(encoding="utf-8"))
        body, notes = render(load("weapons.json"), load("armors.json"), load("items.json"), tables)
    except (BookError, ValueError, KeyError) as e:
        sys.exit(f"{type(e).__name__}: {e}")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(body, encoding="utf-8")
    print(f"wrote {out.relative_to(REPO_ROOT) if out.is_relative_to(REPO_ROOT) else out}")
    for note in notes:
        print(f"  note: {note}")


if __name__ == "__main__":
    main()
