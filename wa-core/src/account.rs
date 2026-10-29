//! The user's own site account, read with the session cookie of the app's login window. GET only.
//!
//! Response shapes follow the site's own bid app (`/sites/default/files/js/js_6NtCf…js`, read 2026-10-29):
//! - `GET /api/user` → `{uid, uuid, profile:{first_name,last_name}, buying:{lots,total}, …}`; `uid` "0" when logged out
//! - `GET /api/auction/open/{uid}` (header `X-Auctioneer-Wa-Id: uuid`)
//!   → `{data:{<auction_id>:{<lot_id>:{userBid:{amount}, proxyBid:{maxAmount,nextAmount}, isWinning, metReserve}}}}`
//! - `GET /api/bookmarks/{uid}` (same header)
//!   → `{commerce_product_variation:{items:{<lot_id>:{status, auction}}}}`, or `{empty:…}`; status 1 = watched
//!
//! `lot_id` is the lot's entity id (`data-entity-id` on the listing, same id `/api/lot/{auction}/{id}` takes).
//! Amounts are pence; the site's JS runs them through `parseInt`, so they may arrive as strings.

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub uid: i64,
    pub uuid: String,
    pub name: String,
    pub buying_lots: i64,
    pub buying_total: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MyBid {
    pub auction_id: i64,
    pub entity_id: i64,
    pub bid_pence: Option<i64>,
    pub max_pence: Option<i64>,
    pub winning: bool,
    pub met_reserve: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub entity_id: i64,
    pub auction_id: Option<i64>,
}

fn int(v: &Value) -> Option<i64> {
    match v {
        Value::Number(n) => n.as_i64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// `None` when the session is not logged in.
pub fn parse_user(v: &Value) -> Option<Account> {
    let uid = int(&v["uid"]).filter(|u| *u > 0)?;
    let p = &v["profile"];
    let name = [p["first_name"].as_str(), p["last_name"].as_str()].into_iter().flatten().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" ");
    Some(Account {
        uid,
        uuid: v["uuid"].as_str().unwrap_or_default().to_string(),
        name,
        buying_lots: int(&v["buying"]["lots"]).unwrap_or(0),
        buying_total: v["buying"]["total"].as_str().unwrap_or_default().to_string(),
    })
}

pub fn parse_open_bids(v: &Value) -> Vec<MyBid> {
    let mut out = Vec::new();
    let Some(auctions) = v["data"].as_object() else { return out };
    for (auction, lots) in auctions {
        let (Some(auction_id), Some(lots)) = (auction.parse().ok(), lots.as_object()) else { continue };
        for (lot, d) in lots {
            let Ok(entity_id) = lot.parse() else { continue };
            out.push(MyBid {
                auction_id,
                entity_id,
                bid_pence: int(&d["userBid"]["amount"]),
                max_pence: int(&d["proxyBid"]["maxAmount"]),
                winning: d["isWinning"].as_bool().unwrap_or(false),
                met_reserve: d["metReserve"].as_bool().unwrap_or(false),
            });
        }
    }
    out
}

pub fn parse_bookmarks(v: &Value) -> Vec<Bookmark> {
    let Some(items) = v["commerce_product_variation"]["items"].as_object() else { return Vec::new() };
    items
        .iter()
        .filter(|(_, d)| int(&d["status"]) == Some(1))
        .filter_map(|(lot, d)| Some(Bookmark { entity_id: lot.parse().ok()?, auction_id: int(&d["auction"]) }))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn logged_out_user_is_none() {
        // Real anonymous response, 2026-10-29.
        let v = json!({"uid":"0","uuid":"0","buying":{"lots":0,"total":"£0.00"},"profile":{"first_name":"","last_name":"","link":"/user/login"}});
        assert_eq!(parse_user(&v), None);
    }

    #[test]
    fn user_fields() {
        let v = json!({"uid":"123","uuid":"abc-1","buying":{"lots":2,"total":"£150.00"},"profile":{"first_name":"Kim","last_name":""}});
        let a = parse_user(&v).unwrap();
        assert_eq!((a.uid, a.uuid.as_str(), a.name.as_str(), a.buying_lots), (123, "abc-1", "Kim", 2));
    }

    #[test]
    fn open_bids_accept_string_amounts() {
        let v = json!({"data":{"5000108":{"5320418":{"userBid":{"amount":"4500"},"proxyBid":{"maxAmount":"6000","nextAmount":"4750"},"isWinning":true,"metReserve":false}}},"timestamp":1});
        let b = parse_open_bids(&v);
        assert_eq!(b, vec![MyBid { auction_id: 5000108, entity_id: 5320418, bid_pence: Some(4500), max_pence: Some(6000), winning: true, met_reserve: false }]);
        assert!(parse_open_bids(&json!({})).is_empty());
    }

    #[test]
    fn bookmarks_keep_only_active() {
        let v = json!({"commerce_product_variation":{"items":{"1":{"status":"1","auction":"5000108"},"2":{"status":"0","auction":"5000108"}}}});
        assert_eq!(parse_bookmarks(&v), vec![Bookmark { entity_id: 1, auction_id: Some(5000108) }]);
        assert!(parse_bookmarks(&json!({"empty":true})).is_empty());
    }
}
