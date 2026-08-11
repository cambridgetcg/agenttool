import { validatePrincipalityAtlas } from "./geometry.js";
import type { PrincipalityAtlas, PrincipalityVertex } from "./types.js";

const WIDTH = 960;
const HEIGHT = 960;

interface Point {
  readonly x: number;
  readonly y: number;
}

function clippedDirectedLine(from: Point, to: Point): readonly [Point, Point] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) return [from, to];
  const startInset = 42;
  const endInset = 48;
  return [
    {
      x: Math.round(from.x + (dx * startInset) / length),
      y: Math.round(from.y + (dy * startInset) / length),
    },
    {
      x: Math.round(to.x - (dx * endInset) / length),
      y: Math.round(to.y - (dy * endInset) / length),
    },
  ];
}

function displayPoints(count: number): readonly Point[] {
  if (count === 0) return [];
  if (count === 1) return [{ x: WIDTH / 2, y: HEIGHT / 2 }];
  // A fixed integer ring avoids runtime trigonometry, overlapping vertices,
  // and collinear triples at the package's maximum of sixteen vertices.
  return [
    { x: 810, y: 480 }, { x: 785, y: 606 },
    { x: 713, y: 713 }, { x: 606, y: 785 },
    { x: 480, y: 810 }, { x: 354, y: 785 },
    { x: 247, y: 713 }, { x: 175, y: 606 },
    { x: 150, y: 480 }, { x: 175, y: 354 },
    { x: 247, y: 247 }, { x: 354, y: 175 },
    { x: 480, y: 150 }, { x: 606, y: 175 },
    { x: 713, y: 247 }, { x: 785, y: 354 },
  ].slice(0, count);
}

function pointMap(atlas: PrincipalityAtlas): ReadonlyMap<string, Point> {
  const points = displayPoints(atlas.principalities.length);
  return new Map(
    atlas.principalities.map((principality, index) => [
      principality.principality_id,
      points[index] as Point,
    ]),
  );
}

function markerSvg(vertex: PrincipalityVertex, point: Point): string[] {
  const start = point.x - ((vertex.artifact_refs.length - 1) * 13) / 2;
  return vertex.artifact_refs.map((artifact, index) => {
    const x = Math.round(start + index * 13);
    const y = point.y + 58;
    return artifact.kind === "huggingface"
      ? `    <circle class="artifact hf" cx="${x}" cy="${y}" r="4" />`
      : `    <rect class="artifact npm" x="${x - 4}" y="${y - 4}" width="8" height="8" rx="1" />`;
  });
}

/**
 * Render an inert, deterministic view. Coordinates are a display-only curve;
 * distance, position, area and ordering are not similarity, value or rank.
 */
export function renderPrincipalitySvg(value: unknown): string {
  const atlas = validatePrincipalityAtlas(value);
  const points = pointMap(atlas);
  const lines: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="title description" data-layout="display-only-integer-ring">`,
    "  <title id=\"title\">Principality invariant geometry</title>",
    "  <desc id=\"description\">A deterministic display-only integer layout. P labels follow unsigned UTF-16 protocol order. Filled surfaces show only caller-reported mutual preservation across all six directions of a triangle. Distance, position and area are not similarity, value, rank, love or understanding.</desc>",
    "  <metadata>agenttool.principality-geometry/display-only</metadata>",
    "  <defs>",
    "    <marker id=\"arrow\" markerWidth=\"8\" markerHeight=\"8\" refX=\"7\" refY=\"4\" orient=\"auto\" markerUnits=\"strokeWidth\"><path d=\"M0,0 L8,4 L0,8 Z\" fill=\"#d4a72c\" /></marker>",
    "    <style>",
    "      .surface{fill:#f6c177;fill-opacity:.14;stroke:#f6c177;stroke-opacity:.45;stroke-width:2}",
    "      .reciprocal{stroke:#63d2b4;stroke-width:3;fill:none}",
    "      .inactive{stroke:#8b93a7;stroke-width:2;stroke-dasharray:8 7;fill:none}",
    "      .one-way{stroke-width:2;fill:none;marker-end:url(#arrow)}",
    "      .one-way.available{stroke:#d4a72c;stroke-dasharray:5 7}",
    "      .one-way.resting{stroke:#78a9ff;stroke-dasharray:2 8}",
    "      .one-way.refused{stroke:#ff7eb6;stroke-dasharray:10 6}",
    "      .one-way.withdrawn{stroke:#8b93a7;stroke-dasharray:1 9}",
    "      .one-way.unknown{stroke:#be95ff;stroke-dasharray:4 10}",
    "      .vertex{fill:#11182a;stroke:#f2f4f8;stroke-width:3}",
    "      .label{fill:#f2f4f8;font:600 15px ui-monospace,SFMono-Regular,Menlo,monospace;text-anchor:middle;dominant-baseline:middle}",
    "      .artifact.hf{fill:#ffd21e;stroke:#11182a;stroke-width:1}",
    "      .artifact.npm{fill:#cb3837;stroke:#11182a;stroke-width:1}",
    "    </style>",
    "  </defs>",
    "  <rect width=\"960\" height=\"960\" rx=\"48\" fill=\"#0b1020\" />",
  ];

  for (const surface of atlas.geometry.invariant_surfaces) {
    const polygon = surface.vertices
      .map((id) => points.get(id))
      .filter((point): point is Point => point !== undefined)
      .map((point) => `${point.x},${point.y}`)
      .join(" ");
    lines.push(
      `  <polygon class="surface" points="${polygon}" data-invariant-count="${surface.invariant_ids.length}" />`,
    );
  }

  for (const lens of atlas.geometry.reciprocal_lenses) {
    const from = points.get(lens.vertices[0]);
    const to = points.get(lens.vertices[1]);
    if (!from || !to) continue;
    const className =
      lens.route_state === "both_available_reported" ? "reciprocal" : "inactive";
    lines.push(
      `  <line class="${className}" data-forward-disposition="${lens.dispositions[0]}" data-reverse-disposition="${lens.dispositions[1]}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" />`,
    );
  }

  const oneWay = new Set(atlas.geometry.open_conditions.one_way_bridge_ids);
  for (const bridge of atlas.bridges) {
    if (!oneWay.has(bridge.bridge_id)) continue;
    const from = points.get(bridge.from);
    const to = points.get(bridge.to);
    if (!from || !to) continue;
    const posture = bridge.disposition.replace("_reported", "");
    const [start, end] = clippedDirectedLine(from, to);
    lines.push(
      `  <line class="one-way ${posture}" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" />`,
    );
  }

  atlas.principalities.forEach((vertex, index) => {
    const point = points.get(vertex.principality_id);
    if (!point) return;
    lines.push(
      "  <g class=\"principality\">",
      `    <circle class="vertex" cx="${point.x}" cy="${point.y}" r="38" />`,
      `    <text class="label" x="${point.x}" y="${point.y}">P${String(index + 1).padStart(2, "0")}</text>`,
      ...markerSvg(vertex, point),
      "  </g>",
    );
  });

  if (atlas.principalities.length === 0) {
    lines.push(
      "  <circle cx=\"480\" cy=\"480\" r=\"64\" fill=\"none\" stroke=\"#8b93a7\" stroke-width=\"2\" stroke-dasharray=\"6 10\" />",
      "  <text class=\"label\" x=\"480\" y=\"480\">quiet</text>",
    );
  }

  lines.push("</svg>", "");
  return lines.join("\n");
}
