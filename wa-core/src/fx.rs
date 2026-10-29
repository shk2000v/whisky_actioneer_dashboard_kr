//! GBP exchange rates from open.er-api.com (ExchangeRate-API free endpoint, updated once a day).
//! Response fields used: `result`, `time_last_update_utc`, `rates.KRW`, `rates.USD`.

use crate::tax::Fx;
use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const FX_URL: &str = "https://open.er-api.com/v6/latest/GBP";
pub const FX_SOURCE: &str = "open.er-api.com (ExchangeRate-API)";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FxRecord {
    pub gbp_krw: f64,
    pub gbp_usd: f64,
    /// Provider's own update time (string as given).
    pub source_updated: String,
    /// When this app fetched it (unix seconds).
    pub fetched_at: i64,
    pub source: String,
    /// true when a refresh failed and this is an older cached value.
    #[serde(default)]
    pub stale: bool,
}

impl FxRecord {
    pub fn fx(&self) -> Fx {
        Fx { gbp_krw: self.gbp_krw, gbp_usd: self.gbp_usd }
    }
}

pub fn parse_fx(v: &Value, fetched_at: i64) -> Result<FxRecord> {
    if v.get("result").and_then(Value::as_str) != Some("success") {
        return Err(Error::other("환율 API 응답이 success가 아닙니다"));
    }
    let rate = |c: &str| v.pointer(&format!("/rates/{c}")).and_then(Value::as_f64);
    let (Some(krw), Some(usd)) = (rate("KRW"), rate("USD")) else {
        return Err(Error::other("환율 API 응답에 KRW/USD가 없습니다"));
    };
    Ok(FxRecord {
        gbp_krw: krw,
        gbp_usd: usd,
        source_updated: v.get("time_last_update_utc").and_then(Value::as_str).unwrap_or_default().to_string(),
        fetched_at,
        source: FX_SOURCE.to_string(),
        stale: false,
    })
}

/// Korea calendar day (UTC+9) of a unix timestamp, used for "once a day" refresh.
pub fn kst_day(unix: i64) -> i64 {
    (unix + 9 * 3600).div_euclid(86_400)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_er_api() {
        let v: Value = serde_json::from_str(
            r#"{"result":"success","time_last_update_utc":"Tue, 27 Oct 2026 00:02:31 +0000","rates":{"GBP":1,"KRW":1769.177961,"USD":1.334708}}"#,
        )
        .unwrap();
        let r = parse_fx(&v, 5).unwrap();
        assert_eq!(r.gbp_krw, 1769.177961);
        assert_eq!(r.gbp_usd, 1.334708);
        assert!(parse_fx(&serde_json::json!({"result":"error"}), 0).is_err());
    }

    #[test]
    fn kst_days() {
        // 2026-10-27 14:59:59 UTC = 23:59:59 KST, +1s = next KST day
        let a = 1_793_113_199;
        assert_eq!(kst_day(a) + 1, kst_day(a + 1));
    }
}
