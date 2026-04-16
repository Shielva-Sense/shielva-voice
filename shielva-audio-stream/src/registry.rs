use crate::config::Config;
use serde_json::json;
use std::time::Duration;
use tracing::{info, warn};
use uuid::Uuid;

/// Background heartbeat loop — registers with the API gateway every 20 seconds.
///
/// Mirrors the Python `DiscoveryClient` pattern used by all Shielva services.
/// The gateway uses Redis-backed service registry with 30s TTL, so 20s heartbeat
/// keeps the entry alive.
pub async fn heartbeat_loop(config: Config) {
    let instance_id = Uuid::new_v4().to_string();
    let service_url = format!("https://localhost:{}", config.port);

    let payload = json!({
        "service_name": "audio-stream",
        "instance_id": instance_id,
        "url": service_url,
        "version": "0.1.0"
    });

    // Accept self-signed certs (same as other Shielva services in dev)
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(5))
        .build()
        .expect("Failed to build registry HTTP client");

    let register_url = format!("{}/register", config.gateway_url);

    info!(
        service = "audio-stream",
        instance_id = %instance_id,
        url = %service_url,
        "Starting heartbeat loop"
    );

    loop {
        match client.post(&register_url).json(&payload).send().await {
            Ok(resp) if resp.status().is_success() => {
                info!("Heartbeat sent to gateway");
            }
            Ok(resp) => {
                warn!(status = %resp.status(), "Gateway registration returned non-success");
            }
            Err(e) => {
                warn!(error = %e, "Gateway heartbeat failed — will retry");
            }
        }
        tokio::time::sleep(Duration::from_secs(20)).await;
    }
}
