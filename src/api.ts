import { invoke } from "@tauri-apps/api/core";

// ---- types mirror wa-core (serde camelCase) ----

export interface LotPrice {
  entityId: number;
  auctionId: number;
  currentBidPence: number;
  bids: number;
  nextBidPence: number | null;
  fetchedAt: number;
}

export interface LotView {
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
  auctionSlug: string | null;
  price: LotPrice | null;
  watched: boolean;
  participating: boolean;
  myMaxGbp: number | null;
  note: string | null;
  bottles: number | null;
  volumeMl: number | null;
}

export interface FilterQuery {
  keyword?: string | null;
  facets: Record<string, string[]>;
  sort?: string | null;
  itemsPerPage?: number | null;
}

export interface AuctionRow {
  slug: string;
  title: string;
  path: string;
  hasLots: boolean;
  auctionId: number | null;
  endUnix: number | null;
  position: number;
}

export interface ActiveAuction {
  slug: string;
  title: string;
  auctionId: number;
  /** End time as given by the site; its exact meaning is not documented. */
  endUnix: number;
  /** Official closing start: 19:00 UK local time on the closing date. */
  closeUnix: number;
  isRunning: boolean;
}

export interface AuctionOverview {
  auctions: AuctionRow[];
  active: ActiveAuction | null;
}

export interface SearchResult {
  slug: string;
  page: number;
  perPage: number;
  totalRows: number | null;
  auctionId: number | null;
  isActive: boolean;
  lots: LotView[];
}

export interface FacetOption {
  id: string;
  label: string;
  count: number;
  active: boolean;
}
export interface Facet {
  key: string;
  field: string;
  label: string;
  options: FacetOption[];
}
export interface Facets {
  facets: Facet[];
  total: number;
}

export interface Preset {
  id: number;
  name: string;
  auctionSlug: string | null;
  query: FilterQuery;
  createdAt: number;
}

export interface PresetRun {
  auctionSlug: string;
  ranAt: number;
  totalRows: number | null;
  complete: boolean;
}

export interface PresetResult {
  preset: Preset;
  slug: string;
  run: PresetRun | null;
  isActive: boolean;
  lots: LotView[];
}

export interface PricePoint {
  ts: number;
  currentBidPence: number;
  bids: number;
}

export interface ProductAuctionPoint {
  sku: string;
  auctionSlug: string;
  auctionTitle: string | null;
  lastBidPence: number;
  bids: number;
  recordedAt: number;
  size: string | null;
}

export interface PollReport {
  polled: number;
  changed: string[];
  errors: string[];
  at: number;
}

export interface FxRecord {
  gbpKrw: number;
  gbpUsd: number;
  sourceUpdated: string;
  fetchedAt: number;
  source: string;
  stale: boolean;
}

export interface TaxSettings {
  commissionRate: number;
  shippingUsd: number;
  cardSurcharge: boolean;
  cardRate: number;
  fta: boolean;
  usdLimit: number;
  includeShippingInLimit: boolean;
  dutyRate: number;
  liquorRate: number;
  eduRate: number;
  vatRate: number;
}

export interface CalcItem {
  label?: string | null;
  hammerGbp: number;
  bottles: number;
  volumeMl: number;
}

export interface CalcResult {
  hammerGbp: number;
  commissionGbp: number;
  goodsGbp: number;
  goodsUsd: number;
  goodsKrw: number;
  shippingKrw: number;
  cifKrw: number;
  totalBottles: number;
  exempt: boolean;
  exemptReason: string;
  dutyKrw: number;
  liquorKrw: number;
  eduKrw: number;
  vatKrw: number;
  taxKrw: number;
  cardFeeKrw: number;
  totalKrw: number;
  perBottleKrw: number;
  exemptHammerLimitGbp: number;
}

export interface BasketResult {
  fx: FxRecord;
  atCurrent: CalcResult;
  atMyMax: CalcResult;
  items: CalcItem[];
}

export type PollMode =
  | { mode: "adaptive"; normalMinutes: number; finalWindowMinutes: number; finalMinutes: number }
  | { mode: "fixed"; minutes: number }
  | { mode: "realtime"; seconds: number };

export interface Settings {
  poll: PollMode;
  pageGapSecs: number;
  apiGapSecs: number;
  userAgent: string;
  maxPagesPerRun: number;
  pricesOnSearch: boolean;
  tax: TaxSettings;
}

export interface PollerStatus {
  nextPollInSecs: number;
  last: PollReport | null;
  error: string | null;
}

// ---- constants verified on the site (sort select / items_per_page select) ----

export const SORT_OPTIONS: [string, string][] = [
  ["relevance_DESC", "관련도순"],
  ["computed_current_bid_ASC", "현재가 낮은순"],
  ["computed_current_bid_DESC", "현재가 높은순"],
  ["name_ASC", "이름 A-Z"],
  ["name_DESC", "이름 Z-A"],
];
export const PAGE_SIZES = [16, 32, 64, 92, 184];

// ---- commands ----

export { isDemo } from "./demo/flag";
import { isDemo } from "./demo/flag";

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Every command goes through wa-core's single RPC surface (see wa-core/src/rpc.rs).
 * The web test build swaps in an in-browser stand-in that reads a captured snapshot (src/demo).
 */
function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isDemo()) {
    return import("./demo/backend").then((m) => m.dispatch(cmd, args) as Promise<T>);
  }
  return invoke<T>("rpc", { cmd, args });
}

export const api = {
  overview: (refresh = false) => call<AuctionOverview>("get_overview", { refresh }),
  search: (slug: string | null, query: FilterQuery, page: number, withPrices?: boolean) =>
    call<SearchResult>("search", { slug, query, page, withPrices: withPrices ?? null }),
  facets: (slug: string | null, query: FilterQuery) => call<Facets>("get_facets", { slug, query }),
  parseUrl: (url: string) => call<{ slug: string; query: FilterQuery }>("parse_wa_url", { url }),
  presets: () => call<Preset[]>("list_presets"),
  savePreset: (id: number | null, name: string, slug: string | null, query: FilterQuery) =>
    call<Preset>("save_preset", { id, name, slug, query }),
  presetFromUrl: (name: string, url: string, followActive: boolean) =>
    call<Preset>("preset_from_url", { name, url, followActive }),
  deletePreset: (id: number) => call<void>("delete_preset", { id }),
  presetCached: (id: number, slug: string | null) => call<PresetResult>("preset_cached", { id, slug }),
  runPreset: (id: number, slug: string | null, withPrices: boolean) =>
    call<PresetResult>("run_preset", { id, slug, withPrices }),
  watchlist: () => call<LotView[]>("watchlist"),
  watchAdd: (sku: string) => call<void>("watch_add", { sku }),
  watchRemove: (sku: string) => call<void>("watch_remove", { sku }),
  watchUpdate: (sku: string, participating: boolean, myMaxGbp: number | null, note: string | null) =>
    call<void>("watch_update", { sku, participating, myMaxGbp, note }),
  history: (sku: string) => call<PricePoint[]>("history", { sku }),
  productHistory: (sku: string) => call<ProductAuctionPoint[]>("product_history", { sku }),
  refreshPrices: (skus: string[]) => call<LotView[]>("refresh_prices", { skus }),
  pollNow: () => call<PollReport>("poll_now"),
  fx: (force = false) => call<FxRecord>("get_fx", { force }),
  setFxManual: (gbpKrw: number, gbpUsd: number) => call<FxRecord>("set_fx_manual", { gbpKrw, gbpUsd }),
  calculate: (items: CalcItem[], overrides: TaxSettings | null) =>
    call<{ result: CalcResult; fx: FxRecord }>("calculate", { items, overrides }),
  calculateEach: (items: CalcItem[]) => call<{ results: CalcResult[]; fx: FxRecord }>("calculate_each", { items }),
  basket: () => call<BasketResult>("basket"),
  settings: () => call<Settings>("get_settings"),
  saveSettings: (settings: Settings) => call<Settings>("save_settings", { settings }),
};

/** Desktop app or the web test build: something that can answer API calls. */
export const canRun = () => isTauri() || isDemo();

/** Open a lot page in the user's browser. */
export async function openExternal(url: string) {
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    return openUrl(url);
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function errMsg(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
}
