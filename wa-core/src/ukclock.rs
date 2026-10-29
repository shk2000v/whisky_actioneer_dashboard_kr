//! UK civil time without a timezone database.
//!
//! Whisky Auctioneer: "Our monthly auctions end from 7:00 PM (UK local time) on the closing date.
//! If a bid is placed after 7:00 PM on any lot, the entire auction will be extended by an additional
//! two minutes." (https://whiskyauctioneer.com/learn/about/faqs, checked 2026-10-28)
//!
//! UK summer time (BST, UTC+1) runs from 01:00 UTC on the last Sunday of March to 01:00 UTC on the
//! last Sunday of October (The Summer Time Order 2002 / EU-aligned rule still used by the UK).

use chrono::{Datelike, Duration, NaiveDate, TimeZone, Utc, Weekday};

pub const CLOSE_HOUR_UK: u32 = 19;

fn last_sunday(year: i32, month: u32) -> NaiveDate {
    let first_next = if month == 12 { NaiveDate::from_ymd_opt(year + 1, 1, 1) } else { NaiveDate::from_ymd_opt(year, month + 1, 1) }.unwrap();
    let mut d = first_next - Duration::days(1);
    while d.weekday() != Weekday::Sun {
        d -= Duration::days(1);
    }
    d
}

fn utc_at(date: NaiveDate, hour: u32) -> i64 {
    Utc.from_utc_datetime(&date.and_hms_opt(hour, 0, 0).unwrap()).timestamp()
}

/// UK offset from UTC in seconds at an instant (0 or 3600).
pub fn uk_offset(unix: i64) -> i64 {
    let year = Utc.timestamp_opt(unix, 0).unwrap().year();
    let start = utc_at(last_sunday(year, 3), 1);
    let end = utc_at(last_sunday(year, 10), 1);
    if unix >= start && unix < end { 3600 } else { 0 }
}

/// 19:00 UK local time on the UK calendar day of `unix`.
pub fn uk_close_on_day_of(unix: i64) -> i64 {
    let local = Utc.timestamp_opt(unix + uk_offset(unix), 0).unwrap().date_naive();
    let naive = utc_at(local, CLOSE_HOUR_UK);
    // `naive` is 19:00 as if UK were UTC; shift by the offset in force at that moment.
    naive - uk_offset(naive - 3600)
}

/// Official closing start for an auction whose site-provided end time is `end_unix`.
/// The site value can be later the same evening (extension window), so take 19:00 UK of that day,
/// and never later than the site value.
pub fn official_close(end_unix: i64) -> i64 {
    uk_close_on_day_of(end_unix).min(end_unix)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dst_boundaries_2026() {
        // BST ends 2026-10-25 01:00 UTC
        assert_eq!(uk_offset(1792890000 - 1), 3600); // 2026-10-25 00:59:59 UTC
        assert_eq!(uk_offset(1792890000), 0);
        // BST starts 2026-03-29 01:00 UTC
        assert_eq!(uk_offset(1774746000 - 1), 0);
        assert_eq!(uk_offset(1774746000), 3600);
    }

    #[test]
    fn october_2026_auction_close() {
        // Site end value 1793661919 = 2026-11-02 23:25:19 GMT -> official close 2026-11-02 19:00 GMT
        let c = official_close(1793661919);
        assert_eq!(c, 1793646000); // 2026-11-02 19:00:00 UTC = 2026-11-03 04:00 KST
    }

    #[test]
    fn summer_close_is_18_utc() {
        // 2026-07-06 21:00 BST (20:00 UTC) -> 19:00 BST = 18:00 UTC
        let end = Utc.with_ymd_and_hms(2026, 7, 6, 20, 0, 0).unwrap().timestamp();
        assert_eq!(official_close(end), Utc.with_ymd_and_hms(2026, 7, 6, 18, 0, 0).unwrap().timestamp());
    }
}
