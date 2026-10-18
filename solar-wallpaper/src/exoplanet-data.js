// Planets round other stars, from the Open Exoplanet Catalogue (MIT licence,
// https://github.com/OpenExoplanetCatalogue/open_exoplanet_catalogue), which
// gathers what NASA's Exoplanet Archive, exoplanet.eu and the papers report.
// Made by tools/make-exoplanets.mjs; don't edit by hand.
//
// ra, dec: J2000 degrees. ly: light-years from the Sun.
// star: temp (kelvin), radius and mass (suns), class (spectral letter).
// planets: r (Earth radii), m (Earth masses, or null), a (AU), p (days),
// e (eccentricity), t (kelvin, rough), how it was found, year; est: the size
// was worked out from the mass or taken from a paper, not measured in the
// table; disputed: not everyone agrees it's there.
export const EXOPLANET_SYSTEMS = [
 {
 "id": "proxima",
 "name": "Proxima Centauri",
 "about": "The nearest star to the Sun. Planet b circles in its habitable zone.",
 "famous": true,
 "ra": 217.4289,
 "dec": -62.6795,
 "ly": 4.2,
 "star": {
 "temp": 2900,
 "radius": 0.141,
 "mass": 0.12,
 "class": "M"
 },
 "planets": [
 {
 "name": "Proxima Centauri d",
 "r": 0.69,
 "m": 0.3,
 "a": 0.02885,
 "p": 5.122,
 "e": 0.04,
 "t": 283,
 "how": "RV",
 "year": 2022,
 "est": true
 },
 {
 "name": "Proxima Centauri b",
 "r": 1.05,
 "m": 1.2,
 "a": 0.04857,
 "p": 11.184,
 "e": 0,
 "t": 234,
 "how": "RV",
 "year": 2016,
 "est": true
 },
 {
 "name": "Proxima Centauri c",
 "r": 2.77,
 "m": 7,
 "a": 1.496,
 "p": 1929,
 "e": 0,
 "t": 39,
 "how": "RV",
 "year": 2019,
 "est": true
 }
 ]
 },
 {
 "id": "epseri",
 "name": "Epsilon Eridani",
 "about": "A young Sun-like star with a giant planet and belts of rubble, 10 light-years away.",
 "famous": true,
 "ra": 53.2327,
 "dec": -9.4583,
 "ly": 10.5,
 "star": {
 "temp": 5135,
 "radius": 0.743,
 "mass": 0.82,
 "class": "K"
 },
 "planets": [
 {
 "name": "eps Eridani b",
 "r": 11.2,
 "m": 205,
 "a": 3.51,
 "p": 2651,
 "e": 0.4,
 "t": 104,
 "how": "RV",
 "year": 2000,
 "est": true,
 "disputed": true
 }
 ]
 },
 {
 "id": "yzcet",
 "name": "YZ Ceti",
 "about": "Three small planets whirling round a red dwarf, each year over in days.",
 "famous": false,
 "ra": 18.1277,
 "dec": -16.999,
 "ly": 11.7,
 "star": {
 "temp": 3056,
 "radius": 0.17,
 "mass": 0.13,
 "class": "M"
 },
 "planets": [
 {
 "name": "YZ Cet b",
 "r": 0.92,
 "m": 0.8,
 "a": 0.01557,
 "p": 1.9688,
 "e": 0,
 "t": 445,
 "how": "RV",
 "year": 2017,
 "est": true
 },
 {
 "name": "YZ Cet c",
 "r": 0.99,
 "m": 1,
 "a": 0.0209,
 "p": 3.0601,
 "e": 0.04,
 "t": 384,
 "how": "RV",
 "year": 2017,
 "est": true
 },
 {
 "name": "YZ Cet d",
 "r": 1.04,
 "m": 1.1,
 "a": 0.02764,
 "p": 4.6563,
 "e": 0.129,
 "t": 334,
 "how": "RV",
 "year": 2017,
 "est": true
 }
 ]
 },
 {
 "id": "taucet",
 "name": "Tau Ceti",
 "about": "A Sun-like star 12 light-years away, with several possible planets.",
 "famous": true,
 "ra": 26.017,
 "dec": -15.9375,
 "ly": 11.9,
 "star": {
 "temp": 5344,
 "radius": 0.793,
 "mass": 0.783,
 "class": "G"
 },
 "planets": [
 {
 "name": "tau Ceti b",
 "r": 1.21,
 "m": 2,
 "a": 0.105,
 "p": 13.965,
 "e": 0.16,
 "t": 648,
 "how": "RV",
 "year": 2012,
 "est": true
 },
 {
 "name": "tau Ceti g",
 "r": 1.17,
 "m": 1.8,
 "a": 0.1329,
 "p": 20,
 "e": 0.06,
 "t": 576,
 "how": "RV",
 "year": 2017,
 "est": true
 },
 {
 "name": "tau Ceti c",
 "r": 1.77,
 "m": 3.1,
 "a": 0.195,
 "p": 35.362,
 "e": 0.03,
 "t": 475,
 "how": "RV",
 "year": 2012,
 "est": true
 },
 {
 "name": "tau Ceti h",
 "r": 1.18,
 "m": 1.8,
 "a": 0.243,
 "p": 49.41,
 "e": 0.23,
 "t": 426,
 "how": "RV",
 "year": 2017,
 "est": true
 },
 {
 "name": "tau Ceti d",
 "r": 1.92,
 "m": 3.6,
 "a": 0.374,
 "p": 94.11,
 "e": 0.08,
 "t": 343,
 "how": "RV",
 "year": 2012,
 "est": true
 },
 {
 "name": "tau Ceti e",
 "r": 2.02,
 "m": 3.9,
 "a": 0.538,
 "p": 162.87,
 "e": 0.18,
 "t": 286,
 "how": "RV",
 "year": 2012,
 "est": true
 },
 {
 "name": "tau Ceti f",
 "r": 2.02,
 "m": 3.9,
 "a": 1.334,
 "p": 636.13,
 "e": 0.16,
 "t": 182,
 "how": "RV",
 "year": 2012,
 "est": true
 }
 ]
 },
 {
 "id": "teegarden",
 "name": "Teegarden's Star",
 "about": "A small red star with two Earth-sized planets.",
 "famous": false,
 "ra": 43.2537,
 "dec": 16.8813,
 "ly": 12.5,
 "star": {
 "temp": 2904,
 "radius": 0.107,
 "mass": 0.089,
 "class": "M"
 },
 "planets": [
 {
 "name": "GAT 1370 b",
 "r": 1.01,
 "m": 1,
 "a": 0.0252,
 "p": 4.91,
 "e": 0,
 "t": 264,
 "how": "RV",
 "year": 2019,
 "est": true
 },
 {
 "name": "GAT 1370 c",
 "r": 1.03,
 "m": 1.1,
 "a": 0.0443,
 "p": 11.409,
 "e": 0,
 "t": 199,
 "how": "RV",
 "year": 2019,
 "est": true
 }
 ]
 },
 {
 "id": "wolf1061",
 "name": "Wolf 1061",
 "about": "Three planets round a red dwarf, one in the habitable zone.",
 "famous": false,
 "ra": 247.5752,
 "dec": -12.6626,
 "ly": 14,
 "star": {
 "temp": 3345,
 "radius": 0.26,
 "mass": 0.25,
 "class": "M"
 },
 "planets": [
 {
 "name": "Wolf 1061 b",
 "r": 1.09,
 "m": 1.4,
 "a": 0.03551,
 "p": 4.8876,
 "e": 0,
 "t": 399,
 "how": "RV",
 "year": 2015,
 "est": true
 },
 {
 "name": "Wolf 1061 c",
 "r": 2.11,
 "m": 4.3,
 "a": 0.08427,
 "p": 17.867,
 "e": 0.19,
 "t": 259,
 "how": "RV",
 "year": 2015,
 "est": true
 },
 {
 "name": "Wolf 1061 d",
 "r": 2.36,
 "m": 5.2,
 "a": 0.2039,
 "p": 67.27,
 "e": 0.32,
 "t": 167,
 "how": "RV",
 "year": 2015,
 "est": true
 }
 ]
 },
 {
 "id": "gl581",
 "name": "Gliese 581",
 "about": "A red dwarf with several claimed planets, some of them disputed.",
 "famous": false,
 "ra": 229.8618,
 "dec": -7.7223,
 "ly": 20.3,
 "star": {
 "temp": 3498,
 "radius": 0.3,
 "mass": 0.31,
 "class": "M"
 },
 "planets": [
 {
 "name": "Gliese 581 e",
 "r": 1.2,
 "m": 1.9,
 "a": 0.02815,
 "p": 3.149,
 "e": 0,
 "t": 501,
 "how": "RV",
 "year": 2009,
 "est": true
 },
 {
 "name": "Gliese 581 b",
 "r": 4.33,
 "m": 15.8,
 "a": 0.04061,
 "p": 5.3686,
 "e": 0,
 "t": 419,
 "how": "RV",
 "year": 2005,
 "est": true
 },
 {
 "name": "Gliese 581 c",
 "r": 2.43,
 "m": 5.5,
 "a": 0.0721,
 "p": 12.914,
 "e": 0,
 "t": 313,
 "how": "RV",
 "year": 2007,
 "est": true
 },
 {
 "name": "Gliese 581 g",
 "r": 1.77,
 "m": 3.1,
 "a": 0.146,
 "p": 36.5,
 "e": 0,
 "t": 231,
 "how": "RV",
 "year": 2010,
 "est": true
 },
 {
 "name": "Gliese 581 d",
 "r": 2.55,
 "m": 6,
 "a": 0.22,
 "p": 66.64,
 "e": 0.25,
 "t": 181,
 "how": "RV",
 "year": 2007,
 "est": true
 },
 {
 "name": "Gliese 581 f",
 "r": 2.77,
 "m": 7,
 "a": 0.758,
 "p": 433,
 "e": 0,
 "t": 97,
 "how": "RV",
 "year": 2010,
 "est": true
 }
 ]
 },
 {
 "id": "gj667c",
 "name": "Gliese 667 C",
 "about": "A red dwarf in a triple star system, with up to seven planets.",
 "famous": false,
 "ra": 259.7375,
 "dec": -34.9897,
 "ly": 22.7,
 "star": {
 "temp": 3350,
 "radius": 0.41,
 "mass": 0.33,
 "class": "M"
 },
 "planets": [
 {
 "name": "Gliese 667 C b",
 "r": 2.45,
 "m": 5.6,
 "a": 0.0505,
 "p": 7.2004,
 "e": 0.13,
 "t": 421,
 "how": "RV",
 "year": 2009,
 "est": true
 },
 {
 "name": "Gliese 667 C h",
 "r": 1.03,
 "m": 1.1,
 "a": 0.0893,
 "p": 16.946,
 "e": 0.06,
 "t": 317,
 "how": "RV",
 "year": 2013,
 "est": true,
 "disputed": true
 },
 {
 "name": "Gliese 667 C c",
 "r": 1.98,
 "m": 3.8,
 "a": 0.125,
 "p": 28.14,
 "e": 0.02,
 "t": 268,
 "how": "RV",
 "year": 2009,
 "est": true
 },
 {
 "name": "Gliese 667 C f",
 "r": 1.64,
 "m": 2.7,
 "a": 0.156,
 "p": 39.026,
 "e": 0.03,
 "t": 240,
 "how": "RV",
 "year": 2013,
 "est": true,
 "disputed": true
 },
 {
 "name": "Gliese 667 C e",
 "r": 1.64,
 "m": 2.7,
 "a": 0.213,
 "p": 62.24,
 "e": 0.02,
 "t": 205,
 "how": "RV",
 "year": 2013,
 "est": true,
 "disputed": true
 },
 {
 "name": "Gliese 667 C d",
 "r": 2.33,
 "m": 5.1,
 "a": 0.276,
 "p": 91.61,
 "e": 0.03,
 "t": 180,
 "how": "RV",
 "year": 2013,
 "est": true,
 "disputed": true
 },
 {
 "name": "Gliese 667 C g",
 "r": 2.2,
 "m": 4.6,
 "a": 0.549,
 "p": 256.2,
 "e": 0.08,
 "t": 128,
 "how": "RV",
 "year": 2013,
 "est": true,
 "disputed": true
 }
 ]
 },
 {
 "id": "fomalhaut",
 "name": "Fomalhaut",
 "about": "A bright star inside a huge ring of dust. Hubble photographed a planet beside the ring.",
 "famous": true,
 "ra": 344.4125,
 "dec": -29.6222,
 "ly": 25.1,
 "star": {
 "temp": 8590,
 "radius": 1.84,
 "mass": 1.92,
 "class": "A"
 },
 "planets": [
 {
 "name": "Fomalhaut b",
 "r": 11,
 "m": null,
 "a": 177,
 "p": 320000,
 "e": 0.8,
 "t": 40,
 "how": "imaging",
 "year": 2008,
 "est": true,
 "disputed": true
 }
 ]
 },
 {
 "id": "gj436",
 "name": "Gliese 436",
 "about": "A hot Neptune-sized planet with a comet-like tail of gas.",
 "famous": false,
 "ra": 175.5462,
 "dec": 26.7066,
 "ly": 31.8,
 "star": {
 "temp": 3479,
 "radius": 0.449,
 "mass": 0.445,
 "class": "M"
 },
 "planets": [
 {
 "name": "UCF-1.01",
 "r": 0.66,
 "m": null,
 "a": 0.01839,
 "p": 1.3659,
 "e": 0,
 "t": 758,
 "how": "transit",
 "year": 2012,
 "est": false,
 "disputed": true
 },
 {
 "name": "Gliese 436 b",
 "r": 4.05,
 "m": 25.4,
 "a": 0.0286,
 "p": 2.6439,
 "e": 0.1616,
 "t": 608,
 "how": "transit",
 "year": 2004,
 "est": false
 }
 ]
 },
 {
 "id": "l9859",
 "name": "L 98-59",
 "about": "Four small planets close round a red dwarf.",
 "famous": false,
 "ra": 124.5317,
 "dec": -68.313,
 "ly": 34.6,
 "star": {
 "temp": 3367,
 "radius": 0.312,
 "mass": 0.313,
 "class": "M"
 },
 "planets": [
 {
 "name": "L 98-59 b",
 "r": 0.85,
 "m": 0.4,
 "a": 0.02191,
 "p": 2.2531,
 "e": 0.1,
 "t": 627,
 "how": "transit",
 "year": 2018,
 "est": false
 },
 {
 "name": "L 98-59 c",
 "r": 1.38,
 "m": 2.2,
 "a": 0.0304,
 "p": 3.6907,
 "e": 0.103,
 "t": 553,
 "how": "transit",
 "year": 2018,
 "est": false
 },
 {
 "name": "L 98-59 d",
 "r": 1.52,
 "m": 1.9,
 "a": 0.0486,
 "p": 7.4507,
 "e": 0.074,
 "t": 416,
 "how": "transit",
 "year": 2018,
 "est": false
 },
 {
 "name": "L 98-59 e",
 "r": 1.76,
 "m": 3.1,
 "a": 0.0717,
 "p": 12.796,
 "e": 0.128,
 "t": 432,
 "how": "RV",
 "year": 2021,
 "est": true
 }
 ]
 },
 {
 "id": "trappist1",
 "name": "TRAPPIST-1",
 "about": "Seven Earth-sized planets round a small red star. Three are in its habitable zone.",
 "famous": true,
 "ra": 346.6224,
 "dec": -5.0414,
 "ly": 40.5,
 "star": {
 "temp": 2516,
 "radius": 0.121,
 "mass": 0.089,
 "class": "M"
 },
 "planets": [
 {
 "name": "TRAPPIST-1 b",
 "r": 1.12,
 "m": 1,
 "a": 0.01155,
 "p": 1.5109,
 "e": 0.00622,
 "t": 400,
 "how": "transit",
 "year": 2016,
 "est": false
 },
 {
 "name": "TRAPPIST-1 c",
 "r": 1.1,
 "m": 1.2,
 "a": 0.01582,
 "p": 2.4218,
 "e": 0.00654,
 "t": 342,
 "how": "transit",
 "year": 2016,
 "est": false
 },
 {
 "name": "TRAPPIST-1 d",
 "r": 0.78,
 "m": 0.3,
 "a": 0.02228,
 "p": 4.0498,
 "e": 0.00837,
 "t": 288,
 "how": "transit",
 "year": 2017,
 "est": false
 },
 {
 "name": "TRAPPIST-1 e",
 "r": 0.91,
 "m": 0.8,
 "a": 0.02928,
 "p": 6.0996,
 "e": 0.0051,
 "t": 251,
 "how": "transit",
 "year": 2017,
 "est": false
 },
 {
 "name": "TRAPPIST-1 f",
 "r": 1.05,
 "m": 0.9,
 "a": 0.03853,
 "p": 9.2065,
 "e": 0.01007,
 "t": 219,
 "how": "transit",
 "year": 2017,
 "est": false
 },
 {
 "name": "TRAPPIST-1 g",
 "r": 1.15,
 "m": 1.1,
 "a": 0.04688,
 "p": 12.353,
 "e": 0.00208,
 "t": 199,
 "how": "transit",
 "year": 2017,
 "est": false
 },
 {
 "name": "TRAPPIST-1 h",
 "r": 0.77,
 "m": 0.3,
 "a": 0.06193,
 "p": 18.766,
 "e": 0.00567,
 "t": 167,
 "how": "transit",
 "year": 2017,
 "est": false
 }
 ]
 },
 {
 "id": "cancri55",
 "name": "55 Cancri",
 "about": "Five planets. The closest, 55 Cnc e, is a rocky world with a year under a day, its sunny side molten.",
 "famous": true,
 "ra": 133.1492,
 "dec": 28.3308,
 "ly": 41.1,
 "star": {
 "temp": 5172,
 "radius": 0.943,
 "mass": 0.905,
 "class": "K"
 },
 "planets": [
 {
 "name": "55 Cancri e",
 "r": 1.88,
 "m": 8,
 "a": 0.01544,
 "p": 0.73655,
 "e": 0.05,
 "t": 1783,
 "how": "transit",
 "year": 2004,
 "est": false
 },
 {
 "name": "55 Cancri b",
 "r": 11.2,
 "m": 255.4,
 "a": 0.1134,
 "p": 14.652,
 "e": 0,
 "t": 658,
 "how": "RV",
 "year": 1996,
 "est": true
 },
 {
 "name": "55 Cancri c",
 "r": 8.28,
 "m": 51.2,
 "a": 0.2373,
 "p": 44.399,
 "e": 0.03,
 "t": 455,
 "how": "RV",
 "year": 2002,
 "est": true
 },
 {
 "name": "55 Cancri f",
 "r": 7.97,
 "m": 47.8,
 "a": 0.7708,
 "p": 259.88,
 "e": 0.08,
 "t": 252,
 "how": "RV",
 "year": 2007,
 "est": true
 },
 {
 "name": "55 Cancri d",
 "r": 11.2,
 "m": 991.6,
 "a": 5.957,
 "p": 5574.2,
 "e": 0.13,
 "t": 91,
 "how": "RV",
 "year": 2002,
 "est": true
 }
 ]
 },
 {
 "id": "hd40307",
 "name": "HD 40307",
 "about": "A star with six planets, some of them rocky.",
 "famous": false,
 "ra": 88.5177,
 "dec": -60.0235,
 "ly": 42.4,
 "star": {
 "temp": 4977,
 "radius": 0.811,
 "mass": 0.77,
 "class": "K"
 },
 "planets": [
 {
 "name": "HD 40307 b",
 "r": 1.98,
 "m": 3.8,
 "a": 0.0475,
 "p": 4.3115,
 "e": 0,
 "t": 907,
 "how": "RV",
 "year": 2008,
 "est": true
 },
 {
 "name": "HD 40307 c",
 "r": 2.64,
 "m": 6.4,
 "a": 0.0812,
 "p": 9.6207,
 "e": 0,
 "t": 694,
 "how": "RV",
 "year": 2008,
 "est": true
 },
 {
 "name": "HD 40307 d",
 "r": 3.13,
 "m": 8.7,
 "a": 0.134,
 "p": 20.419,
 "e": 0,
 "t": 540,
 "how": "RV",
 "year": 2008,
 "est": true
 },
 {
 "name": "HD 40307 e",
 "r": 1.89,
 "m": 3.5,
 "a": 0.1886,
 "p": 34.62,
 "e": 0.15,
 "t": 455,
 "how": "RV",
 "year": 2012,
 "est": true,
 "disputed": true
 },
 {
 "name": "HD 40307 f",
 "r": 1.93,
 "m": 3.6,
 "a": 0.2485,
 "p": 51.56,
 "e": 0,
 "t": 397,
 "how": "RV",
 "year": 2012,
 "est": true
 },
 {
 "name": "HD 40307 g",
 "r": 2.79,
 "m": 7.1,
 "a": 0.6,
 "p": 197.8,
 "e": 0.29,
 "t": 255,
 "how": "RV",
 "year": 2012,
 "est": true,
 "disputed": true
 }
 ]
 },
 {
 "id": "gj1214",
 "name": "Gliese 1214",
 "about": "A planet with a thick hazy air, perhaps a water world.",
 "famous": false,
 "ra": 258.8292,
 "dec": 4.9639,
 "ly": 42.4,
 "star": {
 "temp": 3026,
 "radius": 0.216,
 "mass": 0.15,
 "class": "M"
 },
 "planets": [
 {
 "name": "Gliese 1214 b",
 "r": 2.74,
 "m": 8.2,
 "a": 0.01411,
 "p": 1.5804,
 "e": 0,
 "t": 522,
 "how": "transit",
 "year": 2009,
 "est": false
 }
 ]
 },
 {
 "id": "pegasi51",
 "name": "51 Pegasi",
 "about": "The first planet found round a Sun-like star (1995): a hot giant with a 4-day year.",
 "famous": true,
 "ra": 344.3666,
 "dec": 20.7688,
 "ly": 47.9,
 "star": {
 "temp": 5793,
 "radius": 1.266,
 "mass": 1.04,
 "class": "G"
 },
 "planets": [
 {
 "name": "51 Peg b",
 "r": 11.2,
 "m": 146.2,
 "a": 0.052,
 "p": 4.231,
 "e": 0,
 "t": 1260,
 "how": "RV",
 "year": 1995,
 "est": true
 }
 ]
 },
 {
 "id": "lhs3844",
 "name": "LHS 3844",
 "about": "A rocky planet with an 11-hour year and a bare-rock surface.",
 "famous": false,
 "ra": 340.4922,
 "dec": -69.169,
 "ly": 48.6,
 "star": {
 "temp": 3036,
 "radius": 0.19,
 "mass": 0.15,
 "class": "M"
 },
 "planets": [
 {
 "name": "LHS 3844 b",
 "r": 1.3,
 "m": null,
 "a": 0.00622,
 "p": 0.46293,
 "e": 0,
 "t": 805,
 "how": "transit",
 "year": 2019,
 "est": false
 }
 ]
 },
 {
 "id": "lhs1140",
 "name": "LHS 1140",
 "about": "A rocky super-Earth in the habitable zone of a red dwarf.",
 "famous": false,
 "ra": 11.25,
 "dec": -15.2742,
 "ly": 48.9,
 "star": {
 "temp": 3216,
 "radius": 0.21,
 "mass": 0.19,
 "class": "M"
 },
 "planets": [
 {
 "name": "LHS 1140 c",
 "r": 1.17,
 "m": 1.8,
 "a": 0.02734,
 "p": 3.7779,
 "e": 0.274,
 "t": 709,
 "how": "transit",
 "year": 2018,
 "est": false
 },
 {
 "name": "LHS 1140 b",
 "r": 1.64,
 "m": 6.4,
 "a": 0.0957,
 "p": 24.737,
 "e": 0.096,
 "t": 379,
 "how": "transit",
 "year": 2017,
 "est": false
 }
 ]
 },
 {
 "id": "hd189733",
 "name": "HD 189733",
 "about": "A hot giant that Hubble found to be a deep blue.",
 "famous": false,
 "ra": 300.1792,
 "dec": 22.7108,
 "ly": 62.9,
 "star": {
 "temp": 4980,
 "radius": 0.788,
 "mass": 0.8,
 "class": "K"
 },
 "planets": [
 {
 "name": "HD 189733 b",
 "r": 12.76,
 "m": 361.7,
 "a": 0.03142,
 "p": 2.2186,
 "e": 0.0041,
 "t": 1100,
 "how": "transit",
 "year": 2005,
 "est": false
 }
 ]
 },
 {
 "id": "betapic",
 "name": "Beta Pictoris",
 "about": "A young star in a disc of dust, with two giant planets photographed directly.",
 "famous": true,
 "ra": 86.8212,
 "dec": -51.0665,
 "ly": 64.4,
 "star": {
 "temp": 7877,
 "radius": 1.572,
 "mass": 1.76,
 "class": "A"
 },
 "planets": [
 {
 "name": "beta Pic c",
 "r": 11.2,
 "m": 2860.5,
 "a": 2.7,
 "p": 1200,
 "e": 0.24,
 "t": 265,
 "how": "RV",
 "year": 2019,
 "est": true
 },
 {
 "name": "beta Pic b",
 "r": 18.5,
 "m": 3500,
 "a": 9.1,
 "p": 7665,
 "e": 0.08,
 "t": 1700,
 "how": "imaging",
 "year": 2008,
 "est": true
 }
 ]
 },
 {
 "id": "toi1452",
 "name": "TOI-1452",
 "about": "A planet that may be a world of water, round a red dwarf.",
 "famous": false,
 "ra": 290.175,
 "dec": 73.195,
 "ly": 99.5,
 "star": {
 "temp": 3185,
 "radius": 0.28,
 "mass": 0.25,
 "class": "M"
 },
 "planets": [
 {
 "name": "TOI-1452 b",
 "r": 1.67,
 "m": 4.8,
 "a": 0.061,
 "p": 11.062,
 "e": 0,
 "t": 326,
 "how": "transit",
 "year": 2022,
 "est": false
 }
 ]
 },
 {
 "id": "toi700",
 "name": "TOI-700",
 "about": "Three planets found by TESS. TOI-700 d is Earth-sized, in the habitable zone.",
 "famous": false,
 "ra": 97.0958,
 "dec": -65.5794,
 "ly": 101.3,
 "star": {
 "temp": 3461,
 "radius": 0.42,
 "mass": 0.41,
 "class": "M"
 },
 "planets": [
 {
 "name": "TOI-700 b",
 "r": 1.04,
 "m": null,
 "a": 0.0677,
 "p": 9.977,
 "e": 0.081,
 "t": 417,
 "how": "transit",
 "year": 2020,
 "est": false
 },
 {
 "name": "TOI-700 c",
 "r": 2.65,
 "m": null,
 "a": 0.0929,
 "p": 16.051,
 "e": 0.078,
 "t": 356,
 "how": "transit",
 "year": 2020,
 "est": false
 },
 {
 "name": "TOI-700 d",
 "r": 1.14,
 "m": null,
 "a": 0.1633,
 "p": 37.425,
 "e": 0.111,
 "t": 269,
 "how": "transit",
 "year": 2020,
 "est": false
 }
 ]
 },
 {
 "id": "k218",
 "name": "K2-18",
 "about": "Water vapour was found in the air of its planet b in 2019.",
 "famous": false,
 "ra": 172.5605,
 "dec": 7.5884,
 "ly": 110.9,
 "star": {
 "temp": 3457,
 "radius": 0.411,
 "mass": 0.359,
 "class": "M"
 },
 "planets": [
 {
 "name": "K2-18 c",
 "r": 2.88,
 "m": 7.5,
 "a": 0.06,
 "p": 8.962,
 "e": 0,
 "t": 399,
 "how": "RV",
 "year": 2017,
 "est": true
 },
 {
 "name": "EPIC 201912552 b",
 "r": 2.38,
 "m": 8,
 "a": 0.143,
 "p": 32.94,
 "e": 0,
 "t": 258,
 "how": "transit",
 "year": 2015,
 "est": false
 }
 ]
 },
 {
 "id": "hd10180",
 "name": "HD 10180",
 "about": "A Sun-like star with as many as nine planets.",
 "famous": false,
 "ra": 24.4732,
 "dec": -60.5115,
 "ly": 126.8,
 "star": {
 "temp": 5911,
 "radius": 1.109,
 "mass": 1.06,
 "class": "G"
 },
 "planets": [
 {
 "name": "HD 10180 b",
 "r": 1.08,
 "m": 1.3,
 "a": 0.0222,
 "p": 1.1777,
 "e": 0.05,
 "t": 1843,
 "how": "RV",
 "year": 2010,
 "est": true,
 "disputed": true
 },
 {
 "name": "HD 10180 c",
 "r": 3.93,
 "m": 13.2,
 "a": 0.06412,
 "p": 5.7597,
 "e": 0.073,
 "t": 1084,
 "how": "RV",
 "year": 2010,
 "est": true
 },
 {
 "name": "HD 10180 i",
 "r": 1.2,
 "m": 1.9,
 "a": 0.0904,
 "p": 9.655,
 "e": 0.05,
 "t": 913,
 "how": "RV",
 "year": 2012,
 "est": true,
 "disputed": true
 },
 {
 "name": "HD 10180 d",
 "r": 3.73,
 "m": 12,
 "a": 0.1286,
 "p": 16.357,
 "e": 0.131,
 "t": 766,
 "how": "RV",
 "year": 2010,
 "est": true
 },
 {
 "name": "HD 10180 e",
 "r": 5.65,
 "m": 25.6,
 "a": 0.2699,
 "p": 49.748,
 "e": 0.051,
 "t": 528,
 "how": "RV",
 "year": 2010,
 "est": true
 },
 {
 "name": "HD 10180 j",
 "r": 2.32,
 "m": 5.1,
 "a": 0.33,
 "p": 67.55,
 "e": 0.07,
 "t": 478,
 "how": "RV",
 "year": 2012,
 "est": true,
 "disputed": true
 },
 {
 "name": "HD 10180 f",
 "r": 5.32,
 "m": 22.9,
 "a": 0.4929,
 "p": 122.74,
 "e": 0.119,
 "t": 391,
 "how": "RV",
 "year": 2010,
 "est": true
 },
 {
 "name": "HD 10180 g",
 "r": 5.36,
 "m": 23.3,
 "a": 1.427,
 "p": 604.67,
 "e": 0.263,
 "t": 230,
 "how": "RV",
 "year": 2010,
 "est": true
 },
 {
 "name": "HD 10180 h",
 "r": 9.49,
 "m": 65.7,
 "a": 3.381,
 "p": 2205,
 "e": 0.095,
 "t": 149,
 "how": "RV",
 "year": 2010,
 "est": true
 }
 ]
 },
 {
 "id": "hr8799",
 "name": "HR 8799",
 "about": "Four giant planets, photographed directly, still glowing from their birth.",
 "famous": true,
 "ra": 346.8696,
 "dec": 21.1343,
 "ly": 128.5,
 "star": {
 "temp": 7193,
 "radius": 1.44,
 "mass": 1.516,
 "class": "F"
 },
 "planets": [
 {
 "name": "HR 8799 e",
 "r": 11.21,
 "m": 2224.8,
 "a": 16.99,
 "p": 20816,
 "e": 0,
 "t": 1200,
 "how": "imaging",
 "year": 2010,
 "est": false
 },
 {
 "name": "HR 8799 d",
 "r": 12.33,
 "m": 2224.8,
 "a": 26.97,
 "p": 41628,
 "e": 0,
 "t": 1200,
 "how": "imaging",
 "year": 2008,
 "est": false
 },
 {
 "name": "HR 8799 c",
 "r": 11.21,
 "m": 2224.8,
 "a": 42.81,
 "p": 83255,
 "e": 0,
 "t": 1200,
 "how": "imaging",
 "year": 2008,
 "est": false
 },
 {
 "name": "HR 8799 b",
 "r": 7.85,
 "m": 1589.1,
 "a": 67.96,
 "p": 166510,
 "e": 0,
 "t": 1100,
 "how": "imaging",
 "year": 2008,
 "est": false
 }
 ]
 },
 {
 "id": "hd209458",
 "name": "HD 209458",
 "about": "The first planet seen crossing in front of its star (1999).",
 "famous": true,
 "ra": 330.7949,
 "dec": 18.8843,
 "ly": 153.3,
 "star": {
 "temp": 6075,
 "radius": 1.146,
 "mass": 1.148,
 "class": "F"
 },
 "planets": [
 {
 "name": "HD 209458 b",
 "r": 15.47,
 "m": 226.9,
 "a": 0.04747,
 "p": 3.5247,
 "e": 0.0004,
 "t": 1316,
 "how": "transit",
 "year": 1999,
 "est": false
 }
 ]
 },
 {
 "id": "kepler16",
 "name": "Kepler-16",
 "about": "A planet that circles two stars at once.",
 "famous": true,
 "ra": 289.075,
 "dec": 51.7575,
 "ly": 195.7,
 "star": {
 "temp": 5000,
 "radius": 1,
 "mass": 1,
 "class": "K"
 },
 "planets": [
 {
 "name": "Kepler-16 b",
 "r": 8.45,
 "m": 105.8,
 "a": 0.7048,
 "p": 228.78,
 "e": 0.00685,
 "t": 263,
 "how": "transit",
 "year": 2011,
 "est": false
 }
 ]
 },
 {
 "id": "kepler1649",
 "name": "Kepler-1649",
 "about": "A planet almost exactly Earth's size, in its star's habitable zone.",
 "famous": false,
 "ra": 292.5038,
 "dec": 41.8304,
 "ly": 301.5,
 "star": {
 "temp": 3240,
 "radius": 0.23,
 "mass": 0.2,
 "class": "M"
 },
 "planets": [
 {
 "name": "Kepler-1649 b",
 "r": 1.02,
 "m": null,
 "a": 0.04837,
 "p": 8.6891,
 "e": 0,
 "t": 307,
 "how": "transit",
 "year": 2017,
 "est": false
 },
 {
 "name": "Kepler-1649 c",
 "r": 1.06,
 "m": null,
 "a": 0.08302,
 "p": 19.535,
 "e": 0,
 "t": 234,
 "how": "transit",
 "year": 2020,
 "est": false
 }
 ]
 },
 {
 "id": "wasp76",
 "name": "WASP-76",
 "about": "A scorching giant where it may rain iron on the night side.",
 "famous": false,
 "ra": 26.6327,
 "dec": 2.7006,
 "ly": 391.4,
 "star": {
 "temp": 6250,
 "radius": 1.73,
 "mass": 1.46,
 "class": "F"
 },
 "planets": [
 {
 "name": "WASP-76 b",
 "r": 20.51,
 "m": 292.4,
 "a": 0.033,
 "p": 1.8099,
 "e": 0,
 "t": 2160,
 "how": "transit",
 "year": 2013,
 "est": false
 }
 ]
 },
 {
 "id": "kepler186",
 "name": "Kepler-186",
 "about": "Five planets. Kepler-186 f was the first Earth-sized planet found in a habitable zone (2014).",
 "famous": false,
 "ra": 298.6527,
 "dec": 43.955,
 "ly": 492.5,
 "star": {
 "temp": 3788,
 "radius": 0.472,
 "mass": 0.478,
 "class": "K"
 },
 "planets": [
 {
 "name": "Kepler-186 b",
 "r": 1.09,
 "m": null,
 "a": 0.0343,
 "p": 3.8868,
 "e": 0,
 "t": 620,
 "how": "transit",
 "year": 2014,
 "est": false
 },
 {
 "name": "Kepler-186 c",
 "r": 1.09,
 "m": null,
 "a": 0.052,
 "p": 7.2673,
 "e": 0,
 "t": 503,
 "how": "transit",
 "year": 2014,
 "est": false
 },
 {
 "name": "Kepler-186 d",
 "r": 1.43,
 "m": null,
 "a": 0.0781,
 "p": 13.343,
 "e": 0,
 "t": 411,
 "how": "transit",
 "year": 2014,
 "est": false
 },
 {
 "name": "Kepler-186 e",
 "r": 1.3,
 "m": null,
 "a": 0.11,
 "p": 22.408,
 "e": 0,
 "t": 346,
 "how": "transit",
 "year": 2014,
 "est": false
 },
 {
 "name": "Kepler-186 f",
 "r": 1.11,
 "m": null,
 "a": 0.356,
 "p": 112.22,
 "e": 0,
 "t": 192,
 "how": "transit",
 "year": 2014,
 "est": false
 }
 ]
 },
 {
 "id": "corot7",
 "name": "CoRoT-7",
 "about": "One of the first rocky planets found outside our system (2009), baked by its star.",
 "famous": false,
 "ra": 100.9542,
 "dec": -1.0631,
 "ly": 521.5,
 "star": {
 "temp": 5275,
 "radius": 0.83,
 "mass": 0.82,
 "class": "G"
 },
 "planets": [
 {
 "name": "CoRoT-7 b",
 "r": 1.68,
 "m": 4.1,
 "a": 0.01702,
 "p": 0.85359,
 "e": 0,
 "t": 1756,
 "how": "transit",
 "year": 2009,
 "est": false
 },
 {
 "name": "CoRoT-7 c",
 "r": 2.84,
 "m": 8.4,
 "a": 0.046,
 "p": 3.698,
 "e": 0,
 "t": 988,
 "how": "RV",
 "year": 2009,
 "est": false
 },
 {
 "name": "CoRoT-7 d",
 "r": 4.3,
 "m": 17.1,
 "a": 0.07906,
 "p": 8.966,
 "e": 0,
 "t": 754,
 "how": "RV",
 "year": 2022,
 "est": false
 }
 ]
 },
 {
 "id": "kepler22",
 "name": "Kepler-22",
 "about": "The first planet found in the habitable zone of a Sun-like star (2011).",
 "famous": false,
 "ra": 289.2175,
 "dec": 47.8844,
 "ly": 587.1,
 "star": {
 "temp": 5510,
 "radius": 0.979,
 "mass": 0.97,
 "class": "G"
 },
 "planets": [
 {
 "name": "Kepler-22 b",
 "r": 2.43,
 "m": null,
 "a": 0.849,
 "p": 290,
 "e": 0,
 "t": 250,
 "how": "transit",
 "year": 2011,
 "est": false
 }
 ]
 },
 {
 "id": "kelt9",
 "name": "KELT-9",
 "about": "The hottest giant planet known, round a star twice as hot as the Sun.",
 "famous": false,
 "ra": 307.8598,
 "dec": 39.9388,
 "ly": 670.9,
 "star": {
 "temp": 10170,
 "radius": 2.36,
 "mass": 2.32,
 "class": "B"
 },
 "planets": [
 {
 "name": "HD 195689 b",
 "r": 21.2,
 "m": 915,
 "a": 0.02542,
 "p": 1.48,
 "e": 0,
 "t": 4050,
 "how": "transit",
 "year": 2017,
 "est": true
 }
 ]
 },
 {
 "id": "wasp39",
 "name": "WASP-39",
 "about": "In 2022 the Webb telescope found carbon dioxide in its air, the first time for any planet.",
 "famous": false,
 "ra": 217.3267,
 "dec": -3.4445,
 "ly": 750.2,
 "star": {
 "temp": 5400,
 "radius": 0.895,
 "mass": 0.93,
 "class": "G"
 },
 "planets": [
 {
 "name": "WASP-39 b",
 "r": 14.24,
 "m": 89,
 "a": 0.0486,
 "p": 4.0553,
 "e": 0,
 "t": 1022,
 "how": "transit",
 "year": 2011,
 "est": false
 }
 ]
 },
 {
 "id": "wasp12",
 "name": "WASP-12",
 "about": "A giant stretched into an egg shape by its star, and slowly falling into it.",
 "famous": false,
 "ra": 97.6375,
 "dec": 29.6722,
 "ly": 815.4,
 "star": {
 "temp": 6118,
 "radius": 1.599,
 "mass": 1.35,
 "class": "F"
 },
 "planets": [
 {
 "name": "WASP-12 b",
 "r": 19.46,
 "m": 446.2,
 "a": 0.02293,
 "p": 1.0914,
 "e": 0,
 "t": 2320,
 "how": "transit",
 "year": 2008,
 "est": false
 }
 ]
 },
 {
 "id": "wasp121",
 "name": "WASP-121",
 "about": "An ultra-hot giant that goes round its star in a day and a half.",
 "famous": false,
 "ra": 107.6003,
 "dec": -39.0974,
 "ly": 880.6,
 "star": {
 "temp": 6459,
 "radius": 1.458,
 "mass": 1.353,
 "class": "F"
 },
 "planets": [
 {
 "name": "WASP-121 b",
 "r": 20.25,
 "m": 376,
 "a": 0.02544,
 "p": 1.2749,
 "e": 0,
 "t": 2358,
 "how": "transit",
 "year": 2015,
 "est": false
 }
 ]
 },
 {
 "id": "kepler442",
 "name": "Kepler-442",
 "about": "A super-Earth in the habitable zone of an orange star.",
 "famous": false,
 "ra": 285.3666,
 "dec": 39.2801,
 "ly": 1115.5,
 "star": {
 "temp": 4402,
 "radius": 0.598,
 "mass": 0.609,
 "class": "K"
 },
 "planets": [
 {
 "name": "Kepler-442 b",
 "r": 1.35,
 "m": null,
 "a": 0.409,
 "p": 112.31,
 "e": 0,
 "t": 235,
 "how": "transit",
 "year": 2015,
 "est": false
 }
 ]
 },
 {
 "id": "kepler452",
 "name": "Kepler-452",
 "about": "A planet with a year of 385 days, round a star much like our Sun.",
 "famous": true,
 "ra": 296.0037,
 "dec": 44.2775,
 "ly": 1402.5,
 "star": {
 "temp": 5757,
 "radius": 1.11,
 "mass": 1.037,
 "class": "G"
 },
 "planets": [
 {
 "name": "Kepler-452 b",
 "r": 1.67,
 "m": null,
 "a": 1.046,
 "p": 384.84,
 "e": 0,
 "t": 265,
 "how": "transit",
 "year": 2015,
 "est": false
 }
 ]
 },
 {
 "id": "psr1257",
 "name": "PSR B1257+12",
 "about": "The first planets ever found outside our solar system (1992), round a pulsar, the leftover of an exploded star.",
 "famous": false,
 "ra": 195.0149,
 "dec": 12.6824,
 "ly": 2315.7,
 "star": {
 "temp": 28000,
 "radius": 0.00002,
 "mass": 1.4,
 "class": "P"
 },
 "planets": [
 {
 "name": "PSR 1257+12 A",
 "r": 0.33,
 "m": 0,
 "a": 0.19,
 "p": 25.262,
 "e": 0,
 "t": 150,
 "how": "timing",
 "year": 1992,
 "est": true
 },
 {
 "name": "PSR 1257+12 B",
 "r": 2.12,
 "m": 4.3,
 "a": 0.36,
 "p": 66.542,
 "e": 0.0186,
 "t": 150,
 "how": "timing",
 "year": 1992,
 "est": true
 },
 {
 "name": "PSR 1257+12 C",
 "r": 2.01,
 "m": 3.9,
 "a": 0.46,
 "p": 98.211,
 "e": 0.0252,
 "t": 150,
 "how": "timing",
 "year": 1992,
 "est": true
 }
 ]
 }
];
