/**
 * In-browser stand-in for wa-core, used only by the web test build (`npm run build:web`).
 *
 * Data: a snapshot of the live site captured once (window.__WT_SNAPSHOT__): lots, current bids,
 * reserve values, facet counts, the auction schedule and the day's exchange rate.
 * The browser cannot call whiskyauctioneer.com itself (its API sends no CORS headers),
 * so nothing here refreshes prices. Watchlist, presets and settings live in localStorage.
 */
import type {
  AuctionOverview,
  BasketResult,
  CalcItem,
  Facets,
  FilterQuery,
  FxRecord,
  LotPrice,
  LotView,
  PollReport,
  PricePoint,
  Preset,
  PresetResult,
  SearchResult,
  Settings,
} from "../api";
import { calculate, DEFAULT_TAX } from "./tax";

interface SnapLot {
  sku: string;
  entityId: number | null;
  auctionId: number | null;
  title: string;
  subtitle: string | null;
  url: string;
  image: string | null;
  bottled: string | null;
  size: string | null;
  abv: string | null;
  location: string | null;
  reservePence: number | null;
  attributes: string[];
  price?: LotPrice | null;
}

export interface Snapshot {
  capturedAt: number;
  auction: { slug: string; title: string; auctionId: number; endUnix: number; closeUnix: number };
  pastAuctions: { slug: string; title: string }[];
  query: string;
  total: number;
  lots: SnapLot[];
  fx: FxRecord;
}

declare global {
  interface Window {
    __WT_SNAPSHOT__?: Snapshot;
  }
}

const snap = (): Snapshot => window.__WT_SNAPSHOT__!;

// ---------- storage ----------
function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem("wt." + key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem("wt." + key, JSON.stringify(v));
  } catch {
    /* storage unavailable: changes last for this page load */
  }
}

interface WatchEntry {
  sku: string;
  addedAt: number;
  participating: boolean;
  myMaxGbp: number | null;
  note: string | null;
}

const DEFAULT_SETTINGS: Settings = {
  poll: { mode: "adaptive", normalMinutes: 30, finalWindowMinutes: 120, finalMinutes: 2 },
  pageGapSecs: 10,
  apiGapSecs: 0.5,
  userAgent: "WhiskyTracker/0.1.0 (web test build)",
  maxPagesPerRun: 40,
  pricesOnSearch: true,
  tax: DEFAULT_TAX,
};

const settings = (): Settings => ({ ...DEFAULT_SETTINGS, ...load<Partial<Settings>>("settings", {}) });
/**
 * First visit: start with a few real lots from the snapshot in the watchlist (two marked as bidding)
 * so the page opens in a working state. The note at the top of the page says these are examples.
 */
const EXAMPLE_WATCH: [string, boolean, number | null][] = [
  ["5290601", true, 95],
  ["5292530", true, 110],
  ["5290555", false, null],
  ["5288294", false, null],
  ["5290217", false, null],
];
function watch(): WatchEntry[] {
  const stored = load<WatchEntry[] | null>("watch", null);
  if (stored) return stored;
  const now = Date.now();
  const seeded = EXAMPLE_WATCH.filter(([sku]) => snap().lots.some((l) => l.sku === sku)).map(([sku, participating, myMaxGbp], i) => ({
    sku,
    addedAt: now - i,
    participating,
    myMaxGbp,
    note: null,
  }));
  save("watch", seeded);
  return seeded;
}
const setWatch = (w: WatchEntry[]) => save("watch", w);
const presets = (): Preset[] => load<Preset[]>("presets", []);
const setPresets = (p: Preset[]) => save("presets", p);
const fx = (): FxRecord => load<FxRecord | null>("fx", null) ?? snap().fx;

/** Example price path for the chart preview. Clearly labelled in the UI; never mixed with real points. */
export const exampleHistoryOn = () => load<boolean>("exampleHistory", false);
export const setExampleHistory = (on: boolean) => save("exampleHistory", on);

// ---------- lots ----------
function parseSize(size: string | null): [number, number] | null {
  if (!size) return null;
  const s = size.toLowerCase().replace(/\s+/g, "");
  const m = s.match(/^(?:(\d+)x)?([\d.]+)(ml|cl|litre|liter|ltr|l)$/);
  if (!m) return null;
  const mult = m[3] === "ml" ? 1 : m[3] === "cl" ? 10 : 1000;
  return [m[1] ? +m[1] : 1, Math.round(+m[2] * mult)];
}

function view(l: SnapLot): LotView {
  const w = watch().find((x) => x.sku === l.sku);
  const ps = parseSize(l.size);
  return {
    ...l,
    price: l.price ?? null,
    auctionSlug: snap().auction.slug,
    watched: !!w,
    participating: w?.participating ?? false,
    myMaxGbp: w?.myMaxGbp ?? null,
    note: w?.note ?? null,
    bottles: ps?.[0] ?? null,
    volumeMl: ps?.[1] ?? null,
  };
}
const bySku = (sku: string) => snap().lots.find((l) => l.sku === sku);
const views = (skus: string[]) => skus.map(bySku).filter((l): l is SnapLot => !!l).map(view);

// Facet ids observed on /api/facets for size and lot location (2026-10-28).
const SIZE_IDS: Record<string, string> = { "1": "5cl and below", "2": "6-19cl", "3": "20cl", "4": "35cl", "5": "50cl", "6": "70cl", "7": "75cl", "8": "100cl", "9": "150cl and above" };
const STORE_IDS: Record<string, string> = { "1": "UK", "4": "EU" };
function sizeId(size: string | null) {
  const ml = parseSize(size)?.[1];
  if (ml == null) return undefined;
  if (ml <= 50) return "1";
  if (ml < 200) return "2";
  if (ml === 200) return "3";
  if (ml === 350) return "4";
  if (ml === 500) return "5";
  if (ml === 700) return "6";
  if (ml >= 750 && ml < 1000) return "7";
  if (ml === 1000) return "8";
  if (ml >= 1500) return "9";
  return undefined;
}
// "UK + % VAT" lots are UK-stored lots that also carry VAT on the hammer price.
const storeId = (loc: string | null) => (loc?.startsWith("UK") ? "1" : loc?.startsWith("EU") ? "4" : undefined);

function price(l: SnapLot) {
  const p = l.price;
  return p ? (p.currentBidPence > 0 ? p.currentBidPence : p.nextBidPence ?? 0) : 0;
}

function filter(q: FilterQuery, skip?: "size" | "store") {
  const words = (q.keyword ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const sizes = q.facets?.size ?? [];
  const stores = q.facets?.store ?? [];
  return snap().lots.filter((l) => {
    const hay = `${l.title} ${l.subtitle ?? ""}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) return false;
    if (skip !== "size" && sizes.length && !sizes.includes(sizeId(l.size) ?? "")) return false;
    if (skip !== "store" && stores.length && !stores.includes(storeId(l.location) ?? "")) return false;
    return true;
  });
}

function sorted(lots: SnapLot[], sort?: string | null) {
  const out = [...lots];
  if (sort === "computed_current_bid_ASC") out.sort((a, b) => price(a) - price(b));
  else if (sort === "computed_current_bid_DESC") out.sort((a, b) => price(b) - price(a));
  else if (sort === "name_ASC") out.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === "name_DESC") out.sort((a, b) => b.title.localeCompare(a.title));
  return out;
}

function count(lots: SnapLot[], key: (l: SnapLot) => string | undefined, names: Record<string, string>) {
  return Object.entries(names)
    .map(([id, label]) => ({ id, label, count: lots.filter((l) => key(l) === id).length, active: false }))
    .filter((o) => o.count > 0);
}

function notActive(slug: string | null | undefined) {
  return !!slug && slug !== snap().auction.slug;
}

function search(slug: string | null, q: FilterQuery, page: number): SearchResult {
  const per = q.itemsPerPage ?? 32;
  if (notActive(slug)) return { slug: slug!, page, perPage: per, totalRows: 0, auctionId: null, isActive: false, lots: [] };
  const all = sorted(filter(q), q.sort);
  return {
    slug: snap().auction.slug,
    page,
    perPage: per,
    totalRows: all.length,
    auctionId: snap().auction.auctionId,
    isActive: true,
    lots: all.slice(page * per, page * per + per).map(view),
  };
}

function facets(slug: string | null, q: FilterQuery): Facets {
  if (notActive(slug)) return { facets: [], total: 0 };
  const sel = (key: string, opts: { id: string; label: string; count: number; active: boolean }[]) =>
    opts.map((o) => ({ ...o, active: (q.facets?.[key] ?? []).includes(o.id) }));
  return {
    total: filter(q).length,
    facets: [
      { key: "size", field: "whisky_rum_size", label: "Size", options: sel("size", count(filter(q, "size"), (l) => sizeId(l.size), SIZE_IDS)) },
      { key: "store", field: "stores", label: "Lot Location", options: sel("store", count(filter(q, "store"), (l) => storeId(l.location), STORE_IDS)) },
    ],
  };
}

function parseWaUrl(input: string) {
  const u = new URL(input.trim());
  const m = u.pathname.match(/^\/whisky-auctions\/([^/]+)/);
  if (!m) throw "Whisky Auctioneer 경매 목록 URL이 아닙니다 (/whisky-auctions/{경매}/lots 형식이어야 합니다)";
  const q: FilterQuery = { keyword: null, facets: {}, sort: null, itemsPerPage: null };
  u.searchParams.forEach((v, k) => {
    if (k === "search_keyword") q.keyword = v || null;
    else if (k === "sort_bef_combine") q.sort = v;
    else if (k === "items_per_page") q.itemsPerPage = +v || null;
    else {
      const f = k.match(/^(\w+)\[(\w*)\]$/);
      if (f) {
        const id = f[2] || v;
        q.facets[f[1]] = [...new Set([...(q.facets[f[1]] ?? []), id])];
      }
    }
  });
  return { slug: m[1], query: q };
}

function overview(): AuctionOverview {
  const s = snap();
  const now = Date.now() / 1000;
  const running = now <= s.auction.endUnix + 15 * 60;
  return {
    active: { slug: s.auction.slug, title: s.auction.title, auctionId: s.auction.auctionId, endUnix: s.auction.endUnix, closeUnix: s.auction.closeUnix, isRunning: running },
    auctions: [
      { slug: s.auction.slug, title: s.auction.title, path: `/whisky-auctions/${s.auction.slug}/lots`, hasLots: true, auctionId: s.auction.auctionId, endUnix: s.auction.endUnix, position: 0 },
      ...s.pastAuctions.map((a, i) => ({ slug: a.slug, title: a.title, path: `/whisky-auctions/${a.slug}/lots`, hasLots: true, auctionId: null, endUnix: null, position: i + 1 })),
    ],
  };
}

function history(sku: string): PricePoint[] {
  const l = bySku(sku);
  if (!l?.price) return [];
  const real = { ts: l.price.fetchedAt, currentBidPence: l.price.currentBidPence, bids: l.price.bids };
  if (!exampleHistoryOn() || real.currentBidPence <= 0) return [real];
  // Example only: walk back from the real current bid in the site's bid increments.
  const steps = Math.min(6, Math.max(2, real.bids));
  const out: PricePoint[] = [];
  let v = real.currentBidPence;
  for (let i = 0; i < steps; i++) {
    out.unshift({ ts: real.ts - i * 9 * 3600 - (i * 7919) % 5400, currentBidPence: v, bids: Math.max(1, real.bids - i) });
    v = Math.max(2000, Math.round((v * 0.86) / 100) * 100);
  }
  return out;
}

function basket(): BasketResult {
  const s = settings();
  const f = fx();
  const parts = views(watch().filter((w) => w.participating).map((w) => w.sku));
  const cur = (v: LotView) => (v.price ? (v.price.currentBidPence > 0 ? v.price.currentBidPence : v.price.nextBidPence ?? 0) / 100 : 0);
  const mk = (v: LotView, useMax: boolean): CalcItem => ({
    label: v.title,
    hammerGbp: useMax && v.myMaxGbp && v.myMaxGbp > 0 ? v.myMaxGbp : cur(v),
    bottles: v.bottles ?? 1,
    volumeMl: v.volumeMl ?? 700,
  });
  const items = parts.map((v) => mk(v, false));
  return { fx: f, atCurrent: calculate(items, s.tax, f), atMyMax: calculate(parts.map((v) => mk(v, true)), s.tax, f), items };
}

function presetResult(id: number, slug: string | null, run: boolean): PresetResult {
  const p = presets().find((x) => x.id === id);
  if (!p) throw "프리셋이 없습니다";
  const target = slug ?? p.auctionSlug ?? snap().auction.slug;
  const key = `presetRun.${id}.${target}`;
  if (run) {
    const r = search(target, { ...p.query, itemsPerPage: 100000 }, 0);
    save(key, { auctionSlug: target, ranAt: Math.floor(Date.now() / 1000), totalRows: r.totalRows, complete: true, skus: r.lots.map((l) => l.sku) });
  }
  const stored = load<{ auctionSlug: string; ranAt: number; totalRows: number | null; complete: boolean; skus: string[] } | null>(key, null);
  return {
    preset: p,
    slug: target,
    run: stored ? { auctionSlug: stored.auctionSlug, ranAt: stored.ranAt, totalRows: stored.totalRows, complete: stored.complete } : null,
    isActive: !notActive(target),
    lots: views(stored?.skus ?? []),
  };
}

const noPoll = (): PollReport => ({ polled: 0, changed: [], errors: [], at: Math.floor(Date.now() / 1000) });

type Args = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function dispatch(cmd: string, a: Args): Promise<unknown> {
  switch (cmd) {
    case "get_overview":
      return overview();
    case "search":
      return search(a.slug, a.query, a.page ?? 0);
    case "get_facets":
      return facets(a.slug, a.query);
    case "parse_wa_url":
      return parseWaUrl(a.url);
    case "list_presets":
      return [...presets()].sort((x, y) => x.name.localeCompare(y.name));
    case "save_preset": {
      if (!a.name?.trim()) throw "프리셋 이름을 입력하세요";
      const all = presets();
      const id = a.id ?? Math.max(0, ...all.map((p) => p.id)) + 1;
      const p: Preset = { id, name: a.name.trim(), auctionSlug: a.slug ?? null, query: a.query, createdAt: Math.floor(Date.now() / 1000) };
      setPresets([...all.filter((x) => x.id !== id), p]);
      return p;
    }
    case "preset_from_url": {
      const { slug, query } = parseWaUrl(a.url);
      return dispatch("save_preset", { id: null, name: a.name, slug: a.followActive ? null : slug, query });
    }
    case "delete_preset":
      setPresets(presets().filter((p) => p.id !== a.id));
      return null;
    case "preset_cached":
      return presetResult(a.id, a.slug, false);
    case "run_preset":
      return presetResult(a.id, a.slug, true);
    case "watchlist":
      return views(watch().sort((x, y) => y.addedAt - x.addedAt).map((w) => w.sku));
    case "watch_add":
      if (!watch().some((w) => w.sku === a.sku)) setWatch([...watch(), { sku: a.sku, addedAt: Date.now(), participating: false, myMaxGbp: null, note: null }]);
      return null;
    case "watch_remove":
      setWatch(watch().filter((w) => w.sku !== a.sku));
      return null;
    case "watch_update":
      setWatch(watch().map((w) => (w.sku === a.sku ? { ...w, participating: a.participating, myMaxGbp: a.myMaxGbp, note: a.note } : w)));
      return null;
    case "history":
      return history(a.sku);
    case "product_history":
      return [];
    case "refresh_prices":
      return views(a.skus);
    case "poll_now":
      return noPoll();
    case "get_fx":
      return fx();
    case "set_fx_manual": {
      if (!(a.gbpKrw > 0 && a.gbpUsd > 0)) throw "환율은 0보다 커야 합니다";
      const r: FxRecord = { gbpKrw: a.gbpKrw, gbpUsd: a.gbpUsd, sourceUpdated: "수동 입력", fetchedAt: Math.floor(Date.now() / 1000), source: "manual", stale: false };
      save("fx", r);
      return r;
    }
    case "calculate":
      return { result: calculate(a.items, a.overrides ?? settings().tax, fx()), fx: fx() };
    case "calculate_each":
      return { results: (a.items as CalcItem[]).map((i) => calculate([i], settings().tax, fx())), fx: fx() };
    case "basket":
      return basket();
    case "get_settings":
      return settings();
    case "save_settings":
      save("settings", a.settings);
      return settings();
    default:
      throw `알 수 없는 명령: ${cmd}`;
  }
}
