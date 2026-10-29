import { useSyncExternalStore } from "react";

/**
 * Display time zone for every time shown in the app.
 * Default: Korea (Asia/Seoul) regardless of the Mac's own setting.
 * Alternative: UK (Europe/London), the zone Whisky Auctioneer's schedule is written in
 * ("auctions end from 7:00 PM (UK local time)"). GMT/BST switching comes from the IANA database.
 */
export type Zone = "kst" | "uk";
export const ZONES: Record<Zone, { tz: string; label: string; long: string }> = {
  kst: { tz: "Asia/Seoul", label: "한국", long: "한국 시간" },
  uk: { tz: "Europe/London", label: "영국", long: "영국 시간 (옥셔니어 기준)" },
};

const KEY = "wt.zone";
let current: Zone = (() => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "uk" ? "uk" : "kst";
  } catch {
    return "kst";
  }
})();
const listeners = new Set<() => void>();

export function setZone(z: Zone) {
  current = z;
  try {
    localStorage.setItem(KEY, z);
  } catch {
    /* storage unavailable: keep for this session only */
  }
  listeners.forEach((l) => l());
}

export function getZone(): Zone {
  return current;
}

export function useZone(): Zone {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => "kst",
  );
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(locale: string, opts: Intl.DateTimeFormatOptions) {
  const k = locale + JSON.stringify(opts);
  let f = fmtCache.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, opts);
    fmtCache.set(k, f);
  }
  return f;
}

/** Wall-clock parts of `unix` in the zone. */
export function parts(unix: number, zone: Zone = current) {
  const p = fmt("en-US", {
    timeZone: ZONES[zone].tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(new Date(unix * 1000));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { y: +get("year"), mo: +get("month"), d: +get("day"), h: +get("hour"), mi: +get("minute"), wd };
}

/** Seconds east of UTC for the zone at that instant. */
export function offsetSec(unix: number, zone: Zone = current) {
  const p = parts(unix, zone);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) / 1000;
  return Math.round((asUtc - Math.floor(unix / 60) * 60) / 60) * 60;
}

/** "KST", or "GMT"/"BST" for the UK depending on the date. */
export function zoneAbbr(unix: number, zone: Zone = current) {
  if (zone === "kst") return "KST";
  const p = fmt("en-GB", { timeZone: ZONES.uk.tz, timeZoneName: "short" }).formatToParts(new Date(unix * 1000));
  return p.find((x) => x.type === "timeZoneName")?.value ?? "UK";
}

const WD = ["일", "월", "화", "수", "목", "금", "토"];
const two = (n: number) => String(n).padStart(2, "0");

/** "11월 3일 (화) 04:00" */
export function dateTimeLong(unix: number, zone: Zone = current) {
  const p = parts(unix, zone);
  return `${p.mo}월 ${p.d}일 (${WD[p.wd]}) ${two(p.h)}:${two(p.mi)}`;
}

/** "11월 3일 04:00" */
export function dateTimeShort(unix: number, zone: Zone = current) {
  const p = parts(unix, zone);
  return `${p.mo}월 ${p.d}일 ${two(p.h)}:${two(p.mi)}`;
}

export function hourMinute(unix: number, zone: Zone = current) {
  const p = parts(unix, zone);
  return `${two(p.h)}:${two(p.mi)}`;
}
