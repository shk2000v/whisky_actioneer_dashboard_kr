use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// One auction lot as shown on a listing page.
///
/// `sku` is the lot number shown as `#5290558` and is the primary key.
/// `entity_id` / `auction_id` come from `.bid-app-main` data attributes and are
/// only present for lots in a running auction (past-auction cards have no bid app).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Lot {
    pub sku: String,
    pub entity_id: Option<i64>,
    pub auction_id: Option<i64>,
    pub title: String,
    pub subtitle: Option<String>,
    pub url: String,
    pub image: Option<String>,
    pub bottled: Option<String>,
    pub size: Option<String>,
    pub abv: Option<String>,
    pub location: Option<String>,
    /// `data-reserve` attribute, pence. 0 = no reserve.
    pub reserve_pence: Option<i64>,
    pub attributes: Vec<String>,
}

/// Response of `/api/lot/{auction_id}/{entity_id}`. Amounts are pence.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LotPrice {
    pub entity_id: i64,
    pub auction_id: i64,
    pub current_bid_pence: i64,
    pub bids: i64,
    pub next_bid_pence: Option<i64>,
    pub fetched_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuctionRef {
    pub slug: String,
    pub title: String,
    pub path: String,
    /// true when the link points at `/lots` (running or finished), false for upcoming.
    pub has_lots: bool,
}

/// `drupalSettings.auction` block present on every page.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AuctionStatus {
    /// auction_id -> end time (unix seconds)
    pub active_auctions: BTreeMap<i64, i64>,
    pub active_path: Option<String>,
    pub is_running: bool,
    pub refresh_app: Option<i64>,
}

impl AuctionStatus {
    pub fn active_slug(&self) -> Option<String> {
        self.active_path.as_deref().and_then(slug_from_path)
    }
}

/// `/whisky-auctions/{slug}/lots` -> `{slug}`
pub fn slug_from_path(path: &str) -> Option<String> {
    let path = path.split(['?', '#']).next().unwrap_or(path);
    let mut it = path.trim_matches('/').split('/');
    if it.next()? != "whisky-auctions" {
        return None;
    }
    it.next().filter(|s| !s.is_empty()).map(str::to_string)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListingPage {
    pub lots: Vec<Lot>,
    pub total_rows: Option<i64>,
    pub auction_id: Option<i64>,
    pub status: Option<AuctionStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FacetOption {
    pub id: String,
    pub label: String,
    pub count: i64,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Facet {
    /// Query parameter name, e.g. `size` -> `size[6]=6`.
    pub key: String,
    pub field: String,
    pub label: String,
    pub options: Vec<FacetOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Facets {
    pub facets: Vec<Facet>,
    pub total: i64,
}

/// Lot joined with cached state for the UI.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LotView {
    #[serde(flatten)]
    pub lot: Lot,
    pub auction_slug: Option<String>,
    pub price: Option<LotPrice>,
    pub watched: bool,
    pub participating: bool,
    pub my_max_gbp: Option<f64>,
    pub note: Option<String>,
    /// 1 bottle <= 1L etc. parsed from `size` for the tax calculator.
    pub bottles: Option<u32>,
    pub volume_ml: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PricePoint {
    pub ts: i64,
    pub current_bid_pence: i64,
    pub bids: i64,
}

/// Last recorded bid of the same product (matched by title) in one auction.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProductAuctionPoint {
    pub sku: String,
    pub auction_slug: String,
    pub auction_title: Option<String>,
    pub last_bid_pence: i64,
    pub bids: i64,
    pub recorded_at: i64,
    pub size: Option<String>,
}

/// Parse a size string such as `70cl`, `4 x 70cl`, `1L`, `1.75L`, `500ml`
/// into (bottle count, millilitres per bottle).
pub fn parse_size(size: &str) -> Option<(u32, u32)> {
    let s: String = size.to_lowercase().chars().filter(|c| !c.is_whitespace()).collect();
    let (count, unit_part) = match s.split_once('x') {
        Some((n, rest)) if n.chars().all(|c| c.is_ascii_digit()) && !n.is_empty() => {
            (n.parse::<u32>().ok()?, rest.to_string())
        }
        _ => (1, s.clone()),
    };
    let (num, mult) = if let Some(v) = unit_part.strip_suffix("ml") {
        (v, 1.0)
    } else if let Some(v) = unit_part.strip_suffix("cl") {
        (v, 10.0)
    } else if let Some(v) = unit_part.strip_suffix("litre").or_else(|| unit_part.strip_suffix("liter")) {
        (v, 1000.0)
    } else if let Some(v) = unit_part.strip_suffix("ltr") {
        (v, 1000.0)
    } else {
        (unit_part.strip_suffix('l')?, 1000.0)
    };
    let n: f64 = num.parse().ok()?;
    if count == 0 || n <= 0.0 {
        return None;
    }
    Some((count, (n * mult).round() as u32))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes() {
        assert_eq!(parse_size("70cl"), Some((1, 700)));
        assert_eq!(parse_size("4 x 70cl"), Some((4, 700)));
        assert_eq!(parse_size("1L"), Some((1, 1000)));
        assert_eq!(parse_size("1.75L"), Some((1, 1750)));
        assert_eq!(parse_size("500ml"), Some((1, 500)));
        assert_eq!(parse_size("100cl"), Some((1, 1000)));
        assert_eq!(parse_size("1 litre"), Some((1, 1000)));
        assert_eq!(parse_size("1 Litre"), Some((1, 1000)));
        assert_eq!(parse_size("n/a"), None);
    }

    #[test]
    fn slugs() {
        assert_eq!(
            slug_from_path("/whisky-auctions/october-2026-auction/lots").as_deref(),
            Some("october-2026-auction")
        );
        assert_eq!(slug_from_path("/whisky-auctions/march-2027-auction").as_deref(), Some("march-2027-auction"));
        assert_eq!(slug_from_path("/whisky-lot/1/x"), None);
    }
}
