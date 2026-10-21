// The settings both pages share: how fast time runs, and how plain values from the
// address or a wallpaper app are cleaned up. Kept free of the galaxy and star lists so
// the Wallpaper page doesn't have to carry them.

// "live" runs at real speed. If the clock is on today's date, it stays locked to now.
export const SPEEDS = [
  { id: "live", label: "Live", rate: 1 },
  { id: "minute", label: "1 min/s", rate: 60 },
  { id: "hour", label: "1 hour/s", rate: 3600 },
  { id: "day", label: "1 day/s", rate: 86400 },
  { id: "week", label: "1 week/s", rate: 7 * 86400 },
  { id: "month", label: "1 month/s", rate: 30.436875 * 86400 },
  { id: "year", label: "1 year/s", rate: 365.2425 * 86400 },
];

export const speedRate = (id) => SPEEDS.find((s) => s.id === id)?.rate ?? 1;

export const bool = (v) => !["0", "false", "no", "off"].includes(String(v).toLowerCase());

/** Cleans up a setting both pages understand, or returns undefined if it isn't one or isn't valid. */
export function parseShared(key, value) {
  switch (key) {
    case "speed":
      return SPEEDS.some((s) => s.id === value) ? value : undefined;
    case "fps": {
      const n = Math.round(Number(value));
      return n >= 5 && n <= 240 ? n : undefined;
    }
    case "date": {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? undefined : d.getTime();
    }
    case "labels":
    case "orbits":
    case "belts":
    case "clock":
    case "drift":
    case "photos":
    case "ui":
      return bool(value);
    default:
      return undefined;
  }
}
