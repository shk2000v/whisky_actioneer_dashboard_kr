//! Whisky Auctioneer tracker core.
//!
//! Data sources (verified against whiskyauctioneer.com on 2026-10-28):
//! - Lot listing HTML: `/whisky-auctions/{slug}/lots?...` (Drupal Views, `.lot-teaser` cards)
//! - Live price JSON: `/api/lot/{auction_id}/{entity_id}` (public, amounts in pence)
//! - Facet JSON: `/api/facets?view_name=lots_index&view_display_id=lots_page&view_args={auction_id}`
//! - Auction index HTML: `/whisky-auctions`

pub mod account;
pub mod client;
pub mod db;
pub mod error;
pub mod fx;
pub mod models;
pub mod parse;
pub mod poll;
pub mod poller;
pub mod query;
pub mod rpc;
pub mod service;
pub mod settings;
pub mod tax;
pub mod ukclock;

pub use error::{Error, Result};
pub use service::Service;

/// Current unix time in seconds.
pub fn now_unix() -> i64 {
    chrono::Utc::now().timestamp()
}
