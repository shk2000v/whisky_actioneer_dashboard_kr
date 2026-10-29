import type { LotView, PricePoint } from "./api";

export const gbp = (pence: number | null | undefined) =>
  pence == null ? "-" : `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const gbpN = (pounds: number) =>
  `£${pounds.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const krw = (v: number) => `${Math.round(v).toLocaleString("ko-KR")}원`;

export const usd = (v: number) => `$${v.toFixed(2)}`;

// Time-of-day formatting lives in time.ts (Korea or UK display zone, user toggle).
export { dateTimeShort as dateTime, dateTimeLong as dateTimeWeekday } from "./time";
const pad2 = (n: number) => String(n).padStart(2, "0");

/** 5일 02:59:12 / 02:59:12 */
export function countdownClock(endUnix: number, now = Date.now() / 1000) {
  const c = countdownParts(endUnix, now);
  if (c.done) return "마감";
  const hms = `${pad2(c.h)}:${pad2(c.m)}:${pad2(c.s)}`;
  return c.d > 0 ? `${c.d}일 ${hms}` : hms;
}

export function timeAgo(unix: number, now = Date.now() / 1000) {
  const s = Math.max(0, Math.floor(now - unix));
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

export function countdownParts(endUnix: number, now = Date.now() / 1000) {
  const s = Math.max(0, Math.floor(endUnix - now));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60, done: s === 0 };
}

export function countdown(endUnix: number, now = Date.now() / 1000) {
  const c = countdownParts(endUnix, now);
  if (c.done) return "종료";
  if (c.d > 0) return `${c.d}일 ${c.h}시간 ${c.m}분`;
  if (c.h > 0) return `${c.h}시간 ${c.m}분`;
  return `${c.m}분 ${c.s}초`;
}

export function duration(secs: number) {
  if (secs >= 3600) return `${Math.round(secs / 360) / 10}시간`;
  if (secs >= 60) return `${Math.round(secs / 60)}분`;
  return `${secs}초`;
}

/** Current bid in pounds, or the next minimum bid when nobody has bid yet. */
export function effectivePounds(v: LotView): number {
  const p = v.price;
  if (!p) return 0;
  return (p.currentBidPence > 0 ? p.currentBidPence : p.nextBidPence ?? 0) / 100;
}

export function reserveState(v: LotView): { label: string; tone: "none" | "below" | "met" } {
  const r = v.reservePence;
  if (r == null || r === 0) return { label: "없음", tone: "none" };
  const cur = v.price?.currentBidPence ?? 0;
  return cur >= r ? { label: `${gbp(r)} 충족`, tone: "met" } : { label: `${gbp(r)} 미달`, tone: "below" };
}

/** Change since the first recorded snapshot, in pence. */
export function changeSinceFirst(points: PricePoint[] | undefined): number | null {
  if (!points || points.length < 2) return null;
  const s = [...points].sort((a, b) => a.ts - b.ts);
  return s[s.length - 1].currentBidPence - s[0].currentBidPence;
}
