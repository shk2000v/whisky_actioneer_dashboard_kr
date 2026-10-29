//! Application service used by the Tauri commands and the CLI.

use crate::account::{self, Account, MyBid};
use crate::client::{WaClient, DEFAULT_BASE};
use crate::db::{AuctionRow, Db, Preset, PresetRun};
use crate::fx::{self, FxRecord};
use crate::models::*;
use crate::poll;
use crate::query::FilterQuery;
use crate::settings::Settings;
use crate::tax::{self, CalcItem, CalcResult, TaxSettings};
use crate::{now_unix, Error, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::RwLock;
use std::time::Duration;

/// Snapshot heartbeat: store an unchanged price at most once per hour.
const HEARTBEAT_SECS: i64 = 3600;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActiveAuction {
    pub slug: String,
    pub title: String,
    pub auction_id: i64,
    /// End time as given by the site (`drupalSettings.auction.activeAuctions`); meaning not documented.
    pub end_unix: i64,
    /// Official closing start: 19:00 UK local time on the closing date (FAQ). Bids after this extend
    /// the whole auction by two minutes.
    pub close_unix: i64,
    pub is_running: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuctionOverview {
    pub auctions: Vec<AuctionRow>,
    pub active: Option<ActiveAuction>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub slug: String,
    pub page: u32,
    pub per_page: u32,
    pub total_rows: Option<i64>,
    pub auction_id: Option<i64>,
    pub is_active: bool,
    pub lots: Vec<LotView>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PresetResult {
    pub preset: Preset,
    pub slug: String,
    pub run: Option<PresetRun>,
    pub is_active: bool,
    pub lots: Vec<LotView>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PollReport {
    pub polled: usize,
    pub changed: Vec<String>,
    pub errors: Vec<String>,
    pub at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BasketResult {
    pub fx: FxRecord,
    /// Using current bid (or next minimum bid when no bids yet).
    pub at_current: CalcResult,
    /// Using `my_max_gbp` where set, otherwise current.
    pub at_my_max: CalcResult,
    pub items: Vec<CalcItem>,
}

/// Result of reading the user's site account into the local watchlist.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSync {
    pub account: Account,
    pub bids: Vec<MyBid>,
    pub bookmarks: usize,
    /// Lots added to or updated in the local watchlist.
    pub imported: usize,
    /// Entity ids the site returned but no lot page here describes (title, size unknown).
    pub missing: Vec<i64>,
    pub synced_at: i64,
}

pub struct Service {
    pub db: Db,
    client: WaClient,
    settings: RwLock<Settings>,
    account: RwLock<Option<AccountSync>>,
}

fn secs(s: f64) -> Duration {
    Duration::from_secs_f64(s)
}

impl Service {
    pub fn open(db_path: &Path) -> Result<Self> {
        Self::with_db(Db::open(db_path)?, DEFAULT_BASE)
    }

    pub fn with_db(db: Db, base_url: &str) -> Result<Self> {
        let settings = db.load_settings()?;
        let client = WaClient::new(base_url, &settings.user_agent, secs(settings.page_gap_secs), secs(settings.api_gap_secs));
        Ok(Self { db, client, settings: RwLock::new(settings), account: RwLock::new(None) })
    }

    pub fn settings(&self) -> Settings {
        self.settings.read().unwrap().clone()
    }

    pub fn update_settings(&self, s: Settings) -> Result<Settings> {
        let s = s.sanitized();
        self.db.save_settings(&s)?;
        self.client.configure(&s.user_agent, secs(s.page_gap_secs), secs(s.api_gap_secs));
        *self.settings.write().unwrap() = s.clone();
        Ok(s)
    }

    /// Test-only: allow tiny gaps against a local mock server.
    #[doc(hidden)]
    pub fn set_gaps_unchecked(&self, page: Duration, api: Duration) {
        let s = self.settings();
        self.client.configure(&s.user_agent, page, api);
    }

    // ---------- auctions ----------

    fn active_from(&self, status: Option<&AuctionStatus>, rows: &[AuctionRow]) -> Option<ActiveAuction> {
        let st = status?;
        let slug = st.active_slug()?;
        let (id, end) = st.active_auctions.iter().next().map(|(a, b)| (*a, *b))?;
        let title = rows.iter().find(|r| r.slug == slug).map(|r| r.title.clone()).unwrap_or_else(|| crate::parse::prettify_slug(&slug));
        let running = st.is_running && now_unix() <= end + poll::AFTER_END_GRACE_SECS;
        let close_unix = crate::ukclock::official_close(end);
        Some(ActiveAuction { slug, title, auction_id: id, end_unix: end, close_unix, is_running: running })
    }

    pub fn cached_overview(&self) -> Result<AuctionOverview> {
        let auctions = self.db.auctions()?;
        let status = self.db.load_status()?;
        let active = self.active_from(status.as_ref(), &auctions);
        Ok(AuctionOverview { auctions, active })
    }

    pub async fn refresh_auctions(&self) -> Result<AuctionOverview> {
        let (list, status) = self.client.fetch_auction_index().await?;
        self.db.store_auctions(&list, status.as_ref())?;
        if let Some(st) = &status {
            self.db.save_status(st)?;
        }
        self.cached_overview()
    }

    /// Active auction from cache (refresh from the network if nothing is cached yet).
    pub async fn active_auction(&self) -> Result<Option<ActiveAuction>> {
        let ov = self.cached_overview()?;
        if ov.auctions.is_empty() {
            return Ok(self.refresh_auctions().await?.active);
        }
        Ok(ov.active)
    }

    fn is_active_slug(&self, slug: &str) -> bool {
        self.cached_overview().ok().and_then(|o| o.active).is_some_and(|a| a.is_running && a.slug == slug)
    }

    async fn resolve_slug(&self, slug: Option<&str>) -> Result<String> {
        if let Some(s) = slug.filter(|s| !s.is_empty()) {
            return Ok(s.to_string());
        }
        match self.active_auction().await? {
            Some(a) if a.is_running => Ok(a.slug),
            _ => Err(Error::other("진행 중인 경매가 없습니다. 지난 경매를 선택하세요.")),
        }
    }

    // ---------- search ----------

    pub async fn search(&self, slug: Option<&str>, q: &FilterQuery, page: u32, with_prices: Option<bool>) -> Result<SearchResult> {
        let slug = self.resolve_slug(slug).await?;
        let listing = self.client.fetch_listing(&slug, q, page).await?;
        self.after_listing(&slug, &listing)?;
        let is_active = self.is_active_slug(&slug);
        let skus: Vec<String> = listing.lots.iter().map(|l| l.sku.clone()).collect();
        if is_active && with_prices.unwrap_or(self.settings().prices_on_search) {
            self.refresh_prices(&listing.lots).await;
        }
        Ok(SearchResult {
            slug,
            page,
            per_page: q.per_page(),
            total_rows: listing.total_rows,
            auction_id: listing.auction_id,
            is_active,
            lots: self.db.views_for_skus(&skus)?,
        })
    }

    fn after_listing(&self, slug: &str, listing: &ListingPage) -> Result<()> {
        self.db.upsert_lots(&listing.lots, Some(slug))?;
        if let Some(id) = listing.auction_id {
            self.db.set_auction_id(slug, id)?;
        }
        if let Some(st) = &listing.status {
            self.db.save_status(st)?;
        }
        Ok(())
    }

    pub async fn facets(&self, slug: Option<&str>, q: &FilterQuery) -> Result<Facets> {
        let slug = self.resolve_slug(slug).await?;
        let mut id = self.db.auctions()?.into_iter().find(|a| a.slug == slug).and_then(|a| a.auction_id);
        if id.is_none() {
            let listing = self.client.fetch_listing(&slug, &FilterQuery { items_per_page: Some(16), ..Default::default() }, 0).await?;
            self.after_listing(&slug, &listing)?;
            id = listing.auction_id;
        }
        let id = id.ok_or_else(|| Error::other("경매 ID를 찾지 못했습니다"))?;
        self.client.fetch_facets(id, q).await
    }

    /// Fetch `/api/lot` for each lot that has ids; record snapshots. Returns skus whose price changed.
    async fn refresh_prices(&self, lots: &[Lot]) -> PollReport {
        let mut rep = PollReport { at: now_unix(), ..Default::default() };
        for l in lots {
            let (Some(a), Some(e)) = (l.auction_id, l.entity_id) else { continue };
            match self.client.fetch_price(a, e).await {
                Ok(p) => {
                    rep.polled += 1;
                    match self.db.record_price(&l.sku, &p, HEARTBEAT_SECS) {
                        Ok(true) => rep.changed.push(l.sku.clone()),
                        Ok(false) => {}
                        Err(err) => rep.errors.push(format!("{}: {err}", l.sku)),
                    }
                }
                Err(err) => rep.errors.push(format!("{}: {err}", l.sku)),
            }
        }
        rep
    }

    pub async fn refresh_prices_for(&self, skus: &[String]) -> Result<Vec<LotView>> {
        let views = self.db.views_for_skus(skus)?;
        let lots: Vec<Lot> = views.iter().map(|v| v.lot.clone()).collect();
        self.refresh_prices(&lots).await;
        self.db.views_for_skus(skus)
    }

    // ---------- presets ----------

    pub fn presets(&self) -> Result<Vec<Preset>> {
        self.db.presets()
    }

    pub fn save_preset(&self, id: Option<i64>, name: &str, slug: Option<&str>, q: &FilterQuery) -> Result<Preset> {
        if name.trim().is_empty() {
            return Err(Error::other("프리셋 이름을 입력하세요"));
        }
        let id = self.db.preset_save(id, name.trim(), slug.filter(|s| !s.is_empty()), q)?;
        self.db.preset(id)?.ok_or_else(|| Error::other("프리셋 저장 실패"))
    }

    pub fn preset_from_url(&self, name: &str, url: &str, follow_active: bool) -> Result<Preset> {
        let (slug, q) = FilterQuery::from_wa_url(url)?;
        self.save_preset(None, name, if follow_active { None } else { Some(&slug) }, &q)
    }

    pub fn delete_preset(&self, id: i64) -> Result<()> {
        self.db.preset_delete(id)
    }

    fn preset_or_err(&self, id: i64) -> Result<Preset> {
        self.db.preset(id)?.ok_or_else(|| Error::other("프리셋이 없습니다"))
    }

    /// Cached keys only: instant, no network (except resolving the active auction when nothing is cached).
    pub async fn preset_cached(&self, id: i64, slug_override: Option<&str>) -> Result<PresetResult> {
        let preset = self.preset_or_err(id)?;
        let slug = self.resolve_slug(slug_override.or(preset.auction_slug.as_deref())).await?;
        let (run, skus) = self.db.preset_cached(id, &slug)?;
        let is_active = self.is_active_slug(&slug);
        Ok(PresetResult { lots: self.db.views_for_skus(&skus)?, preset, slug, run, is_active })
    }

    /// Walk all listing pages for the preset (up to `max_pages_per_run`), cache lot keys, then fetch prices.
    pub async fn run_preset(&self, id: i64, slug_override: Option<&str>, with_prices: bool) -> Result<PresetResult> {
        let preset = self.preset_or_err(id)?;
        let slug = self.resolve_slug(slug_override.or(preset.auction_slug.as_deref())).await?;
        let max_pages = self.settings().max_pages_per_run;
        let per_page = preset.query.per_page();
        let mut skus: Vec<String> = Vec::new();
        let mut lots: Vec<Lot> = Vec::new();
        let mut total = None;
        let mut complete = false;
        for page in 0..max_pages {
            let listing = self.client.fetch_listing(&slug, &preset.query, page).await?;
            self.after_listing(&slug, &listing)?;
            total = listing.total_rows.or(total);
            let n = listing.lots.len();
            for l in listing.lots {
                if !skus.contains(&l.sku) {
                    skus.push(l.sku.clone());
                    lots.push(l);
                }
            }
            let reached_total = total.is_some_and(|t| skus.len() as i64 >= t);
            if n < per_page as usize || n == 0 || reached_total {
                complete = true;
                break;
            }
        }
        self.db.preset_store_run(id, &slug, &skus, total, complete)?;
        let is_active = self.is_active_slug(&slug);
        if with_prices && is_active {
            self.refresh_prices(&lots).await;
        }
        let (run, _) = self.db.preset_cached(id, &slug)?;
        Ok(PresetResult { lots: self.db.views_for_skus(&skus)?, preset, slug, run, is_active })
    }

    // ---------- site account ----------

    /// `Cookie` header from the app's login webview; `None` logs out of the app (the site session is untouched).
    pub fn set_session(&self, cookie: Option<String>) {
        if cookie.is_none() {
            *self.account.write().unwrap() = None;
        }
        self.client.set_session(cookie);
    }

    pub fn account(&self) -> Option<AccountSync> {
        self.account.read().unwrap().clone()
    }

    /// Reads the user's open bids and site watchlist (GET only) and folds them into the local watchlist:
    /// every watched or bid lot is watched here, winning bids become "participating", bid lots get the site's max bid as my max,
    /// so the watchlist basket shows the Korea landed cost without manual entry.
    pub async fn sync_account(&self) -> Result<AccountSync> {
        if !self.client.has_session() {
            return Err(Error::other("로그인되어 있지 않습니다. 설정에서 Whisky Auctioneer에 로그인하세요."));
        }
        let user = self.client.fetch_account_json("/api/user", None).await?;
        let Some(acc) = account::parse_user(&user) else {
            self.set_session(None);
            return Err(Error::other("사이트 로그인이 만료됐습니다. 다시 로그인하세요."));
        };
        let wa_id = Some(acc.uuid.as_str());
        let bids = account::parse_open_bids(&self.client.fetch_account_json(&format!("/api/auction/open/{}", acc.uid), wa_id).await?);
        let marks = account::parse_bookmarks(&self.client.fetch_account_json(&format!("/api/bookmarks/{}", acc.uid), wa_id).await?);

        // Only open-auction bookmarks matter for cost; closed ones stay on the site.
        let active = self.cached_overview()?.active.map(|a| a.auction_id);
        let marks: Vec<_> = marks.into_iter().filter(|m| active.is_none() || m.auction_id.is_none() || m.auction_id == active).collect();

        let wanted: Vec<i64> = bids.iter().map(|b| b.entity_id).chain(marks.iter().map(|m| m.entity_id)).collect();
        let unknown = |svc: &Self| wanted.iter().any(|e| svc.db.sku_for_entity(*e).ok().flatten().is_none());
        // Lot details (title, size, bottles) come from the user's own lot pages, parsed like a listing
        // (checked 2026-10-29: same `.lot-teaser`/`.bid-app-main` markup, 32 per page, `?page=N`).
        // Winning bids are on /buying, outbid ones on /buying/outbid. Pages are fetched only while lots are still unknown.
        let max_pages = self.settings().max_pages_per_run.max(1);
        'paths: for path in ["buying", "buying/outbid", "buying/watchlist"] {
            for page in 0..max_pages {
                if !unknown(self) {
                    break 'paths;
                }
                let Ok(listing) = self.client.fetch_user_listing(&format!("/user/{}/{path}", acc.uid), page).await else { break };
                self.db.upsert_lots(&listing.lots, None)?;
                if listing.lots.len() < 32 {
                    break;
                }
            }
        }

        let mut imported = 0;
        let mut missing = Vec::new();
        for e in &wanted {
            let Some(sku) = self.db.sku_for_entity(*e)? else {
                if !missing.contains(e) {
                    missing.push(*e);
                }
                continue;
            };
            self.db.watch_add(&sku)?;
            if let Some(b) = bids.iter().find(|b| b.entity_id == *e) {
                let note = self.db.views_for_skus(std::slice::from_ref(&sku))?.into_iter().next().and_then(|v| v.note);
                let max = b.max_pence.or(b.bid_pence).map(|p| p as f64 / 100.0);
                // Only lots I'm currently winning count toward what I'd pay; outbid ones keep my max for reference.
                self.db.watch_update(&sku, b.winning, max, note.as_deref())?;
            }
            imported += 1;
        }
        let out = AccountSync { account: acc, bookmarks: marks.len(), bids, imported, missing, synced_at: now_unix() };
        *self.account.write().unwrap() = Some(out.clone());
        Ok(out)
    }

    // ---------- watchlist ----------

    pub fn watch_add(&self, sku: &str) -> Result<()> {
        self.db.watch_add(sku)
    }
    pub fn watch_remove(&self, sku: &str) -> Result<()> {
        self.db.watch_remove(sku)
    }
    pub fn watch_update(&self, sku: &str, participating: bool, my_max_gbp: Option<f64>, note: Option<&str>) -> Result<()> {
        self.db.watch_update(sku, participating, my_max_gbp, note)
    }
    pub fn watchlist(&self) -> Result<Vec<LotView>> {
        let skus = self.db.watch_skus()?;
        self.db.views_for_skus(&skus)
    }
    pub fn history(&self, sku: &str) -> Result<Vec<PricePoint>> {
        self.db.history(sku)
    }
    pub fn product_history(&self, sku: &str) -> Result<Vec<ProductAuctionPoint>> {
        self.db.product_history(sku)
    }

    /// Poll prices of watched lots that belong to the running auction.
    pub async fn poll_watchlist(&self) -> Result<PollReport> {
        let active = self.cached_overview()?.active.filter(|a| a.is_running);
        let Some(active) = active else {
            return Ok(PollReport { at: now_unix(), ..Default::default() });
        };
        let lots: Vec<Lot> = self.watchlist()?.into_iter().map(|v| v.lot).filter(|l| l.auction_id == Some(active.auction_id)).collect();
        Ok(self.refresh_prices(&lots).await)
    }

    /// Next poll delay for the background loop.
    pub fn next_poll_delay(&self) -> Duration {
        let active = self.cached_overview().ok().and_then(|o| o.active);
        match active {
            Some(a) if a.is_running => poll::next_interval(&self.settings().poll, now_unix(), Some(a.close_unix), Some(a.end_unix)).unwrap_or(poll::IDLE_RECHECK),
            _ => poll::IDLE_RECHECK,
        }
    }

    // ---------- fx & calculator ----------

    /// Daily exchange rate: refreshed when missing, from a previous KST day, or forced.
    pub async fn fx(&self, force: bool) -> Result<FxRecord> {
        let cached = self.db.load_fx()?;
        let now = now_unix();
        let fresh = cached.as_ref().is_some_and(|c| fx::kst_day(c.fetched_at) == fx::kst_day(now));
        if fresh && !force {
            return Ok(cached.unwrap());
        }
        let fetched = match self.client.get_external_json(fx::FX_URL).await {
            Ok(v) => fx::parse_fx(&v, now),
            Err(e) => Err(e),
        };
        match (fetched, cached) {
            (Ok(rec), _) => {
                self.db.save_fx(&rec)?;
                Ok(rec)
            }
            (Err(_), Some(mut old)) => {
                old.stale = true;
                Ok(old)
            }
            (Err(e), None) => Err(e),
        }
    }

    pub fn set_fx_manual(&self, gbp_krw: f64, gbp_usd: f64) -> Result<FxRecord> {
        if gbp_krw <= 0.0 || gbp_usd <= 0.0 {
            return Err(Error::other("환율은 0보다 커야 합니다"));
        }
        let rec = FxRecord {
            gbp_krw,
            gbp_usd,
            source_updated: "수동 입력".into(),
            fetched_at: now_unix(),
            source: "manual".into(),
            stale: false,
        };
        self.db.save_fx(&rec)?;
        Ok(rec)
    }

    pub async fn calculate(&self, items: &[CalcItem], overrides: Option<TaxSettings>) -> Result<(CalcResult, FxRecord)> {
        let fx = self.fx(false).await?;
        let tax = overrides.unwrap_or(self.settings().tax);
        Ok((tax::calculate(items, &tax, &fx.fx()), fx))
    }

    /// Landed cost of each item shipped on its own (one parcel per item).
    pub async fn calculate_each(&self, items: &[CalcItem]) -> Result<(Vec<CalcResult>, FxRecord)> {
        let fx = self.fx(false).await?;
        let tax = self.settings().tax;
        let out = items.iter().map(|i| tax::calculate(std::slice::from_ref(i), &tax, &fx.fx())).collect();
        Ok((out, fx))
    }

    /// Korea landed cost for lots marked "participating" in the watchlist (combined shipment).
    pub async fn basket(&self) -> Result<BasketResult> {
        let fx = self.fx(false).await?;
        let tax_s = self.settings().tax;
        let parts: Vec<LotView> = self.watchlist()?.into_iter().filter(|v| v.participating).collect();
        let mk = |v: &LotView, use_max: bool| {
            let current = v
                .price
                .as_ref()
                .map(|p| if p.current_bid_pence > 0 { p.current_bid_pence } else { p.next_bid_pence.unwrap_or(0) })
                .unwrap_or(0) as f64
                / 100.0;
            let hammer = if use_max { v.my_max_gbp.filter(|m| *m > 0.0).unwrap_or(current) } else { current };
            CalcItem { label: Some(v.lot.title.clone()), hammer_gbp: hammer, bottles: v.bottles.unwrap_or(1), volume_ml: v.volume_ml.unwrap_or(700) }
        };
        let items_cur: Vec<CalcItem> = parts.iter().map(|v| mk(v, false)).collect();
        let items_max: Vec<CalcItem> = parts.iter().map(|v| mk(v, true)).collect();
        Ok(BasketResult {
            at_current: tax::calculate(&items_cur, &tax_s, &fx.fx()),
            at_my_max: tax::calculate(&items_max, &tax_s, &fx.fx()),
            fx,
            items: items_cur,
        })
    }
}
