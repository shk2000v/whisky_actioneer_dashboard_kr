//! Tauri 2 shell (optional): the same UI as the web server, talking to wa-core through one `rpc` command.

use std::sync::Arc;
use tauri::{Emitter, Manager, State};
use tokio::sync::Notify;
use wa_core::{rpc, Result, Service};

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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![rpc])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
