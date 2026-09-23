/**
 * Tiny turtle-graphics builder for route arrows. Headings are in degrees, 0 = up (screen north),
 * positive = clockwise, matching SVG's y-down coordinate system. Every arrow is a stroked route
 * (`d`) ending in a filled arrowhead (`head`), so all icons share one construction and style.
 */

export interface Point {
  x: number;
  y: number;
}

export interface ArrowHeadSpec {
  /** Distance from the base of the head to its tip. */
  length: number;
  /** Half the width of the head's base. */
  halfWidth: number;
}

export interface Route {
  /** SVG path data for the stroked body. */
  d: string;
  /** Polygon points for the arrowhead, or null for a route without a head. */
  head: string | null;
  end: Point;
  heading: number;
}

const DEG = Math.PI / 180;

/** Round to 2 decimals so the SVG markup stays short and stable across platforms. */
export function r2(n: number): number {
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? 0 : v;
}

export function pointAlong(p: Point, heading: number, distance: number): Point {
  return {
    x: p.x + Math.sin(heading * DEG) * distance,
    y: p.y - Math.cos(heading * DEG) * distance,
  };
}

/** Polygon for an arrowhead whose tip is at `tip`, pointing along `heading`. */
export function arrowHead(tip: Point, heading: number, spec: ArrowHeadSpec): string {
  const base = pointAlong(tip, heading, -spec.length);
  const px = Math.cos(heading * DEG) * spec.halfWidth;
  const py = Math.sin(heading * DEG) * spec.halfWidth;
  const pts: Point[] = [
    tip,
    { x: base.x - px, y: base.y - py },
    { x: base.x + px, y: base.y + py },
  ];
  return pts.map((p) => `${r2(p.x)},${r2(p.y)}`).join(' ');
}

export class Turtle {
  private x: number;
  private y: number;
  private heading: number;
  private readonly parts: string[];

  constructor(x: number, y: number, heading = 0) {
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.parts = [`M${r2(x)} ${r2(y)}`];
  }

  get position(): Point {
    return { x: this.x, y: this.y };
  }

  forward(distance: number): this {
    const p = pointAlong(this.position, this.heading, distance);
    this.x = p.x;
    this.y = p.y;
    this.parts.push(`L${r2(p.x)} ${r2(p.y)}`);
    return this;
  }

  /** Circular arc of `radius`, turning by `delta` degrees (negative = left, positive = right). */
  turn(radius: number, delta: number): this {
    if (delta === 0) return this;
    const side = delta > 0 ? 1 : -1;
    // Centre lies perpendicular to the heading, on the side we turn towards.
    const cx = this.x + Math.cos(this.heading * DEG) * radius * side;
    const cy = this.y + Math.sin(this.heading * DEG) * radius * side;
    const a = delta * DEG;
    const dx = this.x - cx;
    const dy = this.y - cy;
    this.x = cx + dx * Math.cos(a) - dy * Math.sin(a);
    this.y = cy + dx * Math.sin(a) + dy * Math.cos(a);
    this.heading += delta;
    const large = Math.abs(delta) > 180 ? 1 : 0;
    const sweep = delta > 0 ? 1 : 0;
    this.parts.push(`A${r2(radius)} ${r2(radius)} 0 ${large} ${sweep} ${r2(this.x)} ${r2(this.y)}`);
    return this;
  }

  /** Finish without a head. */
  done(): Route {
    return { d: this.parts.join(' '), head: null, end: this.position, heading: this.heading };
  }

  /**
   * Finish with a straight run of `distance` ending in an arrowhead at the tip. The stroked body
   * stops inside the head so round caps never poke out past its edges.
   */
  arrow(distance: number, spec: ArrowHeadSpec): Route {
    const tip = pointAlong(this.position, this.heading, distance);
    const bodyEnd = pointAlong(tip, this.heading, -spec.length * 0.7);
    this.parts.push(`L${r2(bodyEnd.x)} ${r2(bodyEnd.y)}`);
    this.x = tip.x;
    this.y = tip.y;
    return {
      d: this.parts.join(' '),
      head: arrowHead(tip, this.heading, spec),
      end: tip,
      heading: this.heading,
    };
  }
}
