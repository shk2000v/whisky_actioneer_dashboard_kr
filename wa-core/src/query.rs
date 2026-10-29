//! Listing filter parameters.
//!
//! Format verified on the live site: `search_keyword=old`, `sort_bef_combine=computed_current_bid_ASC`,
//! `items_per_page=32` (16/32/64/92/184), `page=N` (0-based Drupal pager) and facet params as
//! `{facet}[{id}]={id}` (e.g. `size[6]=6`, `store[1]=1`). Facet keys confirmed to filter:
//! size, store, age, lots_abv, region, unique_attributes.

use crate::models::slug_from_path;
use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const SORT_OPTIONS: &[(&str, &str)] = &[
    ("relevance_DESC", "관련도순"),
    ("computed_current_bid_ASC", "현재가 낮은순"),
    ("computed_current_bid_DESC", "현재가 높은순"),
    ("name_ASC", "이름 A-Z"),
    ("name_DESC", "이름 Z-A"),
];

pub const PAGE_SIZES: &[u32] = &[16, 32, 64, 92, 184];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct FilterQuery {
    #[serde(default)]
    pub keyword: Option<String>,
    /// facet key -> selected option ids
    #[serde(default)]
    pub facets: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub sort: Option<String>,
    #[serde(default)]
    pub items_per_page: Option<u32>,
}

impl FilterQuery {
    pub fn per_page(&self) -> u32 {
        match self.items_per_page {
            Some(n) if PAGE_SIZES.contains(&n) => n,
            _ => 92,
        }
    }

    /// Query pairs without `page`.
    pub fn to_pairs(&self) -> Vec<(String, String)> {
        let mut out = Vec::new();
        out.push(("items_per_page".into(), self.per_page().to_string()));
        if let Some(k) = self.keyword.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
            out.push(("search_keyword".into(), k.to_string()));
        }
        for (facet, ids) in &self.facets {
            for id in ids {
                out.push((format!("{facet}[{id}]"), id.clone()));
            }
        }
        if let Some(s) = self.sort.as_deref().filter(|s| !s.is_empty()) {
            out.push(("sort_bef_combine".into(), s.to_string()));
        }
        out
    }

    /// Parse a URL copied from the Whisky Auctioneer lots page.
    /// Returns the auction slug and the filter.
    pub fn from_wa_url(input: &str) -> Result<(String, FilterQuery)> {
        let u = url::Url::parse(input.trim())?;
        let slug = slug_from_path(u.path())
            .ok_or_else(|| Error::other("Whisky Auctioneer 경매 목록 URL이 아닙니다 (/whisky-auctions/{경매}/lots 형식이어야 합니다)"))?;
        let mut q = FilterQuery::default();
        for (k, v) in u.query_pairs() {
            match k.as_ref() {
                "search_keyword" => q.keyword = Some(v.into_owned()).filter(|s| !s.is_empty()),
                "sort_bef_combine" => q.sort = Some(v.into_owned()),
                "items_per_page" => q.items_per_page = v.parse().ok(),
                "page" => {}
                key => {
                    if let Some((facet, rest)) = key.split_once('[') {
                        if let Some(id) = rest.strip_suffix(']') {
                            let ids = q.facets.entry(facet.to_string()).or_default();
                            let id = if id.is_empty() { v.into_owned() } else { id.to_string() };
                            if !ids.contains(&id) {
                                ids.push(id);
                            }
                        }
                    }
                }
            }
        }
        Ok((slug, q))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_user_url() {
        let url = "https://whiskyauctioneer.com/whisky-auctions/october-2026-auction/lots?items_per_page=32&page=2&search_keyword=old&size%5B6%5D=6&size%5B7%5D=7&size%5B8%5D=8&sort_bef_combine=computed_current_bid_ASC&store%5B1%5D=1";
        let (slug, q) = FilterQuery::from_wa_url(url).unwrap();
        assert_eq!(slug, "october-2026-auction");
        assert_eq!(q.keyword.as_deref(), Some("old"));
        assert_eq!(q.items_per_page, Some(32));
        assert_eq!(q.sort.as_deref(), Some("computed_current_bid_ASC"));
        assert_eq!(q.facets["size"], vec!["6", "7", "8"]);
        assert_eq!(q.facets["store"], vec!["1"]);
        let pairs = q.to_pairs();
        assert!(pairs.contains(&("size[7]".into(), "7".into())));
        assert!(pairs.contains(&("search_keyword".into(), "old".into())));
        assert!(!pairs.iter().any(|(k, _)| k == "page"));
    }

    #[test]
    fn rejects_other_urls() {
        assert!(FilterQuery::from_wa_url("https://whiskyauctioneer.com/whisky-lot/1/x").is_err());
    }
}
