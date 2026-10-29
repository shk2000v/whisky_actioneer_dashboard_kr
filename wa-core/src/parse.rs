//! HTML/JSON parsers for whiskyauctioneer.com.
//!
//! Selectors were taken from the live October 2026 auction listing (2026-10-28):
//! `.lot-teaser` > `.sku`, `.teaser-title a`, `.field--name-field-subtitle-s1 .field__item`,
//! `.attributes-stats__item--{bottled,size,abv}`, `.location-badge`,
//! `.field--name-field-unique-attributes .title`, and `.bid-app-main[data-*]`.
//! Page-level state comes from the Drupal settings JSON (`drupalSettings`).

use crate::models::*;
use crate::{Error, Result};
use scraper::{ElementRef, Html, Selector};
use serde_json::Value;
use std::collections::BTreeMap;

fn sel(s: &str) -> Selector {
    Selector::parse(s).expect("static selector")
}

fn text_of(el: ElementRef) -> String {
    el.text().collect::<Vec<_>>().join(" ").split_whitespace().collect::<Vec<_>>().join(" ")
}

fn first_text(root: ElementRef, s: &Selector) -> Option<String> {
    root.select(s).next().map(text_of).filter(|t| !t.is_empty())
}

fn absolutize(base: &str, href: &str) -> String {
    if href.starts_with("http://") || href.starts_with("https://") {
        href.to_string()
    } else {
        format!("{}/{}", base.trim_end_matches('/'), href.trim_start_matches('/'))
    }
}

/// Extract the Drupal settings object. Drupal 9+ emits it as
/// `<script type="application/json" data-drupal-selector="drupal-settings-json">`.
pub fn drupal_settings(doc: &Html) -> Option<Value> {
    let s = sel(r#"script[data-drupal-selector="drupal-settings-json"]"#);
    let raw = doc.select(&s).next()?.text().collect::<String>();
    serde_json::from_str(&raw).ok()
}

pub fn auction_status_from_settings(settings: &Value) -> Option<AuctionStatus> {
    let a = settings.get("auction")?;
    let mut active = BTreeMap::new();
    if let Some(map) = a.get("activeAuctions").and_then(Value::as_object) {
        for (k, v) in map {
            if let (Ok(id), Some(end)) = (k.parse::<i64>(), v.as_i64()) {
                active.insert(id, end);
            }
        }
    }
    Some(AuctionStatus {
        active_auctions: active,
        active_path: a.get("activeAuction").and_then(Value::as_str).map(str::to_string),
        is_running: a.get("isRunning").and_then(Value::as_bool).unwrap_or(false),
        refresh_app: a.get("refreshApp").and_then(Value::as_i64),
    })
}

fn listing_meta(settings: &Value) -> (Option<i64>, Option<i64>) {
    let facets = settings.get("waFacetsView");
    let total = facets.and_then(|f| f.get("total_rows")).and_then(Value::as_i64);
    let mut auction_id = facets
        .and_then(|f| f.get("view_args"))
        .and_then(Value::as_str)
        .and_then(|s| s.parse().ok());
    if auction_id.is_none() {
        if let Some(views) = settings.pointer("/views/ajaxViews").and_then(Value::as_object) {
            auction_id = views
                .values()
                .find(|v| v.get("view_name").and_then(Value::as_str) == Some("lots_index"))
                .and_then(|v| v.get("view_args"))
                .and_then(Value::as_str)
                .and_then(|s| s.parse().ok());
        }
    }
    (total, auction_id)
}

fn data_i64(el: ElementRef, name: &str) -> Option<i64> {
    el.value().attr(name).and_then(|v| v.trim().parse().ok())
}

pub fn parse_listing(html: &str, base: &str) -> ListingPage {
    let doc = Html::parse_document(html);
    let teaser = sel(".lot-teaser");
    let sku_s = sel(".sku");
    let title_s = sel(".teaser-title a");
    let subtitle_s = sel(".field--name-field-subtitle-s1 .field__item");
    let bottled_s = sel(".attributes-stats__item--bottled");
    let size_s = sel(".attributes-stats__item--size");
    let abv_s = sel(".attributes-stats__item--abv");
    let loc_s = sel(".location-badge");
    let attr_s = sel(".field--name-field-unique-attributes .title");
    let app_s = sel(".bid-app-main");
    let img_s = sel(".teaser-image img");

    let mut lots = Vec::new();
    for t in doc.select(&teaser) {
        let Some(title_a) = t.select(&title_s).next() else { continue };
        let href = title_a.value().attr("href").unwrap_or_default();
        let sku = first_text(t, &sku_s)
            .map(|s| s.trim_start_matches('#').trim().to_string())
            .or_else(|| href.split('/').nth(2).map(str::to_string))
            .unwrap_or_default();
        if sku.is_empty() {
            continue;
        }
        let app = t.select(&app_s).next();
        let image = app
            .and_then(|a| a.value().attr("data-image"))
            .or_else(|| t.select(&img_s).next().and_then(|i| i.value().attr("src")))
            .map(|s| absolutize(base, s));
        let mut attributes: Vec<String> = t.select(&attr_s).map(text_of).filter(|s| !s.is_empty()).collect();
        attributes.dedup();
        lots.push(Lot {
            sku: sku.to_uppercase(),
            entity_id: app.and_then(|a| data_i64(a, "data-entity-id")),
            auction_id: app.and_then(|a| data_i64(a, "data-auction-id")),
            title: text_of(title_a),
            subtitle: first_text(t, &subtitle_s),
            url: absolutize(base, href),
            image,
            bottled: first_text(t, &bottled_s),
            size: first_text(t, &size_s),
            abv: first_text(t, &abv_s),
            location: first_text(t, &loc_s),
            reserve_pence: app.and_then(|a| data_i64(a, "data-reserve")),
            attributes,
        });
    }

    let settings = drupal_settings(&doc);
    let (total_rows, mut auction_id) = settings.as_ref().map(listing_meta).unwrap_or((None, None));
    if auction_id.is_none() {
        auction_id = lots.iter().find_map(|l| l.auction_id);
    }
    ListingPage {
        lots,
        total_rows,
        auction_id,
        status: settings.as_ref().and_then(auction_status_from_settings),
    }
}

/// Parse `/whisky-auctions`: every link to `/whisky-auctions/{slug}[/lots]`.
pub fn parse_auction_index(html: &str) -> (Vec<AuctionRef>, Option<AuctionStatus>) {
    let doc = Html::parse_document(html);
    let a_s = sel(r#"a[href^="/whisky-auctions/"]"#);
    let mut out: Vec<AuctionRef> = Vec::new();
    for a in doc.select(&a_s) {
        let href = a.value().attr("href").unwrap_or_default();
        let path = href.split(['?', '#']).next().unwrap_or_default().trim_end_matches('/');
        let Some(slug) = slug_from_path(path) else { continue };
        let has_lots = path.ends_with("/lots");
        let text = text_of(a);
        if let Some(existing) = out.iter_mut().find(|r| r.slug == slug) {
            if has_lots && !existing.has_lots {
                existing.has_lots = true;
                existing.path = path.to_string();
            }
            continue;
        }
        let title = if text.is_empty() || text.len() > 80 { prettify_slug(&slug) } else { text };
        out.push(AuctionRef { slug, title, path: path.to_string(), has_lots });
    }
    let status = drupal_settings(&doc).as_ref().and_then(auction_status_from_settings);
    (out, status)
}

/// `october-2026-auction` -> `October 2026 Auction`
pub fn prettify_slug(slug: &str) -> String {
    slug.split('-')
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Parse `/api/lot/{auction_id}/{entity_id}`:
/// `{"data":{"currentBid":{"amount":0},"numberOfBidsPlaced":0,"productVariationId":"5320418",
///   "auctionId":"5000108","nextProxyBidAmount":2000,"changed":0}}`
pub fn parse_lot_price(json: &str, auction_id: i64, entity_id: i64, now: i64) -> Result<LotPrice> {
    let v: Value = serde_json::from_str(json)?;
    let d = v.get("data").ok_or_else(|| Error::other(format!("가격 응답에 data가 없습니다: {}", truncate(json, 200))))?;
    let num = |p: &str| d.pointer(p).and_then(|x| x.as_i64().or_else(|| x.as_str().and_then(|s| s.parse().ok())));
    Ok(LotPrice {
        entity_id,
        auction_id,
        current_bid_pence: num("/currentBid/amount").unwrap_or(0),
        bids: num("/numberOfBidsPlaced").unwrap_or(0),
        next_bid_pence: num("/nextProxyBidAmount"),
        fetched_at: now,
    })
}

/// Parse `/api/facets` response: `{"facets":{"size":{"field":..,"label":..,"options":[{id,label,count,active}]}},"total":N}`
pub fn parse_facets(json: &str) -> Result<Facets> {
    let v: Value = serde_json::from_str(json)?;
    let total = v.get("total").and_then(Value::as_i64).unwrap_or(0);
    let mut facets = Vec::new();
    if let Some(map) = v.get("facets").and_then(Value::as_object) {
        for (key, f) in map {
            let options = f
                .get("options")
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(|o| {
                            let id = match o.get("id")? {
                                Value::String(s) => s.clone(),
                                other => other.to_string(),
                            };
                            Some(FacetOption {
                                id,
                                label: o.get("label").and_then(Value::as_str).unwrap_or_default().trim().to_string(),
                                count: o.get("count").and_then(Value::as_i64).unwrap_or(0),
                                active: o.get("active").and_then(Value::as_bool).unwrap_or(false),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            facets.push(Facet {
                key: key.clone(),
                field: f.get("field").and_then(Value::as_str).unwrap_or_default().to_string(),
                label: f.get("label").and_then(Value::as_str).unwrap_or(key).to_string(),
                options,
            });
        }
    }
    Ok(Facets { facets, total })
}

pub fn truncate(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const LISTING: &str = include_str!("../tests/fixtures/listing.html");
    const INDEX: &str = include_str!("../tests/fixtures/auctions.html");
    const BASE: &str = "https://whiskyauctioneer.com";

    #[test]
    fn listing_running() {
        let p = parse_listing(LISTING, BASE);
        assert_eq!(p.lots.len(), 2);
        assert_eq!(p.total_rows, Some(2149));
        assert_eq!(p.auction_id, Some(5000108));
        let l = &p.lots[0];
        assert_eq!(l.sku, "5290558");
        assert_eq!(l.entity_id, Some(5320418));
        assert_eq!(l.auction_id, Some(5000108));
        assert_eq!(l.title, "Laphroaig 10 Year Old");
        assert_eq!(l.subtitle.as_deref(), Some("Distillery Bottling"));
        assert_eq!(l.url, "https://whiskyauctioneer.com/whisky-lot/5290558/laphroaig-10-year-old");
        assert_eq!(l.size.as_deref(), Some("70cl"));
        assert_eq!(l.abv.as_deref(), Some("40%"));
        assert_eq!(l.bottled.as_deref(), Some("2000-2013"));
        assert_eq!(l.location.as_deref(), Some("UK"));
        assert_eq!(l.reserve_pence, Some(0));
        assert_eq!(l.attributes, vec!["Discontinued".to_string()]);
        assert_eq!(p.lots[1].reserve_pence, Some(2065000));
        assert_eq!(p.lots[1].sku, "8214267A");
        let st = p.status.unwrap();
        assert!(st.is_running);
        assert_eq!(st.active_auctions.get(&5000108), Some(&1793661919));
        assert_eq!(st.active_slug().as_deref(), Some("october-2026-auction"));
        assert_eq!(st.refresh_app, Some(240));
    }

    #[test]
    fn listing_past_without_bid_app() {
        let html = r#"<div class="views-row"><div class="lot-teaser"><div class="sku mb-1">#5274221C</div>
            <h3 class="teaser-title"><a href="/whisky-lot/5274221c/hanyu-x-4">Hanyu Ichiro's Malt x 4</a></h3>
            <div class="attributes-stats__item attributes-stats__item--size">4 x 70cl</div></div></div>"#;
        let p = parse_listing(html, BASE);
        assert_eq!(p.lots.len(), 1);
        assert_eq!(p.lots[0].sku, "5274221C");
        assert_eq!(p.lots[0].entity_id, None);
        assert_eq!(p.lots[0].size.as_deref(), Some("4 x 70cl"));
    }

    #[test]
    fn auction_index() {
        let (list, status) = parse_auction_index(INDEX);
        let slugs: Vec<_> = list.iter().map(|a| a.slug.as_str()).collect();
        assert_eq!(slugs, vec!["october-2026-auction", "november-2026-auction", "september-2026-auction", "kisetsu-seasons-japanese-whisky"]);
        assert!(list[0].has_lots);
        assert!(!list[1].has_lots);
        assert_eq!(list[1].title, "November 2026 Auction");
        assert!(status.unwrap().is_running);
    }

    #[test]
    fn lot_price() {
        let j = r#"{"data":{"currentBid":{"amount":2600},"numberOfBidsPlaced":5,"productVariationId":"5320418","auctionId":"5000108","nextProxyBidAmount":2800,"changed":0}}"#;
        let p = parse_lot_price(j, 5000108, 5320418, 1).unwrap();
        assert_eq!(p.current_bid_pence, 2600);
        assert_eq!(p.bids, 5);
        assert_eq!(p.next_bid_pence, Some(2800));
        assert!(parse_lot_price(r#"{"message":"x"}"#, 1, 1, 1).is_err());
    }

    #[test]
    fn facets() {
        let j = r#"{"facets":{"size":{"field":"whisky_rum_size","label":"Size","options":[{"active":false,"count":4877,"id":"6","label":"70cl"}]},
            "age":{"field":"age","label":"Age","options":[{"active":false,"count":2088,"id":10,"label":"10-19 Years Old"}]}},"total":6816}"#;
        let f = parse_facets(j).unwrap();
        assert_eq!(f.total, 6816);
        let age = f.facets.iter().find(|x| x.key == "age").unwrap();
        assert_eq!(age.options[0].id, "10");
        let size = f.facets.iter().find(|x| x.key == "size").unwrap();
        assert_eq!(size.options[0].label, "70cl");
    }
}
