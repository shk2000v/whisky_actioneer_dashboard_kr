//! Tauri 2 shell (optional): the same UI as the web server, talking to wa-core through one `rpc` command.

use std::sync::Arc;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::Notify;
use wa_core::{rpc, Result, Service};

const SITE: &str = "whiskyauctioneer.com";
const LOGIN_URL: &str = "https://whiskyauctioneer.com/user/login";
const LOGIN_LABEL: &str = "wa-login";

pub struct AppState {
    svc: Arc<Service>,
    wake: Arc<Notify>,
}

#[tauri::command]
async fn rpc(state: State<'_, AppState>, cmd: String, args: serde_json::Value) -> Result<serde_json::Value> {
    let out = rpc::dispatch(&state.svc, &cmd, args).await?;
    if out.wake_poller {
        state.wake.notify_one();
    }
    Ok(out.value)
}

/// Site cookies from the app's WebKit store, which the main window and the login window share
/// (WebKit keeps it across launches; the app itself never stores the password or the cookie).
/// `None` unless a Drupal session cookie (`SSESS…`/`SESS…`) is present.
fn site_cookie(app: &AppHandle) -> Option<String> {
    let win = app.get_webview_window("main")?;
    // `cookies()` rather than `cookies_for_url`: wry compares the domain exactly and would drop `.whiskyauctioneer.com`.
    let cookies: Vec<_> = win
        .cookies()
        .ok()?
        .into_iter()
        .filter(|c| c.domain().map(|d| d.trim_start_matches('.')) == Some(SITE))
        .collect();
    if !cookies.iter().any(|c| c.name().starts_with("SSESS") || c.name().starts_with("SESS")) {
        return None;
    }
    Some(cookies.iter().map(|c| format!("{}={}", c.name(), c.value())).collect::<Vec<_>>().join("; "))
}

/// Picks up the site session (if any) and reads the account; tells the UI either way.
async fn sync_from_webview(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    let Some(cookie) = site_cookie(app) else { return false };
    state.svc.set_session(Some(cookie));
    // Unknown lots mean a few lot pages at the site's 10 s crawl delay, so this can take a while.
    let _ = app.emit("account-syncing", ());
    let ok = match state.svc.sync_account().await {
        Ok(sync) => {
            let _ = app.emit("account", Some(sync));
            true
        }
        Err(e) => {
            let _ = app.emit("account-error", e.to_string());
            false
        }
    };
    let _ = app.emit("watchlist-updated", ());
    state.wake.notify_one();
    ok
}

/// Opens the site's own login page in an app window. The user types the password there, on the site;
/// once a page other than the login form loads with a session cookie, the account is read and the window closes.
#[tauri::command]
async fn login_open(app: AppHandle) -> Result<()> {
    if let Some(w) = app.get_webview_window(LOGIN_LABEL) {
        let _ = w.set_focus();
        return Ok(());
    }
    let url = LOGIN_URL.parse().map_err(|e| wa_core::Error::other(format!("{e}")))?;
    WebviewWindowBuilder::new(&app, LOGIN_LABEL, WebviewUrl::External(url))
        .title("Whisky Auctioneer 로그인")
        .inner_size(520.0, 760.0)
        .on_page_load(|w, p| {
            let path = p.url().path().to_string();
            if p.event() != PageLoadEvent::Finished || path.starts_with("/user/login") || path.starts_with("/user/password") {
                return;
            }
            let app = w.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                if site_cookie(&app).is_none() {
                    return;
                }
                if let Some(w) = app.get_webview_window(LOGIN_LABEL) {
                    let _ = w.close();
                }
                sync_from_webview(&app).await;
            });
        })
        .build()
        .map_err(|e| wa_core::Error::other(format!("로그인 창을 열 수 없습니다: {e}")))?;
    Ok(())
}

/// Forgets the site session in this app: deletes the site cookies from the app's WebKit store.
/// Nothing is sent to the site.
#[tauri::command]
async fn logout(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    if let Some(win) = app.get_webview_window("main") {
        for c in win.cookies().unwrap_or_default() {
            if c.domain().map(|d| d.trim_start_matches('.')) == Some(SITE) {
                let _ = win.delete_cookie(c);
            }
        }
    }
    state.svc.set_session(None);
    let _ = app.emit("account", None::<()>);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let svc = Arc::new(Service::open(&dir.join("whisky-tracker.db")).map_err(|e| e.to_string())?);
            let wake = Arc::new(Notify::new());
            app.manage(AppState { svc: svc.clone(), wake: wake.clone() });
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(wa_core::poller::run(svc, wake, move |event, payload| {
                let _ = handle.emit(event, payload);
            }));
            // A login from an earlier launch is still in WebKit's cookie store.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                sync_from_webview(&handle).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![rpc, login_open, logout])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
