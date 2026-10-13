import { describe, expect, it } from "vitest";
import {
  streetViewUrl,
  viewpointFor,
  type Pos,
} from "../src/console/streetView";

const roads = (...lines: Pos[][]) => ({
  features: lines.map((coordinates) => ({
    geometry: { type: "LineString" as const, coordinates },
  })),
});
// A lot about 85 m across, with 400 North along its south edge and a road far to the north.
const lot: Pos[] = [
  [-111.75, 40.3],
  [-111.749, 40.3],
  [-111.749, 40.301],
  [-111.75, 40.301],
  [-111.75, 40.3],
];

describe("streetViewUrl", () => {
  it("builds a keyless Google Maps Street View link, latitude first", () => {
    expect(streetViewUrl([-111.7512345678, 40.3098765432])).toBe(
      "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=40.309877,-111.751235",
    );
  });
});

describe("viewpointFor", () => {
  it("opens a point where it is", () => {
    expect(
      viewpointFor({ type: "Point", coordinates: [-111.75, 40.3] }),
    ).toEqual([-111.75, 40.3]);
  });

  it("opens a line at its point nearest its own middle", () => {
    const at = viewpointFor({
      type: "LineString",
      coordinates: [
        [-111.76, 40.3],
        [-111.75, 40.3],
        [-111.75, 40.31],
      ],
    })!;
    // The middle of its corners lies off the line; the nearest point on it is on the north leg.
    expect(at[0]).toBeCloseTo(-111.75, 6);
    expect(at[1]).toBeCloseTo(40.303333, 5);
  });

  it("opens an area on the road along its edge nearest its center", () => {
    const at = viewpointFor(
      { type: "Polygon", coordinates: [lot] },
      roads(
        [
          [-111.76, 40.29985],
          [-111.74, 40.29985],
        ],
        [
          [-111.76, 40.302],
          [-111.74, 40.302],
        ],
      ),
    )!;
    expect(at[0]).toBeCloseTo(-111.7495, 6);
    expect(at[1]).toBeCloseTo(40.29985, 6);
  });

  it("opens an area at its center when no road is inside it or along it", () => {
    const at = viewpointFor(
      { type: "Polygon", coordinates: [lot] },
      roads([
        [-111.76, 40.302],
        [-111.74, 40.302],
      ]),
    )!;
    expect(at[0]).toBeCloseTo(-111.7495, 6);
    expect(at[1]).toBeCloseTo(40.3005, 6);
  });

  it("has nothing for a missing shape", () => {
    expect(viewpointFor(null)).toBeNull();
  });
});
