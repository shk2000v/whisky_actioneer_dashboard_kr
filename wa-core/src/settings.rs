use crate::poll::PollMode;
use crate::tax::TaxSettings;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub poll: PollMode,
    /// Minimum gap between HTML page/facet requests. robots.txt: `Crawl-delay: 10`.
    pub page_gap_secs: f64,
    /// Minimum gap between `/api/lot` requests. The site's own page fires one per visible
    /// lot at once (observed 32 on a 32-item page), so a short gap is still gentler than a browser.
    pub api_gap_secs: f64,
    pub user_agent: String,
    /// Upper bound of listing pages fetched per preset run.
    pub max_pages_per_run: u32,
    /// Fetch prices for listing results right after a search (running auction only).
    pub prices_on_search: bool,
    pub tax: TaxSettings,
}

pub const MIN_PAGE_GAP_SECS: f64 = 10.0;
pub const MIN_API_GAP_SECS: f64 = 0.2;

impl Default for Settings {
    fn default() -> Self {
        Self {
            poll: PollMode::default(),
            page_gap_secs: 10.0,
            api_gap_secs: 0.5,
            user_agent: format!("WhiskyTracker/{} (personal watchlist; +local desktop app)", env!("CARGO_PKG_VERSION")),
            max_pages_per_run: 40,
            prices_on_search: true,
            tax: TaxSettings::default(),
        }
    }
}

impl Settings {
    /// Clamp values to safe ranges.
    pub fn sanitized(mut self) -> Self {
        self.page_gap_secs = self.page_gap_secs.max(MIN_PAGE_GAP_SECS);
        self.api_gap_secs = self.api_gap_secs.max(MIN_API_GAP_SECS);
        self.max_pages_per_run = self.max_pages_per_run.clamp(1, 200);
        if self.user_agent.trim().is_empty() {
            self.user_agent = Settings::default().user_agent;
        }
        self
    }
}
