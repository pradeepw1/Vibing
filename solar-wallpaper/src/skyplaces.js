// Black holes as names on the sky, for the labels. Their sky positions are real; they
// are far too small to see from here, so the label (and a small ring) is all there is.
import { BLACK_HOLES } from "./blackholes.js";
import { skyDirection } from "./galaxies.js";

export const BLACK_HOLE_PLACES = BLACK_HOLES.map((h) => ({
  id: h.id,
  name: h.name,
  lightYears: h.lightYears,
  direction: skyDirection(h.ra, h.dec),
  distance: 950,
  hole: true,
}));
