use crate::models::*;
use crate::parse;
use crate::query::FilterQuery;
use crate::{now_unix, Error, Result};
use std::sync::Mutex as StdMutex;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

pub const DEFAULT_BASE: &str = "https://whiskyauctioneer.com";

/// Serializes requests and keeps at least `gap` between their starts.
pub struct Limiter {
    gap: StdMutex<Duration>,
    last: Mutex<Option<Instant>>,
}

impl Limiter {
    pub fn new(gap: Duration) -> Self {
        Self { gap: StdMutex::new(gap), last: Mutex::new(None) }
    }
    pub fn set_gap(&self, gap: Duration) {
        *self.gap.lock().unwrap() = gap;
    }
    pub async fn wait(&self) {
        let mut last = self.last.lock().await;
        if let Some(t) = *last {
            let gap = *self.gap.lock().unwrap();
            let el = t.elapsed();
            if el < gap {
                tokio::time::sleep(gap - el).await;
            }
        }
        *last = Some(Instant::now());
    }
}

pub struct WaClient {
    http: StdMutex<reqwest::Client>,
    base: String,
    page_limiter: Limiter,
    api_limiter: Limiter,
    /// `Cookie` header of the user's site login (from the app's login webview). Sent only to `base`.
    session: StdMutex<Option<String>>,
}

fn build_http(user_agent: &str) -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(user_agent)
        .timeout(Duration::from_secs(30))
        .gzip(true)
        .build()
        .expect("reqwest client")
}

impl WaClient {
    pub fn new(base: &str, user_agent: &str, page_gap: Duration, api_gap: Duration) -> Self {
        Self {
            http: StdMutex::new(build_http(user_agent)),
            base: base.trim_end_matches('/').to_string(),
            page_limiter: Limiter::new(page_gap),
            api_limiter: Limiter::new(api_gap),
            session: StdMutex::new(None),
        }
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    pub fn configure(&self, user_agent: &str, page_gap: Duration, api_gap: Duration) {
        *self.http.lock().unwrap() = build_http(user_agent);
        self.page_limiter.set_gap(page_gap);
        self.api_limiter.set_gap(api_gap);
    }

    pub fn set_session(&self, cookie: Option<String>) {
        *self.session.lock().unwrap() = cookie.filter(|c| !c.is_empty());
    }

    pub fn has_session(&self) -> bool {
        self.session.lock().unwrap().is_some()
    }

    fn http(&self) -> reqwest::Client {
        self.http.lock().unwrap().clone()
    }

    async fn get(&self, path_or_url: &str, query: &[(String, String)], accept: &str) -> Result<String> {
        self.get_with(path_or_url, query, accept, None).await
    }

    async fn get_with(&self, path_or_url: &str, query: &[(String, String)], accept: &str, wa_id: Option<&str>) -> Result<String> {
        let url = if path_or_url.starts_with("http") { path_or_url.to_string() } else { format!("{}{}", self.base, path_or_url) };
        let mut req = self.http().get(&url).query(query).header(reqwest::header::ACCEPT, accept);
        // The login cookie never leaves the site (the exchange-rate API goes through here too).
        if url.starts_with(&format!("{}/", self.base)) {
            if let Some(c) = self.session.lock().unwrap().clone() {
                req = req.header(reqwest::header::COOKIE, c);
            }
            if let Some(id) = wa_id {
                req = req.header("X-Auctioneer-Wa-Id", id);
            }
        }
        let resp = req.send().await?;
        let status = resp.status();
        let final_url = resp.url().to_string();
        let body = resp.text().await?;
        if !status.is_success() {
            return Err(Error::Status { status: status.as_u16(), url: final_url });
        }
        Ok(body)
    }

    async fn get_page(&self, path: &str, query: &[(String, String)]) -> Result<String> {
        self.page_limiter.wait().await;
        self.get(path, query, "text/html,application/xhtml+xml").await
    }

    /// `GET /whisky-auctions/{slug}/lots?{filter}&page={page}`
    pub async fn fetch_listing(&self, slug: &str, q: &FilterQuery, page: u32) -> Result<ListingPage> {
        let mut pairs = q.to_pairs();
        if page > 0 {
            pairs.push(("page".into(), page.to_string()));
        }
        let html = self.get_page(&format!("/whisky-auctions/{slug}/lots"), &pairs).await?;
        Ok(parse::parse_listing(&html, &self.base))
    }

    /// `GET /whisky-auctions`
    pub async fn fetch_auction_index(&self) -> Result<(Vec<AuctionRef>, Option<AuctionStatus>)> {
        let html = self.get_page("/whisky-auctions", &[]).await?;
        Ok(parse::parse_auction_index(&html))
    }

    /// `GET /api/facets?view_name=lots_index&view_display_id=lots_page&view_args={auction_id}&{filter}`
    pub async fn fetch_facets(&self, auction_id: i64, q: &FilterQuery) -> Result<Facets> {
        let mut pairs = vec![
            ("view_name".to_string(), "lots_index".to_string()),
            ("view_display_id".to_string(), "lots_page".to_string()),
            ("view_args".to_string(), auction_id.to_string()),
        ];
        pairs.extend(q.to_pairs().into_iter().filter(|(k, _)| k != "items_per_page"));
        self.page_limiter.wait().await;
        let body = self.get("/api/facets", &pairs, "application/json").await?;
        parse::parse_facets(&body)
    }

    /// `GET /api/lot/{auction_id}/{entity_id}`
    pub async fn fetch_price(&self, auction_id: i64, entity_id: i64) -> Result<LotPrice> {
        self.api_limiter.wait().await;
        let body = self.get(&format!("/api/lot/{auction_id}/{entity_id}"), &[], "application/json").await?;
        parse::parse_lot_price(&body, auction_id, entity_id, now_unix())
    }

    /// Logged-in JSON API (`/api/user`, `/api/bookmarks/{uid}`, `/api/auction/open/{uid}`). GET only.
    pub async fn fetch_account_json(&self, path: &str, wa_id: Option<&str>) -> Result<serde_json::Value> {
        self.api_limiter.wait().await;
        let body = self.get_with(path, &[], "application/json", wa_id).await?;
        Ok(serde_json::from_str(&body)?)
    }

    /// Logged-in lot list page such as `/user/{uid}/buying/watchlist?page=N`, parsed like an auction listing.
    pub async fn fetch_user_listing(&self, path: &str, page: u32) -> Result<ListingPage> {
        let query = if page > 0 { vec![("page".to_string(), page.to_string())] } else { vec![] };
        let html = self.get_page(path, &query).await?;
        Ok(parse::parse_listing(&html, &self.base))
    }

    /// Raw GET without rate limiting (exchange-rate API etc.).
    pub async fn get_external_json(&self, url: &str) -> Result<serde_json::Value> {
        let body = self.get(url, &[], "application/json").await?;
        Ok(serde_json::from_str(&body)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn limiter_spaces_requests() {
        let l = Limiter::new(Duration::from_millis(120));
        let t = Instant::now();
        l.wait().await;
        l.wait().await;
        l.wait().await;
        assert!(t.elapsed() >= Duration::from_millis(240));
    }
}
