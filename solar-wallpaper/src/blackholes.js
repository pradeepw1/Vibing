// The black holes you can fly to. Their places in the sky and their distances
// are real. Their size is not: a real one is a speck (Sagittarius A* is only
// about 25 million km across, a minute and a half of light), so out here each
// is drawn millions of times bigger than it is, or you'd never see it.
//
// `rs` is the size shown, as the radius of the point of no return, in
// thousands of light-years. Everything about the picture (the disc, the
// bent starlight) is measured in these radii.
//
//   tilt:  how the disc is turned. `towards` is the angle from the line of
//          sight to the disc's axis, where known; `pa` the way it leans on
//          our sky (position angle, north through east) for the ones whose
//          jet we have seen. The real tilts are the ones from the
//          Event Horizon Telescope and X-ray work; where there's no measured
//          direction, the disc is laid flat to its galaxy.
//   stars: a made-up crowd of stars round it, so the bending of light has
//          something to bend.
export const BLACK_HOLES = [
  {
    id: "sgra",
    name: "Sagittarius A*",
    lightYears: "26,700 light-years",
    about: "The black hole at the heart of the Milky Way: about 4 million suns squeezed into a point. Not to scale.",
    ra: 266.41683,
    dec: -29.00781,
    kly: 26.7,
    rs: 0.002,
    disc: { inner: 3, outer: 15, bright: 1.0, kelvin: 8500 },
    tilt: { flatTo: "galaxy" },
    spin: 1,
    crowd: { stars: 800, radius: 150, colours: [[1.0, 0.72, 0.45], [1.0, 0.85, 0.65], [0.7, 0.8, 1.0]], mix: [0.62, 0.28, 0.1] },
  },
  {
    id: "cygx1",
    name: "Cygnus X-1",
    lightYears: "7,200 light-years",
    about: "The first black hole ever found: about 21 suns, feeding on a blue giant star beside it. Not to scale.",
    ra: 299.59032,
    dec: 35.2016,
    kly: 7.2,
    rs: 0.0004,
    disc: { inner: 3, outer: 14, bright: 0.9, kelvin: 16000 },
    tilt: { flatTo: "galaxy" },
    spin: -1,
    crowd: { stars: 700, radius: 220, colours: [[0.6, 0.75, 1.0], [0.85, 0.9, 1.0], [1.0, 0.85, 0.7]], mix: [0.5, 0.3, 0.2] },
    // Its blue supergiant companion, and the gas it pulls off it.
    companion: { distance: 62, radius: 9, colour: [0.55, 0.72, 1.0], light: 5 },
  },
  {
    id: "m87bh",
    name: "M87*",
    lightYears: "53.5 million light-years",
    about: "The first black hole ever photographed (2019): about 6.5 billion suns, in the galaxy M87. Not to scale.",
    ra: 187.70593,
    dec: 12.39112,
    kly: 53500,
    rs: 0.35,
    disc: { inner: 3, outer: 16, bright: 0.85, kelvin: 6200 },
    tilt: { towards: 17, pa: 288 },
    spin: 1,
    crowd: { stars: 900, radius: 130, colours: [[1.0, 0.78, 0.5], [1.0, 0.9, 0.72], [1.0, 0.6, 0.35]], mix: [0.5, 0.35, 0.15] },
  },
];
