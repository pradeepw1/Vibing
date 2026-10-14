// Facts about each body. Radii are mean radii in km (NASA planetary fact sheets).
//
// `orbit` on a moon decides how its position is worked out:
//   "moon"      Earth's Moon, from astronomy-engine (exact)
//   "galilean"  Jupiter's big four, from astronomy-engine (exact)
//   "charon"    Charon always hangs over Pluto's prime meridian (exact)
//   otherwise   a circle with the real size and period, in the planet's equator
//               plane. The starting spot is not real (we don't have the data).

export const SUN = { id: "sun", name: "Sun", radiusKm: 695700 };

export const PLANETS = [
  { id: "mercury", periodDays: 87.969, name: "Mercury", body: "Mercury", radiusKm: 2439.7, color: "#b5a99a", orbitColor: "#a89e94" },
  { id: "venus", periodDays: 224.701, name: "Venus", body: "Venus", radiusKm: 6051.8, color: "#e8d3a2", orbitColor: "#d9c08c", atmosphere: [1.0, 0.86, 0.6, 0.55] },
  { id: "earth", periodDays: 365.256, name: "Earth", body: "Earth", radiusKm: 6371.0, color: "#4b7bd1", orbitColor: "#6f9be8", atmosphere: [0.35, 0.6, 1.0, 1.0] },
  { id: "mars", periodDays: 686.98, name: "Mars", body: "Mars", radiusKm: 3389.5, color: "#c1663c", orbitColor: "#d9774a", atmosphere: [1.0, 0.6, 0.45, 0.25] },
  { id: "jupiter", periodDays: 4332.59, name: "Jupiter", body: "Jupiter", radiusKm: 69911, color: "#d8b48a", orbitColor: "#d6a777", atmosphere: [1.0, 0.9, 0.75, 0.25] },
  { id: "saturn", periodDays: 10759.22, name: "Saturn", body: "Saturn", radiusKm: 58232, color: "#e3cf9c", orbitColor: "#d8c48f", atmosphere: [1.0, 0.93, 0.75, 0.25], rings: true },
  { id: "uranus", periodDays: 30685.4, name: "Uranus", body: "Uranus", radiusKm: 25362, color: "#a8dde3", orbitColor: "#8fd0d8", atmosphere: [0.6, 0.95, 1.0, 0.45] },
  { id: "neptune", periodDays: 60189.0, name: "Neptune", body: "Neptune", radiusKm: 24622, color: "#4f74d9", orbitColor: "#5c7fe0", atmosphere: [0.4, 0.55, 1.0, 0.45] },
  { id: "pluto", periodDays: 90560.0, name: "Pluto", body: "Pluto", radiusKm: 1188.3, color: "#c9b49a", orbitColor: "#9c8f80", dwarf: true },
];

export const MOONS = [
  { id: "moon", name: "Moon", parent: "earth", radiusKm: 1737.4, orbit: "moon", periodDays: 27.321661 },

  { id: "phobos", name: "Phobos", parent: "mars", radiusKm: 11.1, aKm: 9376, periodDays: 0.31891 },
  { id: "deimos", name: "Deimos", parent: "mars", radiusKm: 6.2, aKm: 23463, periodDays: 1.26244 },

  { id: "io", name: "Io", parent: "jupiter", radiusKm: 1821.6, orbit: "galilean", periodDays: 1.769138 },
  { id: "europa", name: "Europa", parent: "jupiter", radiusKm: 1560.8, orbit: "galilean", periodDays: 3.551181 },
  { id: "ganymede", name: "Ganymede", parent: "jupiter", radiusKm: 2634.1, orbit: "galilean", periodDays: 7.154553 },
  { id: "callisto", name: "Callisto", parent: "jupiter", radiusKm: 2410.3, orbit: "galilean", periodDays: 16.689018 },

  { id: "rhea", name: "Rhea", parent: "saturn", radiusKm: 763.8, aKm: 527108, periodDays: 4.518212 },
  { id: "titan", name: "Titan", parent: "saturn", radiusKm: 2574.7, aKm: 1221870, periodDays: 15.945421 },
  { id: "iapetus", name: "Iapetus", parent: "saturn", radiusKm: 734.5, aKm: 3560820, periodDays: 79.3215 },

  { id: "miranda", name: "Miranda", parent: "uranus", radiusKm: 235.8, aKm: 129390, periodDays: 1.413479 },
  { id: "ariel", name: "Ariel", parent: "uranus", radiusKm: 578.9, aKm: 190900, periodDays: 2.520379 },
  { id: "umbriel", name: "Umbriel", parent: "uranus", radiusKm: 584.7, aKm: 266000, periodDays: 4.144177 },
  { id: "titania", name: "Titania", parent: "uranus", radiusKm: 788.4, aKm: 435910, periodDays: 8.705872 },
  { id: "oberon", name: "Oberon", parent: "uranus", radiusKm: 761.4, aKm: 583520, periodDays: 13.463239 },

  // Triton goes round backwards, on an orbit tipped 157 degrees from Neptune's equator.
  { id: "triton", name: "Triton", parent: "neptune", radiusKm: 1353.4, aKm: 354759, periodDays: 5.876854, tiltDeg: 157 },

  { id: "charon", name: "Charon", parent: "pluto", radiusKm: 606, aKm: 19591, periodDays: 6.387230, orbit: "charon" },
];

export const AU_KM = 149597870.7;

// Saturn's main rings, as multiples of Saturn's radius (C ring inner edge to A ring outer edge).
export const SATURN_RINGS = { inner: 1.239, outer: 2.270 };
