//! Background loop shared by the web server and the desktop shell.
//!
//! Every cycle: refresh the auction index (at most every 6 h), keep the daily FX rate,
//! poll watched lots of the running auction, then sleep per [`crate::poll`] or until woken.

use crate::service::PollReport;
use crate::Service;
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Notify;

const AUCTION_INDEX_TTL: Duration = Duration::from_secs(6 * 3600);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PollerStatus {
    pub next_poll_in_secs: u64,
    pub last: Option<PollReport>,
    pub error: Option<String>,
}

/// `emit(event_name, payload)` delivers events to the UI (SSE or Tauri events).
pub async fn run<F>(svc: Arc<Service>, wake: Arc<Notify>, emit: F)
where
    F: Fn(&str, Value) + Send + Sync + 'static,
{
    let mut last_index: Option<Instant> = None;
    let mut last_report: Option<PollReport> = None;
    loop {
        let mut error = None;
        if last_index.is_none_or(|t| t.elapsed() >= AUCTION_INDEX_TTL) {
            match svc.refresh_auctions().await {
                Ok(ov) => {
                    last_index = Some(Instant::now());
                    emit("overview-updated", to(&ov));
                }
                Err(e) => error = Some(format!("경매 목록을 갱신하지 못했습니다: {e}")),
            }
        }
        if let Ok(fx) = svc.fx(false).await {
            emit("fx-updated", to(&fx));
        }
        match svc.poll_watchlist().await {
            Ok(rep) => {
                if rep.polled > 0 {
                    emit("watchlist-updated", to(&rep));
                }
                if !rep.errors.is_empty() {
                    error = Some(rep.errors.join("; "));
                }
                last_report = Some(rep);
            }
            Err(e) => error = Some(e.to_string()),
        }
        let delay = svc.next_poll_delay();
        emit("poller-status", to(&PollerStatus { next_poll_in_secs: delay.as_secs(), last: last_report.clone(), error }));
        tokio::select! {
            _ = tokio::time::sleep(delay) => {}
            _ = wake.notified() => tokio::time::sleep(Duration::from_secs(2)).await,
        }
    }
}

fn to<T: Serialize>(v: &T) -> Value {
    serde_json::to_value(v).unwrap_or(Value::Null)
}
