//! Watchlist polling schedule.
//!
//! The site has no push channel: its own bid widget re-requests `/api/lot` every
//! `drupalSettings.auction.refreshApp` = 240 s (120 s on a lot page), logged-in users only.

use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum PollMode {
    /// Slow most of the time, fast near the end of the auction.
    #[serde(rename_all = "camelCase")]
    Adaptive { normal_minutes: u32, final_window_minutes: u32, final_minutes: u32 },
    #[serde(rename_all = "camelCase")]
    Fixed { minutes: u32 },
    /// Near-real-time: every N seconds (floored at `REALTIME_MIN_SECS`).
    #[serde(rename_all = "camelCase")]
    Realtime { seconds: u32 },
}

pub const REALTIME_MIN_SECS: u32 = 10;
/// Poll once more this long after the auction end to capture final prices.
pub const AFTER_END_GRACE_SECS: i64 = 15 * 60;
/// When no auction is running, check again this often.
pub const IDLE_RECHECK: Duration = Duration::from_secs(30 * 60);

impl Default for PollMode {
    fn default() -> Self {
        PollMode::Adaptive { normal_minutes: 30, final_window_minutes: 120, final_minutes: 2 }
    }
}

/// Interval until the next watchlist poll. `None` = auction finished (stop fast polling).
///
/// `close` is the official closing start (19:00 UK); the fast window is measured from it.
/// `end` is the latest time the auction may still run (site value / extension); polling stays
/// fast between `close` and `end`, and stops `AFTER_END_GRACE_SECS` after `end`.
pub fn next_interval(mode: &PollMode, now: i64, close: Option<i64>, end: Option<i64>) -> Option<Duration> {
    let end = match (close, end) {
        (Some(c), Some(e)) => Some(c.max(e)),
        (c, e) => c.or(e),
    };
    let close = close.or(end);
    if let Some(end) = end {
        if now > end + AFTER_END_GRACE_SECS {
            return None;
        }
    }
    let secs: u64 = match *mode {
        PollMode::Fixed { minutes } => minutes.max(1) as u64 * 60,
        PollMode::Realtime { seconds } => seconds.max(REALTIME_MIN_SECS) as u64,
        PollMode::Adaptive { normal_minutes, final_window_minutes, final_minutes } => {
            let in_final = close.is_some_and(|c| now >= c - final_window_minutes as i64 * 60);
            let m = if in_final { final_minutes } else { normal_minutes };
            let mut s = m.max(1) as u64 * 60;
            // Don't sleep past the start of the final window.
            if let Some(c) = close {
                let window_start = c - final_window_minutes as i64 * 60;
                if !in_final && window_start > now {
                    s = s.min((window_start - now) as u64).max(60);
                }
            }
            s
        }
    };
    Some(Duration::from_secs(secs))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adaptive() {
        let m = PollMode::default();
        let end = 10_000_000;
        assert_eq!(next_interval(&m, end - 86_400, Some(end), Some(end)), Some(Duration::from_secs(1800)));
        // 2h05m before end -> wake at window start (5 min)
        assert_eq!(next_interval(&m, end - 7500, Some(end), Some(end)), Some(Duration::from_secs(300)));
        assert_eq!(next_interval(&m, end - 3600, Some(end), Some(end)), Some(Duration::from_secs(120)));
        assert_eq!(next_interval(&m, end + 60, Some(end), Some(end)), Some(Duration::from_secs(120)));
        assert_eq!(next_interval(&m, end + 3600, Some(end), Some(end)), None);
    }

    #[test]
    fn fast_from_official_close_through_extension() {
        let m = PollMode::default();
        let close = 1_000_000; // 19:00 UK
        let end = close + 4 * 3600; // site value later that night
        // 90 min before 19:00 is already inside the 2h window
        assert_eq!(next_interval(&m, close - 5400, Some(close), Some(end)), Some(Duration::from_secs(120)));
        // 21:00 UK, auction still being extended
        assert_eq!(next_interval(&m, close + 7200, Some(close), Some(end)), Some(Duration::from_secs(120)));
        assert_eq!(next_interval(&m, end + 3600, Some(close), Some(end)), None);
    }

    #[test]
    fn realtime_floor_and_fixed() {
        assert_eq!(next_interval(&PollMode::Realtime { seconds: 1 }, 0, None, None), Some(Duration::from_secs(10)));
        assert_eq!(next_interval(&PollMode::Fixed { minutes: 10 }, 0, None, None), Some(Duration::from_secs(600)));
    }

    #[test]
    fn serde_shape() {
        let j = serde_json::to_string(&PollMode::Realtime { seconds: 15 }).unwrap();
        assert_eq!(j, r#"{"mode":"realtime","seconds":15}"#);
        let m: PollMode = serde_json::from_str(r#"{"mode":"fixed","minutes":5}"#).unwrap();
        assert_eq!(m, PollMode::Fixed { minutes: 5 });
    }
}
