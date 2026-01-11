"""Extracts a JSON-LD knowledge graph from the RPG Below LaTeX rulebook.

Notes / alignment with repo rules:
- We do NOT treat LaTeX structure (chapter/section/subsection) as official definitions.
- We DO treat explicit definitional prose patterns and named Ability/Spell blocks as nodes.
- Abilities/spells are assumed unimplemented in code (codeMapping omitted + @status=unimplemented),
  but core system rules that are implemented in /app/domain get codeMapping.
- Produces/merges:
  - rule_graph.json in repo root
  - dangling_references.json in repo root
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple


REPO_ROOT = Path(__file__).resolve().parents[1]
RULEBOOK_ROOT = (REPO_ROOT / ".." / "RPG_Below_v7_en").resolve()
RULEBOOK_MAIN = RULEBOOK_ROOT / "main.tex"

OUT_RULE_GRAPH = REPO_ROOT / "rule_graph.json"
OUT_DANGLING = REPO_ROOT / "dangling_references.json"

DOMAIN_ROOT = REPO_ROOT / "app" / "domain"


def _slugify(name: str) -> str:
    s = name.strip().lower()
    s = re.sub(r"\s+", " ", s)
    s = s.replace("'", "")
    s = re.sub(r"[^a-z0-9 _/-]+", "", s)
    s = s.replace("/", "_")
    s = s.replace("-", "_")
    s = s.replace(" ", "_")
    s = re.sub(r"_+", "_", s).strip("_")
    return s or "unnamed"


def urn(node_type: str, name: str) -> str:
    return f"urn:ttrpg:{node_type}:{_slugify(name)}"


@dataclass
class Node:
    id: str
    type: str
    name: str
    source: Optional[str] = None
    depends_on: Set[str] = None
    modifies: Set[str] = None
    formula: Optional[str] = None
    code_mapping: Optional[str] = None
    status: Optional[str] = None
    tags: List[str] = None
    description: Optional[str] = None

    def __post_init__(self) -> None:
        if self.depends_on is None:
            self.depends_on = set()
        if self.modifies is None:
            self.modifies = set()
        if self.tags is None:
            self.tags = []

    def to_jsonld(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "@id": self.id,
            "@type": self.type,
            "name": self.name,
            "dependsOn": sorted(self.depends_on),
            "modifies": sorted(self.modifies),
        }
        if self.formula:
            data["formula"] = self.formula
        if self.source:
            data["source"] = self.source
        if self.code_mapping:
            data["codeMapping"] = self.code_mapping
        if self.status:
            data["@status"] = self.status
        if self.tags:
            data["tags"] = self.tags
        if self.description:
            data["description"] = self.description
        return data


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def parse_includes(main_tex: str) -> List[str]:
    includes = re.findall(r"\\include\{([^}]+)\}", main_tex)
    # Exclude comments: naive but adequate for this repo.
    return [inc.strip() for inc in includes if inc.strip() and not inc.strip().startswith("%")]


def load_rulebook_files() -> List[Tuple[str, str]]:
    main = read_text(RULEBOOK_MAIN)
    includes = parse_includes(main)
    out: List[Tuple[str, str]] = []
    for inc in includes:
        p = RULEBOOK_ROOT / f"{inc}.tex"
        if not p.exists():
            continue
        out.append((str(p.relative_to(RULEBOOK_ROOT)).replace("\\", "/"), read_text(p)))
    return out


# --- Extraction patterns ---


ABILITY_RE = re.compile(r"\\abil\{(?P<name>[^}]+)\}\{(?P<usage>[^}]*)\}\{(?P<cost>[^}]*)\}\{(?P<req>[^}]*)\}\{(?P<desc>[^}]*)\}", re.DOTALL)
INNA_RE = re.compile(r"\\inna\{(?P<name>[^}]+)\}\{(?P<usage>[^}]*)\}\{(?P<cost>[^}]*)\}\{(?P<req>[^}]*)\}\{(?P<range>[^}]*)\}\{(?P<dur>[^}]*)\}\{(?P<effect>[^}]*)\}", re.DOTALL)
SPELL_RE = re.compile(r"\\spell\{(?P<name>[^}]+)\}\{(?P<cost>[^}]*)\}\{(?P<talent>[^}]*)\}\{(?P<req>[^}]*)\}\{(?P<tn>[^}]*)\}\{(?P<range>[^}]*)\}\{(?P<stype>[^}]*)\}\{(?P<dur>[^}]*)\}\{(?P<effect>[^}]*)\}", re.DOTALL)


def strip_tex(s: str) -> str:
    # Very light cleanup: remove LaTeX commands and collapse whitespace.
    s = re.sub(r"%.*", "", s)
    s = re.sub(r"\\\\", " ", s)
    s = re.sub(r"\\textbf\{([^}]*)\}", r"\1", s)
    s = re.sub(r"\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{[^}]*\})?", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def extract_abilities(file_rel: str, text: str) -> List[Node]:
    nodes: List[Node] = []

    for m in ABILITY_RE.finditer(text):
        name = strip_tex(m.group("name"))
        desc = strip_tex(m.group("desc"))
        n = Node(
            id=urn("mechanic", name),
            type="Mechanic",
            name=name,
            source=file_rel,
            status="unimplemented",
            tags=["ability"],
            description=desc,
        )
        nodes.append(n)

    # Treat \inna as ability too (per your instruction: only ability vs spell)
    for m in INNA_RE.finditer(text):
        name = strip_tex(m.group("name"))
        effect = strip_tex(m.group("effect"))
        n = Node(
            id=urn("mechanic", name),
            type="Mechanic",
            name=name,
            source=file_rel,
            status="unimplemented",
            tags=["ability"],
            description=effect,
        )
        nodes.append(n)

    for m in SPELL_RE.finditer(text):
        name = strip_tex(m.group("name"))
        effect = strip_tex(m.group("effect"))
        n = Node(
            id=urn("mechanic", name),
            type="Mechanic",
            name=name,
            source=file_rel,
            status="unimplemented",
            tags=["spell"],
            description=effect,
        )
        nodes.append(n)

    return nodes


DEF_COLON_RE = re.compile(
    r"\\textbf\{\s*(?P<term>[^}:]{2,80})\s*:\s*\}\s*(?P<def>[^\\\n]+)",
    re.MULTILINE,
)


def extract_colon_definitions(file_rel: str, text: str) -> List[Tuple[str, str]]:
    out: List[Tuple[str, str]] = []
    for m in DEF_COLON_RE.finditer(text):
        term = strip_tex(m.group("term"))
        d = strip_tex(m.group("def"))
        if not term or term.lower() in {"usage", "cost", "talent", "requirements", "description", "effect"}:
            continue
        if len(term) < 2:
            continue
        out.append((term, d))
    return out


INLINE_MATH_RE = re.compile(r"\$(?P<math>[^$]+)\$|\\\((?P<math2>[^)]+)\\\)")


def find_formulas(s: str) -> List[str]:
    out: List[str] = []
    for m in INLINE_MATH_RE.finditer(s):
        v = m.group("math") or m.group("math2")
        if v:
            out.append(strip_tex(v))
    return out


# --- Domain mapping ---


EXPORT_FN_RE = re.compile(r"export\s+function\s+(?P<name>[A-Za-z0-9_]+)\s*\(")


def build_domain_symbol_index() -> Dict[str, str]:
    """Map symbol -> path#symbol for exported functions/constants.

    We only need a lightweight mapping for codeMapping.
    """
    symbol_map: Dict[str, str] = {}
    for p in DOMAIN_ROOT.rglob("*.ts"):
        rel = str(p.relative_to(REPO_ROOT)).replace("\\", "/")
        txt = read_text(p)
        for m in re.finditer(r"export\s+function\s+([A-Za-z0-9_]+)\s*\(", txt):
            sym = m.group(1)
            symbol_map[sym] = f"{rel}#{sym}"
        for m in re.finditer(r"export\s+const\s+([A-Za-z0-9_]+)\s*=", txt):
            sym = m.group(1)
            symbol_map.setdefault(sym, f"{rel}#{sym}")
    return symbol_map


# --- Graph bootstrapping for code-known “core” rules ---


def build_core_domain_nodes(symbol_index: Dict[str, str]) -> List[Node]:
    """Create nodes that are clearly implemented in code regardless of rulebook extraction.

    This ensures the graph includes the domain’s authoritative mechanics (e.g. effective RES/TGH/INS).
    """

    nodes: List[Node] = []

    # Base characteristics (stored)
    base_fields = [
        ("STR", "attribute"),
        ("AGI", "attribute"),
        ("STA", "attribute"),
        ("CON", "attribute"),
        ("INT", "attribute"),
        ("SPI", "attribute"),
        ("DEX", "attribute"),
        ("size", "attribute"),
        ("melee", "attribute"),
        ("ranged", "attribute"),
        ("detection", "attribute"),
        ("spellcast", "attribute"),
        ("conviction1", "attribute"),
        ("conviction2", "attribute"),
        ("devotion", "attribute"),
    ]
    for field, t in base_fields:
        nodes.append(
            Node(
                id=urn(t, field),
                type="Attribute",
                name=field,
                code_mapping="app/domain/types.ts#CharacteristicsSchema",
                description="Stored/base characteristic value on Character.characteristics",
            )
        )

    # Base additive terms for wound thresholds
    for base in ["RES", "TGH", "INS"]:
        nodes.append(
            Node(
                id=urn("derivedvalue", f"{base}_base"),
                type="DerivedValue",
                name=f"{base}_base",
                code_mapping="app/domain/types.ts#CharacteristicsSchema",
                description=f"Stored/base additive term for {base} (effective computed via selector)",
            )
        )

    # SM/DM derived from size
    if "getSM" in symbol_index:
        n = Node(
            id=urn("derivedvalue", "sm"),
            type="DerivedValue",
            name="SM",
            depends_on={urn("attribute", "size")},
            code_mapping=symbol_index["getSM"],
        )
        nodes.append(n)
    if "getDM" in symbol_index:
        n = Node(
            id=urn("derivedvalue", "dm"),
            type="DerivedValue",
            name="DM",
            depends_on={urn("attribute", "size")},
            code_mapping=symbol_index["getDM"],
        )
        nodes.append(n)

    # Effective RES/TGH/INS
    eff_map = {
        "RES": "getRES",
        "TGH": "getTGH",
        "INS": "getINS",
    }
    for stat, fn in eff_map.items():
        if fn not in symbol_index:
            continue
        nodes.append(
            Node(
                id=urn("derivedvalue", stat),
                type="DerivedValue",
                name=stat,
                depends_on={
                    urn("attribute", "str"),
                    urn("derivedvalue", f"{stat}_base"),
                    urn("derivedvalue", "dm"),
                },
                formula=f"floor((0.5 * STR + {stat}_base) * DM)",
                code_mapping=symbol_index[fn],
            )
        )

    # Gear penalty
    if "getGearPenalties" in symbol_index:
        nodes.append(
            Node(
                id=urn("derivedvalue", "gear_penalty"),
                type="DerivedValue",
                name="Gear Penalty",
                depends_on=set(),
                code_mapping=symbol_index["getGearPenalties"],
            )
        )

    # Movement derived values
    for mname, fn, formula in [
        # In code the additive term is the stored value in character.movement.{run|jump|stand}
        ("run_movement", "getRunMovement", "floor((AGI - gear_penalty) / 3) + run"),
        ("jump_movement", "getJumpMovement", "floor((AGI - gear_penalty) / 4) + jump"),
        ("stand_cost", "getStandMovement", "5 - floor((AGI - gear_penalty) / 5) + stand"),
    ]:
        if fn in symbol_index:
            nodes.append(
                Node(
                    id=urn("derivedvalue", mname),
                    type="DerivedValue",
                    name=mname,
                    formula=formula,
                    code_mapping=symbol_index[fn],
                )
            )

    # Action surge mechanic
    if "actionSurge" in symbol_index:
        nodes.append(
            Node(
                id=urn("mechanic", "action_surge"),
                type="Mechanic",
                name="Action Surge",
                depends_on={urn("derivedvalue", "gear_penalty")},
                formula="cost = 3 + floor(gear_penalty / 3); effect: STA -= cost; AP += 6",
                code_mapping=symbol_index["actionSurge"],
            )
        )

    # Rest mechanic (implemented)
    if "restCharacter" in symbol_index:
        nodes.append(
            Node(
                id=urn("mechanic", "rest_character"),
                type="Mechanic",
                name="Rest (Character)",
                depends_on={urn("attribute", "sta")},
                formula="STA += floor(STA_base / 4); AP -= 4",
                code_mapping=symbol_index["restCharacter"],
            )
        )

    return nodes


def detect_dependencies(nodes: Dict[str, Node], dangling: List[Dict[str, Any]]) -> None:
    """Populate dependsOn/modifies by looking for mentions of known game terms.

    Important: this is intentionally conservative.
    - We only infer dependencies on core stats/resources (Attribute/DerivedValue + a few core mechanics)
      to avoid substring-driven false positives.
    - We log dangling references only for terms that look like game terms (ALLCAPS acronyms or
      recurring Title-Case multiword phrases), with stopword filtering.
    """

    # --- Ensure core resources exist (so reference mapping is stable) ---
    if urn("derivedvalue", "ap") not in nodes:
        nodes[urn("derivedvalue", "ap")] = Node(
            id=urn("derivedvalue", "ap"),
            type="DerivedValue",
            name="AP",
            code_mapping="app/domain/types.ts#ResourcesSchema",
            description="Action Points resource",
        )
    if urn("derivedvalue", "sta") not in nodes:
        nodes[urn("derivedvalue", "sta")] = Node(
            id=urn("derivedvalue", "sta"),
            type="DerivedValue",
            name="STA",
            code_mapping="app/domain/types.ts#ResourcesSchema",
            description="Stamina resource",
        )

    # --- Curated reference aliases for dependency inference ---
    # Only infer dependencies to these (plus their canonical nodes).
    alias_to_id: Dict[str, str] = {
        # Attributes
        "STR": urn("attribute", "str"),
        "Strength": urn("attribute", "str"),
        "AGI": urn("attribute", "agi"),
        "Agility": urn("attribute", "agi"),
        "CON": urn("attribute", "con"),
        "Constitution": urn("attribute", "con"),
        "INT": urn("attribute", "int"),
        "Intelligence": urn("attribute", "int"),
        "DEX": urn("attribute", "dex"),
        "Dexterity": urn("attribute", "dex"),
        "SPI": urn("attribute", "spi"),
        "Spirit": urn("attribute", "spi"),
        "STA": urn("attribute", "sta"),  # characteristic
        # Derived / resources
        "AP": urn("derivedvalue", "ap"),
        "Action Points": urn("derivedvalue", "ap"),
        "DM": urn("derivedvalue", "dm"),
        "SM": urn("derivedvalue", "sm"),
        "RES": urn("derivedvalue", "res"),
        "TGH": urn("derivedvalue", "tgh"),
        "INS": urn("derivedvalue", "ins"),
        "Gear Penalty": urn("derivedvalue", "gear_penalty"),
        "Armor Penalty": urn("derivedvalue", "gear_penalty"),
        "Running Speed": urn("derivedvalue", "run_movement"),
        "Jump": urn("derivedvalue", "jump_movement"),
        "Stand": urn("derivedvalue", "stand_cost"),
        # Common difficulty terms (often referenced in formulas)
        "DL": urn("keyword", "dl"),
        "DC": urn("keyword", "dc"),
        "TN": urn("keyword", "tn"),
    }

    # Ensure DL/DC/TN nodes exist if referenced (best-effort)
    for short, label in [("dl", "DL"), ("dc", "DC"), ("tn", "TN")]:
        kid = urn("keyword", short)
        if kid not in nodes:
            nodes[kid] = Node(
                id=kid,
                type="Keyword",
                name=label,
                status="unimplemented",
                description="Difficulty / target metric (extracted as shorthand term)",
            )

    # --- Known term index (for quick "is this already in graph" checks) ---
    # Build AFTER the best-effort additions above, so terms like DC/DL/TN are considered known.
    known_names: Set[str] = set()
    for n in nodes.values():
        if n.name:
            known_names.add(n.name.strip().lower())
            # common plural normalization
            if n.name.strip().lower().endswith("s"):
                known_names.add(n.name.strip().lower().rstrip("s"))

    # Treat our curated aliases as known terms too (prevents false dangling like "Action Points").
    for alias in alias_to_id.keys():
        known_names.add(alias.strip().lower())
        if alias.strip().lower().endswith("s"):
            known_names.add(alias.strip().lower().rstrip("s"))

    # Build regex patterns once.
    ref_patterns: List[Tuple[re.Pattern[str], str]] = []
    for alias, tid in alias_to_id.items():
        if tid not in nodes:
            # If a canonical node doesn't exist yet, skip; graph will still contain the text.
            continue
        escaped = re.escape(alias)
        # Acronyms should be case-sensitive, others case-insensitive.
        if re.fullmatch(r"[A-Z]{2,5}", alias):
            pat = re.compile(rf"\b{escaped}\b")
        else:
            pat = re.compile(rf"\b{escaped}\b", re.IGNORECASE)
        ref_patterns.append((pat, tid))

    # For modifies, only consider core stats/resources.
    mod_verbs = re.compile(
        r"\b(increases|decreases|reduces|grants|removes|adds|subtracts|restores|spends|spend|lose|loses|gain|gains)\b",
        re.IGNORECASE,
    )

    # --- Dangling term heuristics ---
    STOPWORDS = {
        # determiners/pronouns/conjunctions/etc.
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "because",
        "been",
        "before",
        "being",
        "but",
        "by",
        "can",
        "cannot",
        "could",
        "did",
        "do",
        "does",
        "each",
        "even",
        "for",
        "from",
        "gain",
        "gains",
        "has",
        "have",
        "having",
        "he",
        "her",
        "here",
        "him",
        "his",
        "how",
        "i",
        "if",
        "in",
        "into",
        "is",
        "it",
        "its",
        "make",
        "makes",
        "may",
        "more",
        "most",
        "must",
        "no",
        "not",
        "of",
        "on",
        "one",
        "only",
        "or",
        "other",
        "our",
        "out",
        "outside",
        "over",
        "per",
        "she",
        "should",
        "since",
        "so",
        "some",
        "such",
        "than",
        "that",
        "the",
        "their",
        "them",
        "then",
        "there",
        "these",
        "they",
        "this",
        "those",
        "through",
        "to",
        "under",
        "unless",
        "up",
        "upon",
        "used",
        "use",
        "when",
        "whenever",
        "where",
        "who",
        "whoever",
        "will",
        "with",
        "without",
        "you",
        "your",
    }

    ROMAN = re.compile(r"^(?:I|II|III|IV|V|VI|VII|VIII|IX|X)$")
    ACRONYM_RE = re.compile(r"\b[A-Z]{2,6}\b")
    # e.g. "Action Surge", "Standard Deflection". Keep to 2-5 words.
    TITLE_PHRASE_RE = re.compile(r"\b(?:[A-Z][a-z]{2,}\s+){1,4}[A-Z][a-z]{2,}\b")

    # First pass: collect candidates + counts (skip our own bootstrap descriptions)
    per_node_candidates: Dict[str, Set[str]] = {}
    counts: Dict[str, int] = {}

    for n in nodes.values():
        if not n.source:
            # Avoid noisy internal descriptors like "Stored/base characteristic value on Character..."
            continue
        text = " ".join(filter(None, [n.description, n.formula]))
        if not text:
            continue

        cands: Set[str] = set()
        for tok in ACRONYM_RE.findall(text):
            if ROMAN.match(tok):
                continue
            cands.add(tok)
        for phrase in TITLE_PHRASE_RE.findall(text):
            cands.add(phrase)

        if not cands:
            continue

        per_node_candidates[n.id] = cands
        for c in cands:
            counts[c] = counts.get(c, 0) + 1

    def _is_known_term(term: str) -> bool:
        t = term.strip().lower()
        if t in known_names:
            return True
        if t.endswith("s") and t.rstrip("s") in known_names:
            return True
        return False

    # Second pass: dependency inference + dangling logging
    for n in list(nodes.values()):
        text = " ".join(filter(None, [n.description, n.formula]))
        if not text:
            continue

        # dependsOn inference (curated + word-boundary regex)
        for pat, tid in ref_patterns:
            if tid == n.id:
                continue
            if pat.search(text):
                n.depends_on.add(tid)

        # modifies inference: per sentence, if it contains a "modifying" verb, mark all referenced
        # core stats/resources in that sentence as modifies.
        for sentence in re.split(r"[\.;\n]+", text):
            if not sentence.strip():
                continue
            if not mod_verbs.search(sentence):
                continue
            for pat, tid in ref_patterns:
                if tid == n.id:
                    continue
                if pat.search(sentence):
                    n.modifies.add(tid)

        # dangling references (only from rulebook-sourced nodes)
        if not n.source:
            continue
        for term in sorted(per_node_candidates.get(n.id, set())):
            if _is_known_term(term):
                continue
            # Filter single-token stopwords and sentence-leading junk.
            if " " not in term and term.lower() in STOPWORDS:
                continue
            if ROMAN.match(term):
                continue

            # Keep acronyms always, keep title phrases only if recurring.
            is_acronym = bool(re.fullmatch(r"[A-Z]{2,6}", term))
            if (not is_acronym) and counts.get(term, 0) < 2:
                continue

            dangling.append(
                {
                    "term": term,
                    "referencedBy": n.id,
                    "source": n.source,
                    "context": text[:240],
                }
            )


def merge_graph(existing: Dict[str, Node], new_nodes: Iterable[Node]) -> Dict[str, Node]:
    out = dict(existing)
    for n in new_nodes:
        if n.id not in out:
            out[n.id] = n
            continue
        cur = out[n.id]
        cur.depends_on |= n.depends_on
        cur.modifies |= n.modifies
        if not cur.formula and n.formula:
            cur.formula = n.formula
        if not cur.description and n.description:
            cur.description = n.description
        if not cur.source and n.source:
            cur.source = n.source
        # Prefer a concrete codeMapping if we found it now.
        if (not cur.code_mapping) and n.code_mapping:
            cur.code_mapping = n.code_mapping
        if (cur.status == "unimplemented") and (n.status is None) and n.code_mapping:
            cur.status = None
        if n.status and not cur.status:
            cur.status = n.status
        cur.tags = sorted(set(cur.tags + n.tags))
    return out


def load_existing_graph() -> Dict[str, Node]:
    if not OUT_RULE_GRAPH.exists():
        return {}
    data = json.loads(read_text(OUT_RULE_GRAPH))
    graph = data.get("@graph", [])
    out: Dict[str, Node] = {}
    for item in graph:
        n = Node(
            id=item["@id"],
            type=item.get("@type", "Mechanic"),
            name=item.get("name") or item["@id"],
            source=item.get("source"),
            formula=item.get("formula"),
            code_mapping=item.get("codeMapping"),
            status=item.get("@status"),
            tags=item.get("tags") or [],
            description=item.get("description"),
        )
        # IMPORTANT: we intentionally do NOT persist/restore dependsOn/modifies edges from disk.
        # Those edges are inferred heuristically and have historically been very noisy; they should
        # be recomputed each run by detect_dependencies(), while explicit edges are reintroduced via
        # build_core_domain_nodes().
        n.depends_on = set()
        n.modifies = set()
        out[n.id] = n
    return out


def write_outputs(nodes: Dict[str, Node], dangling: List[Dict[str, Any]]) -> None:
    context = {
        "@vocab": "urn:ttrpg:",
        "dependsOn": {"@type": "@id"},
        "modifies": {"@type": "@id"},
        "codeMapping": "https://example.invalid/codeMapping",
    }
    out = {
        "@context": context,
        "@graph": [nodes[k].to_jsonld() for k in sorted(nodes.keys())],
    }
    OUT_RULE_GRAPH.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")

    # De-duplicate dangling entries
    seen: Set[Tuple[str, str]] = set()
    deduped: List[Dict[str, Any]] = []
    for d in dangling:
        key = (d.get("term", ""), d.get("referencedBy", ""))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(d)
    OUT_DANGLING.write_text(json.dumps(deduped, indent=2, ensure_ascii=False), encoding="utf-8")


def main() -> None:
    if not RULEBOOK_MAIN.exists():
        raise SystemExit(f"Rulebook not found: {RULEBOOK_MAIN}")

    files = load_rulebook_files()
    symbol_index = build_domain_symbol_index()

    extracted: List[Node] = []
    for file_rel, txt in files:
        extracted.extend(extract_abilities(file_rel, txt))

        # Colon-style definitions -> nodes (Keyword/Mechanic/DerivedValue guessed)
        for term, definition in extract_colon_definitions(file_rel, txt):
            # Heuristic typing
            t = "Mechanic"
            nid_type = "mechanic"
            if term.upper() in {"STR", "AGI", "STA", "CON", "INT", "SPI", "DEX"}:
                t = "Attribute"
                nid_type = "attribute"
            elif term.upper() in {"AP", "STA"}:
                t = "DerivedValue"
                nid_type = "derivedvalue"
            elif term.lower() in {"rest", "travel", "search", "prepare"}:
                t = "Mechanic"
                nid_type = "mechanic"
            else:
                # many of these are weapon keywords etc.
                t = "Keyword"
                nid_type = "keyword"

            formulas = find_formulas(definition)
            node = Node(
                id=urn(nid_type, term),
                type=t,
                name=term,
                source=file_rel,
                description=definition,
                formula=formulas[0] if formulas else None,
            )
            extracted.append(node)

    # Add core domain nodes (implemented mechanics)
    extracted.extend(build_core_domain_nodes(symbol_index))

    existing = load_existing_graph()
    merged = merge_graph(existing, extracted)

    dangling: List[Dict[str, Any]] = []
    detect_dependencies(merged, dangling)

    write_outputs(merged, dangling)


if __name__ == "__main__":
    main()
