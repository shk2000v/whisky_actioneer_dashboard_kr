//! End-to-end flow against a local mock of the site's endpoints.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use wa_core::db::Db;
use wa_core::query::FilterQuery;
use wa_core::Service;

const LISTING: &str = include_str!("fixtures/listing.html");
const INDEX: &str = include_str!("fixtures/auctions.html");

type Hits = Arc<Mutex<HashMap<String, usize>>>;

async fn mock_server(bid: Arc<Mutex<i64>>) -> (String, Hits) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let hits: Hits = Arc::default();
    let hits2 = hits.clone();
    tokio::spawn(async move {
        loop {
            let (mut sock, _) = listener.accept().await.unwrap();
            let hits = hits2.clone();
            let bid = bid.clone();
            tokio::spawn(async move {
                let mut buf = vec![0u8; 8192];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let path = req.split_whitespace().nth(1).unwrap_or("/").to_string();
                let route = path.split('?').next().unwrap().to_string();
                *hits.lock().unwrap().entry(route.clone()).or_default() += 1;
                let (ctype, body) = if route == "/whisky-auctions" {
                    ("text/html", INDEX.to_string())
                } else if route.ends_with("/lots") {
                    ("text/html", LISTING.to_string())
                } else if route.starts_with("/api/lot/") {
                    let parts: Vec<&str> = route.split('/').collect();
                    let amount = if parts[4] == "5320418" { *bid.lock().unwrap() } else { 1_200_000 };
                    ("application/json", format!(r#"{{"data":{{"currentBid":{{"amount":{amount}}},"numberOfBidsPlaced":3,"productVariationId":"{}","auctionId":"{}","nextProxyBidAmount":{},"changed":0}}}}"#, parts[4], parts[3], amount + 200))
                } else if route == "/api/facets" {
                    ("application/json", r#"{"facets":{"size":{"field":"whisky_rum_size","label":"Size","options":[{"active":false,"count":4877,"id":"6","label":"70cl"}]}},"total":6816}"#.to_string())
                } else {
                    ("text/plain", "not found".to_string())
                };
                let status = if ctype == "text/plain" { "404 Not Found" } else { "200 OK" };
                let resp = format!("HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                let _ = sock.write_all(resp.as_bytes()).await;
            });
        }
    });
    (format!("http://{addr}"), hits)
}

#[tokio::test]
async fn search_preset_watch_poll() {
    let bid = Arc::new(Mutex::new(2000));
    let (base, hits) = mock_server(bid.clone()).await;
    let svc = Service::with_db(Db::open_in_memory().unwrap(), &base).unwrap();
    svc.set_gaps_unchecked(Duration::from_millis(1), Duration::from_millis(1));

    // auctions + active auction (fixture end time is in the past -> treat as not running for polling)
    let ov = svc.refresh_auctions().await.unwrap();
    assert_eq!(ov.auctions.len(), 4);
    let active = ov.active.unwrap();
    assert_eq!(active.slug, "october-2026-auction");
    assert_eq!(active.auction_id, 5000108);

    // search on an explicit slug
    let q = FilterQuery { keyword: Some("old".into()), items_per_page: Some(32), ..Default::default() };
    let r = svc.search(Some("october-2026-auction"), &q, 0, Some(false)).await.unwrap();
    assert_eq!(r.lots.len(), 2);
    assert_eq!(r.total_rows, Some(2149));

    // facets use the auction id learned from the listing
    let f = svc.facets(Some("october-2026-auction"), &q).await.unwrap();
    assert_eq!(f.total, 6816);

    // preset: run once (walks pages until fewer than per_page), then served from cache
    let p = svc.preset_from_url("old", "https://whiskyauctioneer.com/whisky-auctions/october-2026-auction/lots?search_keyword=old&items_per_page=32", false).unwrap();
    let run = svc.run_preset(p.id, None, false).await.unwrap();
    assert_eq!(run.lots.len(), 2);
    assert!(run.run.as_ref().unwrap().complete);
    let before = hits.lock().unwrap().get("/whisky-auctions/october-2026-auction/lots").copied().unwrap();
    let cached = svc.preset_cached(p.id, None).await.unwrap();
    assert_eq!(cached.lots.len(), 2);
    let after = hits.lock().unwrap().get("/whisky-auctions/october-2026-auction/lots").copied().unwrap();
    assert_eq!(before, after, "cached preset must not hit the network");

    // watchlist + explicit price refresh + history
    svc.watch_add("5290558").unwrap();
    svc.watch_update("5290558", true, Some(30.0), None).unwrap();
    let v = svc.refresh_prices_for(&["5290558".into()]).await.unwrap();
    assert_eq!(v[0].price.as_ref().unwrap().current_bid_pence, 2000);
    *bid.lock().unwrap() = 2600;
    let v = svc.refresh_prices_for(&["5290558".into()]).await.unwrap();
    assert_eq!(v[0].price.as_ref().unwrap().current_bid_pence, 2600);
    assert_eq!(svc.history("5290558").unwrap().len(), 2);

    // basket for participating lots
    svc.set_fx_manual(1769.18, 1.3347).unwrap();
    let b = svc.basket().await.unwrap();
    assert_eq!(b.items.len(), 1);
    assert_eq!(b.items[0].hammer_gbp, 26.0);
    assert!(b.at_current.exempt);
    assert_eq!(b.at_my_max.hammer_gbp, 30.0);
}

/// Site account sync: cookie + X-Auctioneer-Wa-Id reach the site, bids and bookmarks land in the watchlist.
#[tokio::test]
async fn account_sync_imports_bids_and_bookmarks() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let reqs: Arc<Mutex<Vec<String>>> = Arc::default();
    let reqs2 = reqs.clone();
    tokio::spawn(async move {
        loop {
            let (mut sock, _) = listener.accept().await.unwrap();
            let reqs = reqs2.clone();
            tokio::spawn(async move {
                let mut buf = vec![0u8; 8192];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_lowercase();
                reqs.lock().unwrap().push(req.clone());
                let route = req.split_whitespace().nth(1).unwrap_or("/").split('?').next().unwrap().to_string();
                let logged_in = req.contains("cookie: sess1=abc");
                let has_id = req.contains("x-auctioneer-wa-id: uu-7");
                let body = match route.as_str() {
                    "/api/user" if logged_in => r#"{"uid":"7","uuid":"uu-7","profile":{"first_name":"Kim","last_name":""},"buying":{"lots":1,"total":"£45.00"}}"#.to_string(),
                    "/api/user" => r#"{"uid":"0","uuid":"0"}"#.to_string(),
                    "/api/auction/open/7" if logged_in && has_id => r#"{"data":{"5000108":{"5320418":{"userBid":{"amount":"4500"},"proxyBid":{"maxAmount":"6000"},"isWinning":true,"metReserve":true}}}}"#.to_string(),
                    "/api/bookmarks/7" if logged_in && has_id => r#"{"commerce_product_variation":{"items":{"5322396":{"status":"1","auction":"5000108"},"999":{"status":"1","auction":"5000108"}}}}"#.to_string(),
                    "/user/7/buying" | "/user/7/buying/outbid" | "/user/7/buying/watchlist" if logged_in => LISTING.to_string(),
                    _ => String::new(),
                };
                let status = if body.is_empty() { "403 Forbidden" } else { "200 OK" };
                let resp = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                let _ = sock.write_all(resp.as_bytes()).await;
            });
        }
    });

    let svc = Service::with_db(Db::open_in_memory().unwrap(), &base).unwrap();
    svc.set_gaps_unchecked(Duration::from_millis(1), Duration::from_millis(1));
    assert!(svc.sync_account().await.is_err(), "no session yet");

    svc.set_session(Some("SESS1=abc".into()));
    let s = svc.sync_account().await.unwrap();
    assert_eq!((s.account.uid, s.account.name.as_str()), (7, "Kim"));
    assert_eq!((s.bids.len(), s.bookmarks, s.imported), (1, 2, 2));
    assert_eq!(s.missing, vec![999]);

    let w = svc.watchlist().unwrap();
    let bid = w.iter().find(|l| l.lot.entity_id == Some(5320418)).unwrap();
    assert!(bid.participating);
    assert_eq!(bid.my_max_gbp, Some(60.0));
    let mark = w.iter().find(|l| l.lot.entity_id == Some(5322396)).unwrap();
    assert!(!mark.participating);
    assert!(reqs.lock().unwrap().iter().all(|r| !r.starts_with("post") && !r.starts_with("patch")), "GET only");

    // Expired site session: logged out in the app, no account kept.
    svc.set_session(Some("other=1".into()));
    assert!(svc.sync_account().await.is_err());
    assert!(svc.account().is_none());
}
