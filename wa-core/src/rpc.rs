//! One command surface for every front end.
//!
//! The web server (`POST /rpc/{cmd}`) and the Tauri shell (`invoke("rpc", {cmd, args})`) both call
//! [`dispatch`], so the browser and the desktop app share exactly the same API.

use crate::query::FilterQuery;
use crate::settings::Settings;
use crate::tax::{CalcItem, TaxSettings};
use crate::{Error, Result, Service};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};

fn args<T: DeserializeOwned>(v: Value) -> Result<T> {
    let v = if v.is_null() { json!({}) } else { v };
    serde_json::from_value(v).map_err(|e| Error::other(format!("잘못된 요청 인자: {e}")))
}

fn ok<T: serde::Serialize>(v: T) -> Result<Value> {
    Ok(serde_json::to_value(v)?)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Refresh {
    #[serde(default)]
    refresh: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchArgs {
    slug: Option<String>,
    query: FilterQuery,
    #[serde(default)]
    page: u32,
    with_prices: Option<bool>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SlugQuery {
    slug: Option<String>,
    query: FilterQuery,
}
#[derive(Deserialize)]
struct UrlArg {
    url: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavePreset {
    id: Option<i64>,
    name: String,
    slug: Option<String>,
    query: FilterQuery,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PresetFromUrl {
    name: String,
    url: String,
    #[serde(default)]
    follow_active: bool,
}
#[derive(Deserialize)]
struct Id {
    id: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PresetRun {
    id: i64,
    slug: Option<String>,
    #[serde(default)]
    with_prices: bool,
}
#[derive(Deserialize)]
struct Sku {
    sku: String,
}
#[derive(Deserialize)]
struct Skus {
    skus: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WatchUpdate {
    sku: String,
    participating: bool,
    my_max_gbp: Option<f64>,
    note: Option<String>,
}
#[derive(Deserialize)]
struct Force {
    #[serde(default)]
    force: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FxManual {
    gbp_krw: f64,
    gbp_usd: f64,
}
#[derive(Deserialize)]
struct Calc {
    items: Vec<CalcItem>,
    overrides: Option<TaxSettings>,
}
#[derive(Deserialize)]
struct Items {
    items: Vec<CalcItem>,
}
#[derive(Deserialize)]
struct SettingsArg {
    settings: Settings,
}

/// What a command changed, so the caller can wake the poller.
pub struct Outcome {
    pub value: Value,
    pub wake_poller: bool,
}

pub async fn dispatch(svc: &Service, cmd: &str, a: Value) -> Result<Outcome> {
    let mut wake = false;
    let value = match cmd {
        "get_overview" => {
            let r: Refresh = args(a)?;
            let ov = svc.cached_overview()?;
            if r.refresh || ov.auctions.is_empty() {
                wake = true;
                ok(svc.refresh_auctions().await?)
            } else {
                ok(ov)
            }
        }
        "search" => {
            let r: SearchArgs = args(a)?;
            ok(svc.search(r.slug.as_deref(), &r.query, r.page, r.with_prices).await?)
        }
        "get_facets" => {
            let r: SlugQuery = args(a)?;
            ok(svc.facets(r.slug.as_deref(), &r.query).await?)
        }
        "parse_wa_url" => {
            let r: UrlArg = args(a)?;
            let (slug, query) = FilterQuery::from_wa_url(&r.url)?;
            ok(json!({ "slug": slug, "query": query }))
        }
        "list_presets" => ok(svc.presets()?),
        "save_preset" => {
            let r: SavePreset = args(a)?;
            ok(svc.save_preset(r.id, &r.name, r.slug.as_deref(), &r.query)?)
        }
        "preset_from_url" => {
            let r: PresetFromUrl = args(a)?;
            ok(svc.preset_from_url(&r.name, &r.url, r.follow_active)?)
        }
        "delete_preset" => {
            let r: Id = args(a)?;
            ok(svc.delete_preset(r.id)?)
        }
        "preset_cached" => {
            let r: PresetRun = args(a)?;
            ok(svc.preset_cached(r.id, r.slug.as_deref()).await?)
        }
        "run_preset" => {
            let r: PresetRun = args(a)?;
            ok(svc.run_preset(r.id, r.slug.as_deref(), r.with_prices).await?)
        }
        "watchlist" => ok(svc.watchlist()?),
        "watch_add" => {
            let r: Sku = args(a)?;
            wake = true;
            ok(svc.watch_add(&r.sku)?)
        }
        "watch_remove" => {
            let r: Sku = args(a)?;
            ok(svc.watch_remove(&r.sku)?)
        }
        "watch_update" => {
            let r: WatchUpdate = args(a)?;
            ok(svc.watch_update(&r.sku, r.participating, r.my_max_gbp, r.note.as_deref())?)
        }
        "history" => {
            let r: Sku = args(a)?;
            ok(svc.history(&r.sku)?)
        }
        "product_history" => {
            let r: Sku = args(a)?;
            ok(svc.product_history(&r.sku)?)
        }
        "refresh_prices" => {
            let r: Skus = args(a)?;
            ok(svc.refresh_prices_for(&r.skus).await?)
        }
        "poll_now" => ok(svc.poll_watchlist().await?),
        "get_fx" => {
            let r: Force = args(a)?;
            ok(svc.fx(r.force).await?)
        }
        "set_fx_manual" => {
            let r: FxManual = args(a)?;
            ok(svc.set_fx_manual(r.gbp_krw, r.gbp_usd)?)
        }
        "calculate" => {
            let r: Calc = args(a)?;
            let (result, fx) = svc.calculate(&r.items, r.overrides).await?;
            ok(json!({ "result": result, "fx": fx }))
        }
        "calculate_each" => {
            let r: Items = args(a)?;
            let (results, fx) = svc.calculate_each(&r.items).await?;
            ok(json!({ "results": results, "fx": fx }))
        }
        "basket" => ok(svc.basket().await?),
        "get_account" => ok(svc.account()),
        "sync_account" => {
            wake = true;
            ok(svc.sync_account().await?)
        }
        "get_settings" => ok(svc.settings()),
        "save_settings" => {
            let r: SettingsArg = args(a)?;
            wake = true;
            ok(svc.update_settings(r.settings)?)
        }
        other => Err(Error::other(format!("알 수 없는 명령: {other}"))),
    }?;
    Ok(Outcome { value, wake_poller: wake })
}
