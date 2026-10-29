//! SQLite cache: lots, price snapshots, watchlist, presets (+ cached lot keys), auctions, fx, settings.

use crate::fx::FxRecord;
use crate::models::*;
use crate::query::FilterQuery;
use crate::settings::Settings;
use crate::{now_unix, Result};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS lots (
  sku TEXT PRIMARY KEY,
  entity_id INTEGER,
  auction_id INTEGER,
  auction_slug TEXT,
  title TEXT NOT NULL,
  subtitle TEXT,
  url TEXT NOT NULL,
  image TEXT,
  bottled TEXT,
  size TEXT,
  abv TEXT,
  location TEXT,
  reserve_pence INTEGER,
  attributes TEXT NOT NULL DEFAULT '[]',
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS lots_entity ON lots(entity_id);
CREATE INDEX IF NOT EXISTS lots_slug ON lots(auction_slug);
CREATE TABLE IF NOT EXISTS price_snapshots (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL,
  ts INTEGER NOT NULL,
  current_bid_pence INTEGER NOT NULL,
  bids INTEGER NOT NULL,
  next_bid_pence INTEGER
);
CREATE INDEX IF NOT EXISTS snap_sku_ts ON price_snapshots(sku, ts);
CREATE TABLE IF NOT EXISTS watchlist (
  sku TEXT PRIMARY KEY,
  added_at INTEGER NOT NULL,
  participating INTEGER NOT NULL DEFAULT 0,
  my_max_gbp REAL,
  note TEXT
);
CREATE TABLE IF NOT EXISTS presets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  auction_slug TEXT,
  query TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS preset_runs (
  preset_id INTEGER NOT NULL,
  auction_slug TEXT NOT NULL,
  ran_at INTEGER NOT NULL,
  total_rows INTEGER,
  complete INTEGER NOT NULL,
  PRIMARY KEY (preset_id, auction_slug)
);
CREATE TABLE IF NOT EXISTS preset_lots (
  preset_id INTEGER NOT NULL,
  auction_slug TEXT NOT NULL,
  position INTEGER NOT NULL,
  sku TEXT NOT NULL,
  PRIMARY KEY (preset_id, auction_slug, sku)
);
CREATE TABLE IF NOT EXISTS auctions (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  path TEXT NOT NULL,
  has_lots INTEGER NOT NULL,
  auction_id INTEGER,
  end_unix INTEGER,
  position INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"#;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuctionRow {
    pub slug: String,
    pub title: String,
    pub path: String,
    pub has_lots: bool,
    pub auction_id: Option<i64>,
    pub end_unix: Option<i64>,
    pub position: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: i64,
    pub name: String,
    /// None = follow the currently running auction.
    pub auction_slug: Option<String>,
    pub query: FilterQuery,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PresetRun {
    pub auction_slug: String,
    pub ran_at: i64,
    pub total_rows: Option<i64>,
    pub complete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WatchEntry {
    pub sku: String,
    pub added_at: i64,
    pub participating: bool,
    pub my_max_gbp: Option<f64>,
    pub note: Option<String>,
}

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        Self::init(Connection::open(path)?)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    fn with<T>(&self, f: impl FnOnce(&mut Connection) -> rusqlite::Result<T>) -> Result<T> {
        let mut c = self.conn.lock().unwrap();
        Ok(f(&mut c)?)
    }

    // ---------- meta / settings / fx ----------

    fn meta_get(&self, key: &str) -> Result<Option<String>> {
        self.with(|c| c.query_row("SELECT value FROM meta WHERE key=?1", [key], |r| r.get(0)).optional())
    }

    fn meta_set(&self, key: &str, value: &str) -> Result<()> {
        self.with(|c| {
            c.execute("INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, value])
                .map(|_| ())
        })
    }

    pub fn load_settings(&self) -> Result<Settings> {
        Ok(match self.meta_get("settings")? {
            Some(s) => serde_json::from_str::<Settings>(&s).unwrap_or_default().sanitized(),
            None => Settings::default(),
        })
    }

    pub fn save_settings(&self, s: &Settings) -> Result<()> {
        self.meta_set("settings", &serde_json::to_string(s)?)
    }

    pub fn load_fx(&self) -> Result<Option<FxRecord>> {
        Ok(self.meta_get("fx")?.and_then(|s| serde_json::from_str(&s).ok()))
    }

    pub fn save_fx(&self, fx: &FxRecord) -> Result<()> {
        self.meta_set("fx", &serde_json::to_string(fx)?)
    }

    // ---------- lots ----------

    pub fn upsert_lots(&self, lots: &[Lot], slug: Option<&str>) -> Result<()> {
        let now = now_unix();
        self.with(|c| {
            let tx = c.transaction()?;
            {
                let mut st = tx.prepare(
                    "INSERT INTO lots(sku,entity_id,auction_id,auction_slug,title,subtitle,url,image,bottled,size,abv,location,reserve_pence,attributes,first_seen,last_seen)
                     VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?15)
                     ON CONFLICT(sku) DO UPDATE SET
                       entity_id=COALESCE(excluded.entity_id, lots.entity_id),
                       auction_id=COALESCE(excluded.auction_id, lots.auction_id),
                       auction_slug=COALESCE(excluded.auction_slug, lots.auction_slug),
                       title=excluded.title, subtitle=excluded.subtitle, url=excluded.url,
                       image=COALESCE(excluded.image, lots.image), bottled=excluded.bottled, size=excluded.size,
                       abv=excluded.abv, location=excluded.location,
                       reserve_pence=COALESCE(excluded.reserve_pence, lots.reserve_pence),
                       attributes=excluded.attributes, last_seen=excluded.last_seen",
                )?;
                for l in lots {
                    st.execute(params![
                        l.sku,
                        l.entity_id,
                        l.auction_id,
                        slug,
                        l.title,
                        l.subtitle,
                        l.url,
                        l.image,
                        l.bottled,
                        l.size,
                        l.abv,
                        l.location,
                        l.reserve_pence,
                        serde_json::to_string(&l.attributes).unwrap_or_else(|_| "[]".into()),
                        now
                    ])?;
                }
            }
            tx.commit()
        })
    }

    pub fn sku_for_entity(&self, entity_id: i64) -> Result<Option<String>> {
        self.with(|c| c.query_row("SELECT sku FROM lots WHERE entity_id=?1", [entity_id], |r| r.get(0)).optional())
    }

    // ---------- prices ----------

    /// Store a snapshot when the price changed, when none exists, or when the last one is older than `heartbeat_secs`.
    /// Returns true if a row was inserted and the value changed.
    pub fn record_price(&self, sku: &str, p: &LotPrice, heartbeat_secs: i64) -> Result<bool> {
        self.with(|c| {
            let last: Option<(i64, i64, i64)> = c
                .query_row(
                    "SELECT ts,current_bid_pence,bids FROM price_snapshots WHERE sku=?1 ORDER BY ts DESC, id DESC LIMIT 1",
                    [sku],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()?;
            let changed = match last {
                None => true,
                Some((_, bid, bids)) => bid != p.current_bid_pence || bids != p.bids,
            };
            let stale = last.is_some_and(|(ts, _, _)| p.fetched_at - ts >= heartbeat_secs);
            if changed || stale {
                c.execute(
                    "INSERT INTO price_snapshots(sku,ts,current_bid_pence,bids,next_bid_pence) VALUES(?1,?2,?3,?4,?5)",
                    params![sku, p.fetched_at, p.current_bid_pence, p.bids, p.next_bid_pence],
                )?;
            }
            Ok(changed && last.is_some())
        })
    }

    pub fn history(&self, sku: &str) -> Result<Vec<PricePoint>> {
        self.with(|c| {
            let mut st = c.prepare("SELECT ts,current_bid_pence,bids FROM price_snapshots WHERE sku=?1 ORDER BY ts, id")?;
            let rows = st.query_map([sku], |r| Ok(PricePoint { ts: r.get(0)?, current_bid_pence: r.get(1)?, bids: r.get(2)? }))?;
            rows.collect()
        })
    }

    /// Same product across auctions: lots whose title matches (case/space-insensitive) and that have
    /// at least one recorded price. Hammer prices of past auctions are login-only on the site, so this
    /// is limited to lots this app tracked while their auction was running.
    pub fn product_history(&self, sku: &str) -> Result<Vec<ProductAuctionPoint>> {
        self.with(|c| {
            let title: Option<String> = c.query_row("SELECT title FROM lots WHERE sku=?1", [sku], |r| r.get(0)).optional()?;
            let Some(title) = title else { return Ok(Vec::new()) };
            let mut st = c.prepare(
                "SELECT l.sku, l.auction_slug, a.title, p.current_bid_pence, p.bids, p.ts, l.size
                 FROM lots l
                 JOIN price_snapshots p ON p.id = (SELECT id FROM price_snapshots WHERE sku=l.sku ORDER BY ts DESC, id DESC LIMIT 1)
                 LEFT JOIN auctions a ON a.slug = l.auction_slug
                 WHERE lower(trim(l.title)) = lower(trim(?1)) AND l.auction_slug IS NOT NULL
                 ORDER BY p.ts",
            )?;
            let rows = st.query_map([title], |r| {
                Ok(ProductAuctionPoint {
                    sku: r.get(0)?,
                    auction_slug: r.get(1)?,
                    auction_title: r.get(2)?,
                    last_bid_pence: r.get(3)?,
                    bids: r.get(4)?,
                    recorded_at: r.get(5)?,
                    size: r.get(6)?,
                })
            })?;
            rows.collect()
        })
    }

    // ---------- views ----------

    const VIEW_SELECT: &'static str = "SELECT l.sku,l.entity_id,l.auction_id,l.auction_slug,l.title,l.subtitle,l.url,l.image,l.bottled,l.size,l.abv,l.location,l.reserve_pence,l.attributes,
        p.ts,p.current_bid_pence,p.bids,p.next_bid_pence,
        w.sku IS NOT NULL, COALESCE(w.participating,0), w.my_max_gbp, w.note
        FROM lots l
        LEFT JOIN price_snapshots p ON p.id = (SELECT id FROM price_snapshots WHERE sku=l.sku ORDER BY ts DESC, id DESC LIMIT 1)
        LEFT JOIN watchlist w ON w.sku=l.sku";

    fn row_to_view(r: &Row) -> rusqlite::Result<LotView> {
        let attrs: String = r.get(13)?;
        let size: Option<String> = r.get(9)?;
        let parsed = size.as_deref().and_then(parse_size);
        let entity_id: Option<i64> = r.get(1)?;
        let auction_id: Option<i64> = r.get(2)?;
        let ts: Option<i64> = r.get(14)?;
        let price = match (ts, entity_id, auction_id) {
            (Some(ts), Some(e), Some(a)) => Some(LotPrice {
                entity_id: e,
                auction_id: a,
                current_bid_pence: r.get(15)?,
                bids: r.get(16)?,
                next_bid_pence: r.get(17)?,
                fetched_at: ts,
            }),
            _ => None,
        };
        Ok(LotView {
            lot: Lot {
                sku: r.get(0)?,
                entity_id,
                auction_id,
                title: r.get(4)?,
                subtitle: r.get(5)?,
                url: r.get(6)?,
                image: r.get(7)?,
                bottled: r.get(8)?,
                size,
                abv: r.get(10)?,
                location: r.get(11)?,
                reserve_pence: r.get(12)?,
                attributes: serde_json::from_str(&attrs).unwrap_or_default(),
            },
            auction_slug: r.get(3)?,
            price,
            watched: r.get(18)?,
            participating: r.get::<_, i64>(19)? != 0,
            my_max_gbp: r.get(20)?,
            note: r.get(21)?,
            bottles: parsed.map(|p| p.0),
            volume_ml: parsed.map(|p| p.1),
        })
    }

    pub fn views_for_skus(&self, skus: &[String]) -> Result<Vec<LotView>> {
        let mut out = Vec::with_capacity(skus.len());
        self.with(|c| {
            let mut st = c.prepare_cached(&format!("{} WHERE l.sku=?1", Self::VIEW_SELECT))?;
            for s in skus {
                if let Some(v) = st.query_row([s], Self::row_to_view).optional()? {
                    out.push(v);
                }
            }
            Ok(())
        })?;
        Ok(out)
    }

    // ---------- watchlist ----------

    pub fn watch_add(&self, sku: &str) -> Result<()> {
        self.with(|c| c.execute("INSERT OR IGNORE INTO watchlist(sku,added_at) VALUES(?1,?2)", params![sku, now_unix()]).map(|_| ()))
    }

    pub fn watch_remove(&self, sku: &str) -> Result<()> {
        self.with(|c| c.execute("DELETE FROM watchlist WHERE sku=?1", [sku]).map(|_| ()))
    }

    pub fn watch_update(&self, sku: &str, participating: bool, my_max_gbp: Option<f64>, note: Option<&str>) -> Result<()> {
        self.with(|c| {
            c.execute(
                "UPDATE watchlist SET participating=?2, my_max_gbp=?3, note=?4 WHERE sku=?1",
                params![sku, participating as i64, my_max_gbp, note],
            )
            .map(|_| ())
        })
    }

    pub fn watch_skus(&self) -> Result<Vec<String>> {
        self.with(|c| {
            let mut st = c.prepare("SELECT sku FROM watchlist ORDER BY added_at DESC")?;
            let rows = st.query_map([], |r| r.get(0))?;
            rows.collect()
        })
    }

    // ---------- presets ----------

    pub fn preset_save(&self, id: Option<i64>, name: &str, slug: Option<&str>, q: &FilterQuery) -> Result<i64> {
        let qs = serde_json::to_string(q)?;
        self.with(|c| match id {
            Some(id) => {
                c.execute("UPDATE presets SET name=?2, auction_slug=?3, query=?4 WHERE id=?1", params![id, name, slug, qs])?;
                c.execute("DELETE FROM preset_lots WHERE preset_id=?1", [id])?;
                c.execute("DELETE FROM preset_runs WHERE preset_id=?1", [id])?;
                Ok(id)
            }
            None => {
                c.execute(
                    "INSERT INTO presets(name,auction_slug,query,created_at) VALUES(?1,?2,?3,?4)",
                    params![name, slug, qs, now_unix()],
                )?;
                Ok(c.last_insert_rowid())
            }
        })
    }

    pub fn preset_delete(&self, id: i64) -> Result<()> {
        self.with(|c| {
            c.execute("DELETE FROM preset_lots WHERE preset_id=?1", [id])?;
            c.execute("DELETE FROM preset_runs WHERE preset_id=?1", [id])?;
            c.execute("DELETE FROM presets WHERE id=?1", [id]).map(|_| ())
        })
    }

    fn row_to_preset(r: &Row) -> rusqlite::Result<Preset> {
        let q: String = r.get(3)?;
        Ok(Preset {
            id: r.get(0)?,
            name: r.get(1)?,
            auction_slug: r.get(2)?,
            query: serde_json::from_str(&q).unwrap_or_default(),
            created_at: r.get(4)?,
        })
    }

    pub fn presets(&self) -> Result<Vec<Preset>> {
        self.with(|c| {
            let mut st = c.prepare("SELECT id,name,auction_slug,query,created_at FROM presets ORDER BY name")?;
            let rows = st.query_map([], Self::row_to_preset)?;
            rows.collect()
        })
    }

    pub fn preset(&self, id: i64) -> Result<Option<Preset>> {
        self.with(|c| c.query_row("SELECT id,name,auction_slug,query,created_at FROM presets WHERE id=?1", [id], Self::row_to_preset).optional())
    }

    pub fn preset_store_run(&self, id: i64, slug: &str, skus: &[String], total: Option<i64>, complete: bool) -> Result<()> {
        self.with(|c| {
            let tx = c.transaction()?;
            tx.execute("DELETE FROM preset_lots WHERE preset_id=?1 AND auction_slug=?2", params![id, slug])?;
            {
                let mut st = tx.prepare("INSERT OR IGNORE INTO preset_lots(preset_id,auction_slug,position,sku) VALUES(?1,?2,?3,?4)")?;
                for (i, s) in skus.iter().enumerate() {
                    st.execute(params![id, slug, i as i64, s])?;
                }
            }
            tx.execute(
                "INSERT INTO preset_runs(preset_id,auction_slug,ran_at,total_rows,complete) VALUES(?1,?2,?3,?4,?5)
                 ON CONFLICT(preset_id,auction_slug) DO UPDATE SET ran_at=excluded.ran_at,total_rows=excluded.total_rows,complete=excluded.complete",
                params![id, slug, now_unix(), total, complete as i64],
            )?;
            tx.commit()
        })
    }

    pub fn preset_cached(&self, id: i64, slug: &str) -> Result<(Option<PresetRun>, Vec<String>)> {
        self.with(|c| {
            let run = c
                .query_row(
                    "SELECT auction_slug,ran_at,total_rows,complete FROM preset_runs WHERE preset_id=?1 AND auction_slug=?2",
                    params![id, slug],
                    |r| Ok(PresetRun { auction_slug: r.get(0)?, ran_at: r.get(1)?, total_rows: r.get(2)?, complete: r.get::<_, i64>(3)? != 0 }),
                )
                .optional()?;
            let mut st = c.prepare("SELECT sku FROM preset_lots WHERE preset_id=?1 AND auction_slug=?2 ORDER BY position")?;
            let skus = st.query_map(params![id, slug], |r| r.get(0))?.collect::<rusqlite::Result<Vec<String>>>()?;
            Ok((run, skus))
        })
    }

    // ---------- auctions ----------

    pub fn store_auctions(&self, list: &[AuctionRef], status: Option<&AuctionStatus>) -> Result<()> {
        let now = now_unix();
        let active_slug = status.and_then(|s| s.active_slug());
        let active_entry = status.and_then(|s| s.active_auctions.iter().next().map(|(a, b)| (*a, *b)));
        self.with(|c| {
            let tx = c.transaction()?;
            for (i, a) in list.iter().enumerate() {
                tx.execute(
                    "INSERT INTO auctions(slug,title,path,has_lots,position,updated_at) VALUES(?1,?2,?3,?4,?5,?6)
                     ON CONFLICT(slug) DO UPDATE SET title=excluded.title,path=excluded.path,has_lots=excluded.has_lots,position=excluded.position,updated_at=excluded.updated_at",
                    params![a.slug, a.title, a.path, a.has_lots as i64, i as i64, now],
                )?;
            }
            if let (Some(slug), Some((id, end))) = (active_slug, active_entry) {
                tx.execute("UPDATE auctions SET auction_id=?2, end_unix=?3 WHERE slug=?1", params![slug, id, end])?;
            }
            tx.commit()
        })
    }

    pub fn set_auction_id(&self, slug: &str, auction_id: i64) -> Result<()> {
        self.with(|c| c.execute("UPDATE auctions SET auction_id=?2 WHERE slug=?1", params![slug, auction_id]).map(|_| ()))
    }

    pub fn auctions(&self) -> Result<Vec<AuctionRow>> {
        self.with(|c| {
            let mut st = c.prepare("SELECT slug,title,path,has_lots,auction_id,end_unix,position FROM auctions ORDER BY position")?;
            let rows = st.query_map([], |r| {
                Ok(AuctionRow {
                    slug: r.get(0)?,
                    title: r.get(1)?,
                    path: r.get(2)?,
                    has_lots: r.get::<_, i64>(3)? != 0,
                    auction_id: r.get(4)?,
                    end_unix: r.get(5)?,
                    position: r.get(6)?,
                })
            })?;
            rows.collect()
        })
    }

    pub fn save_status(&self, status: &AuctionStatus) -> Result<()> {
        self.meta_set("auction_status", &serde_json::to_string(status)?)
    }

    pub fn load_status(&self) -> Result<Option<AuctionStatus>> {
        Ok(self.meta_get("auction_status")?.and_then(|s| serde_json::from_str(&s).ok()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lot(sku: &str) -> Lot {
        Lot {
            sku: sku.into(),
            entity_id: Some(1),
            auction_id: Some(9),
            title: "T".into(),
            url: "u".into(),
            size: Some("70cl".into()),
            reserve_pence: Some(0),
            ..Default::default()
        }
    }

    #[test]
    fn snapshots_dedupe() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_lots(&[lot("A")], Some("s")).unwrap();
        let p = |ts, bid| LotPrice { entity_id: 1, auction_id: 9, current_bid_pence: bid, bids: 1, next_bid_pence: None, fetched_at: ts };
        assert!(!db.record_price("A", &p(100, 2000), 3600).unwrap());
        assert!(!db.record_price("A", &p(200, 2000), 3600).unwrap()); // unchanged, not stored
        assert!(db.record_price("A", &p(300, 2200), 3600).unwrap());
        assert!(!db.record_price("A", &p(4000, 2200), 3600).unwrap()); // heartbeat stored
        assert_eq!(db.history("A").unwrap().len(), 3);
        let v = db.views_for_skus(&["A".into()]).unwrap();
        assert_eq!(v[0].price.as_ref().unwrap().current_bid_pence, 2200);
        assert_eq!(v[0].bottles, Some(1));
    }

    #[test]
    fn presets_and_watch() {
        let db = Db::open_in_memory().unwrap();
        db.upsert_lots(&[lot("A"), lot("B")], Some("s")).unwrap();
        let id = db.preset_save(None, "old 70cl", None, &FilterQuery { keyword: Some("old".into()), ..Default::default() }).unwrap();
        db.preset_store_run(id, "s", &["B".into(), "A".into()], Some(2), true).unwrap();
        let (run, skus) = db.preset_cached(id, "s").unwrap();
        assert!(run.unwrap().complete);
        assert_eq!(skus, vec!["B", "A"]);
        db.watch_add("A").unwrap();
        db.watch_update("A", true, Some(30.0), Some("메모")).unwrap();
        let v = db.views_for_skus(&["A".into()]).unwrap();
        assert!(v[0].watched && v[0].participating);
        assert_eq!(db.presets().unwrap()[0].query.keyword.as_deref(), Some("old"));
    }

    #[test]
    fn product_history_matches_title_across_auctions() {
        let db = Db::open_in_memory().unwrap();
        let mut a = lot("A");
        a.title = "Laphroaig 10 Year Old".into();
        let mut b = lot("B");
        b.title = "laphroaig 10 year old ".into();
        let mut c = lot("C");
        c.title = "Glenlivet 12".into();
        db.upsert_lots(&[a], Some("september-2026-auction")).unwrap();
        db.upsert_lots(&[b, c], Some("october-2026-auction")).unwrap();
        let p = |ts, bid| LotPrice { entity_id: 1, auction_id: 9, current_bid_pence: bid, bids: 2, next_bid_pence: None, fetched_at: ts };
        db.record_price("A", &p(100, 2400), 3600).unwrap();
        db.record_price("A", &p(200, 3100), 3600).unwrap();
        db.record_price("B", &p(300, 2600), 3600).unwrap();
        db.record_price("C", &p(300, 9900), 3600).unwrap();
        let h = db.product_history("B").unwrap();
        assert_eq!(h.len(), 2);
        assert_eq!((h[0].auction_slug.as_str(), h[0].last_bid_pence), ("september-2026-auction", 3100));
        assert_eq!(h[1].sku, "B");
    }
}
