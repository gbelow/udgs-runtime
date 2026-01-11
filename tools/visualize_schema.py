"""Visualize the JSON-LD rule graph (`rule_graph.json`) as a static image.

This script started as a simple `plt.show()` graph visualizer, but your rule graph
is now large (~600 nodes). To make it usable, this provides:

- Filtering by node type (e.g. exclude `Keyword`)
- Optional focus mode (n-hop neighborhood around a node)
- Optional removal of isolates
- Save as PNG or SVG

Examples:

    # Core-only graph (no Keywords), save as SVG
    python tools/visualize_schema.py --in rule_graph.json --out graph.svg --exclude-types Keyword --drop-isolates

    # Focus around the "Action Surge" node, 2 hops
    python tools/visualize_schema.py --focus "Action Surge" --hops 2 --out action_surge.svg
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

import matplotlib.pyplot as plt
import networkx as nx


NodeJson = Dict[str, Any]


def _ensure_list(v: Any) -> List[str]:
    if v is None:
        return []
    if isinstance(v, list):
        return [x for x in v if isinstance(x, str)]
    if isinstance(v, str):
        return [v]
    return []


def load_jsonld_graph(path: str) -> List[NodeJson]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, dict) and isinstance(data.get("@graph"), list):
        return [x for x in data["@graph"] if isinstance(x, dict)]
    # fallback: allow passing a list directly
    if isinstance(data, list):
        return [x for x in data if isinstance(x, dict)]
    if isinstance(data, dict):
        return [data]
    raise ValueError(f"Unsupported JSON-LD input at {path}")


def build_graph(nodes: Sequence[NodeJson]) -> nx.DiGraph:
    g = nx.DiGraph()

    for node in nodes:
        node_id = node.get("@id")
        if not isinstance(node_id, str) or not node_id:
            continue
        node_type = node.get("@type", "Unknown")
        if not isinstance(node_type, str):
            node_type = "Unknown"

        name = node.get("name")
        if not isinstance(name, str) or not name:
            name = node_id.split(":")[-1]

        status = node.get("@status")
        if not isinstance(status, str):
            status = None

        g.add_node(node_id, name=name, type=node_type, status=status)

    # Edges (only between nodes that exist)
    node_ids = set(g.nodes)
    for node in nodes:
        src = node.get("@id")
        if src not in node_ids:
            continue

        for dep in _ensure_list(node.get("dependsOn")):
            if dep in node_ids:
                g.add_edge(src, dep, kind="dependsOn")

        for mod in _ensure_list(node.get("modifies")):
            if mod in node_ids:
                g.add_edge(src, mod, kind="modifies")

    return g


def filter_by_types(
    g: nx.DiGraph,
    include_types: Optional[Set[str]] = None,
    exclude_types: Optional[Set[str]] = None,
) -> nx.DiGraph:
    include_types = include_types or set()
    exclude_types = exclude_types or set()

    def keep(n: str) -> bool:
        t = g.nodes[n].get("type")
        if include_types and t not in include_types:
            return False
        if exclude_types and t in exclude_types:
            return False
        return True

    keep_nodes = [n for n in g.nodes if keep(n)]
    return g.subgraph(keep_nodes).copy()


def find_node_ids_by_name(g: nx.DiGraph, query: str) -> List[str]:
    q = query.strip().lower()
    if not q:
        return []

    # Exact id match first
    if query in g.nodes:
        return [query]

    # Exact name match
    exact = [n for n in g.nodes if str(g.nodes[n].get("name", "")).strip().lower() == q]
    if exact:
        return exact

    # Fuzzy contains match (bounded)
    contains = [
        n
        for n in g.nodes
        if q in str(g.nodes[n].get("name", "")).strip().lower()
    ]
    return contains[:25]


def focus_subgraph(g: nx.DiGraph, focus_query: str, hops: int) -> nx.DiGraph:
    seeds = find_node_ids_by_name(g, focus_query)
    if not seeds:
        raise ValueError(f"Focus query did not match any nodes: {focus_query!r}")
    if len(seeds) > 1:
        # pick the shortest name match as a heuristic
        seeds = sorted(seeds, key=lambda n: len(str(g.nodes[n].get("name", ""))))
        seeds = seeds[:1]

    seed = seeds[0]
    visited = {seed}
    frontier = {seed}
    for _ in range(max(0, hops)):
        nxt: Set[str] = set()
        for n in frontier:
            nxt |= set(g.predecessors(n))
            nxt |= set(g.successors(n))
        nxt -= visited
        visited |= nxt
        frontier = nxt
        if not frontier:
            break
    return g.subgraph(sorted(visited)).copy()


def drop_isolates(g: nx.DiGraph) -> nx.DiGraph:
    keep = [n for n in g.nodes if g.degree(n) > 0]
    return g.subgraph(keep).copy()


def compute_layout(g: nx.DiGraph, layout: str) -> Dict[str, Tuple[float, float]]:
    # For static images, GraphViz is usually better. If it's not available,
    # fall back to spring layout.
    layout = layout.lower().strip()
    if layout in {"dot", "sfdp", "neato"}:
        try:
            from networkx.drawing.nx_agraph import graphviz_layout  # type: ignore

            return graphviz_layout(g, prog=layout)
        except Exception:
            pass

    # spring fallback
    k = 1.0 / max(1, (g.number_of_nodes() ** 0.5))
    return nx.spring_layout(g, k=k, iterations=200, seed=42)


def draw_graph(
    g: nx.DiGraph,
    out_path: Optional[str],
    title: str,
    show: bool,
    layout: str,
    label_limit: int,
    figsize: Tuple[int, int],
) -> None:
    plt.figure(figsize=figsize)
    pos = compute_layout(g, layout=layout)

    # Node colors by type
    node_colors = {
        "Attribute": "#87CEEB",  # skyblue
        "DerivedValue": "#FFA500",  # orange
        "Mechanic": "#90EE90",  # lightgreen
        "Keyword": "#D3D3D3",  # lightgray
        "Unknown": "#B0B0B0",
    }
    colors = [node_colors.get(g.nodes[n].get("type"), "#B0B0B0") for n in g.nodes]

    # Split edges by kind so we can style them differently
    depends_edges = [(u, v) for u, v, d in g.edges(data=True) if d.get("kind") == "dependsOn"]
    modifies_edges = [(u, v) for u, v, d in g.edges(data=True) if d.get("kind") == "modifies"]

    nx.draw_networkx_nodes(g, pos, node_color=colors, node_size=900, linewidths=0.8, edgecolors="#444")
    nx.draw_networkx_edges(g, pos, edgelist=depends_edges, arrows=True, arrowstyle="-|>", width=1.0, edge_color="#666")
    nx.draw_networkx_edges(
        g,
        pos,
        edgelist=modifies_edges,
        arrows=True,
        arrowstyle="-|>",
        width=1.2,
        edge_color="#B22222",  # firebrick
        style="dashed",
    )

    # Labels: only if graph is small enough
    if g.number_of_nodes() <= label_limit:
        labels = nx.get_node_attributes(g, "name")
        nx.draw_networkx_labels(g, pos, labels=labels, font_size=8)
    else:
        # Label only the highest-degree nodes
        degrees = sorted(((n, g.degree(n)) for n in g.nodes), key=lambda x: x[1], reverse=True)
        top = {n for n, _ in degrees[: min(30, len(degrees))]}
        labels = {n: g.nodes[n].get("name", n) for n in top}
        nx.draw_networkx_labels(g, pos, labels=labels, font_size=8)

    plt.title(title)
    plt.axis("off")
    plt.tight_layout()

    if out_path:
        Path(out_path).parent.mkdir(parents=True, exist_ok=True)
        plt.savefig(out_path, dpi=200)
        print(f"Wrote {out_path} (nodes={g.number_of_nodes()} edges={g.number_of_edges()})")

    if show:
        plt.show()
    else:
        plt.close()


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Visualize rule_graph.json (JSON-LD) as a static image")
    p.add_argument("--in", dest="in_path", default="rule_graph.json", help="Input JSON-LD graph file")
    p.add_argument("--out", dest="out_path", default=None, help="Output image path (.png or .svg)")
    p.add_argument("--show", action="store_true", help="Also open a window via matplotlib")

    p.add_argument(
        "--include-types",
        nargs="*",
        default=None,
        help="Only include nodes with these @type values (e.g. Attribute DerivedValue Mechanic)",
    )
    p.add_argument(
        "--exclude-types",
        nargs="*",
        default=None,
        help="Exclude nodes with these @type values (e.g. Keyword)",
    )
    p.add_argument("--drop-isolates", action="store_true", help="Remove isolated nodes after filtering")

    p.add_argument("--focus", default=None, help="Focus on a node by name/id (extract neighborhood)")
    p.add_argument("--hops", type=int, default=2, help="Number of hops for --focus neighborhood")

    p.add_argument("--layout", default="sfdp", help="Layout: sfdp|dot|neato|spring")
    p.add_argument("--title", default="TTRPG Rule Graph", help="Plot title")
    p.add_argument("--label-limit", type=int, default=120, help="Label all nodes if <= this many")
    p.add_argument("--figsize", default="16,10", help="Figure size as 'W,H' (inches)")

    return p.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> None:
    args = parse_args(argv)

    nodes = load_jsonld_graph(args.in_path)
    g = build_graph(nodes)

    include_types = set(args.include_types) if args.include_types else set()
    exclude_types = set(args.exclude_types) if args.exclude_types else set()

    if include_types or exclude_types:
        g = filter_by_types(g, include_types=include_types, exclude_types=exclude_types)

    if args.focus:
        g = focus_subgraph(g, args.focus, hops=args.hops)

    if args.drop_isolates:
        g = drop_isolates(g)

    try:
        w_str, h_str = [x.strip() for x in str(args.figsize).split(",", 1)]
        figsize = (int(w_str), int(h_str))
    except Exception:
        figsize = (16, 10)

    out_path = args.out_path
    if out_path is None and not args.show:
        # Default to a file output to avoid “nothing happens” confusion.
        out_path = "rule_graph.svg"

    draw_graph(
        g,
        out_path=out_path,
        title=args.title,
        show=bool(args.show),
        layout=args.layout,
        label_limit=int(args.label_limit),
        figsize=figsize,
    )


if __name__ == "__main__":
    main()
