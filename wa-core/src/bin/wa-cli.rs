//! Headless checks for the tracker core (run on the Mac to confirm the site answers a plain HTTP client).
//!
//!   cargo run -p wa-core --bin wa-cli -- auctions
//!   cargo run -p wa-core --bin wa-cli -- search "https://whiskyauctioneer.com/whisky-auctions/october-2026-auction/lots?search_keyword=old"
//!   cargo run -p wa-core --bin wa-cli -- price 5000108 5320418
//!   cargo run -p wa-core --bin wa-cli -- fx
//!   cargo run -p wa-core --bin wa-cli -- calc 20 20

use std::path::PathBuf;
use wa_core::query::FilterQuery;
use wa_core::tax::CalcItem;
use wa_core::{Result, Service};

fn gbp(p: i64) -> String {
    format!("£{:.2}", p as f64 / 100.0)
}

#[tokio::main]
async fn main() {
    if let Err(e) = run().await {
        eprintln!("오류: {e}");
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let db = std::env::var("WA_DB").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("wa-tracker-cli.db"));
    let svc = Service::open(&db)?;
    match args.first().map(String::as_str) {
        Some("auctions") => {
            let ov = svc.refresh_auctions().await?;
            if let Some(a) = &ov.active {
                println!("진행 중: {} (id {}, 종료 unix {}, running {})", a.title, a.auction_id, a.end_unix, a.is_running);
            }
            for a in ov.auctions.iter().take(20) {
                println!("{:<45} lots={} id={:?}", a.slug, a.has_lots, a.auction_id);
            }
        }
        Some("search") => {
            let input = args.get(1).cloned().unwrap_or_default();
            let (slug, q) = if input.starts_with("http") {
                let (s, q) = FilterQuery::from_wa_url(&input)?;
                (Some(s), q)
            } else {
                (None, FilterQuery { keyword: Some(input), items_per_page: Some(32), ..Default::default() })
            };
            let r = svc.search(slug.as_deref(), &q, 0, Some(true)).await?;
            println!("{} — 전체 {:?}건, 이 페이지 {}건, active={}", r.slug, r.total_rows, r.lots.len(), r.is_active);
            for v in r.lots.iter().take(15) {
                let price = v.price.as_ref().map(|p| format!("{} ({}입찰)", gbp(p.current_bid_pence), p.bids)).unwrap_or_else(|| "-".into());
                let reserve = v.lot.reserve_pence.filter(|r| *r > 0).map(gbp).unwrap_or_else(|| "없음".into());
                println!("#{:<9} {:<50} {:<8} reserve {:<10} {}", v.lot.sku, v.lot.title, v.lot.size.clone().unwrap_or_default(), reserve, price);
            }
        }
        Some("price") => {
            let a: i64 = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
            let e: i64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
            let client = wa_core::client::WaClient::new(
                wa_core::client::DEFAULT_BASE,
                &svc.settings().user_agent,
                std::time::Duration::from_secs(10),
                std::time::Duration::from_millis(500),
            );
            let p = client.fetch_price(a, e).await?;
            println!("현재가 {}  입찰 {}회  다음 최소 {}", gbp(p.current_bid_pence), p.bids, p.next_bid_pence.map(gbp).unwrap_or_default());
        }
        Some("fx") => {
            let f = svc.fx(true).await?;
            println!("GBP→KRW {:.2}  GBP→USD {:.4}  ({}, {})", f.gbp_krw, f.gbp_usd, f.source, f.source_updated);
        }
        Some("calc") => {
            let items: Vec<CalcItem> = args[1..]
                .iter()
                .filter_map(|s| s.parse::<f64>().ok())
                .map(|h| CalcItem { label: None, hammer_gbp: h, bottles: 1, volume_ml: 700 })
                .collect();
            let (r, fx) = svc.calculate(&items, None).await?;
            println!("환율 {:.2} / {:.4}", fx.gbp_krw, fx.gbp_usd);
            println!("{}병, 면세: {} ({})", r.total_bottles, r.exempt, r.exempt_reason);
            println!("과세가격 {:.0}원, 세금 {:.0}원, 총액 {:.0}원", r.cif_krw, r.tax_krw, r.total_krw);
        }
        _ => {
            println!("사용법: wa-cli <auctions | search <URL|키워드> | price <auction_id> <entity_id> | fx | calc <낙찰가£...>>");
        }
    }
    Ok(())
}
