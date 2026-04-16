use std::time::Duration;

use crate::config::Config;

/// Shared application state — passed to all axum handlers via `State<Arc<AppState>>`.
#[derive(Debug)]
pub struct AppState {
    pub config: Config,
    /// Reusable HTTP client — connection pooling + keep-alive.
    /// One client for the entire service lifetime.
    pub http_client: reqwest::Client,
}

impl AppState {
    pub fn new(config: Config) -> Self {
        let http_client = reqwest::Client::builder()
            // Accept self-signed certs (dev environment uses localhost certs)
            .danger_accept_invalid_certs(true)
            // Connection pool: reuse connections to tacotron + CDN
            .pool_max_idle_per_host(10)
            .pool_idle_timeout(Duration::from_secs(90))
            // Timeouts
            .connect_timeout(Duration::from_secs(10))
            // No read timeout — streaming responses can take minutes
            .timeout(Duration::from_secs(300))
            .build()
            .expect("Failed to build HTTP client");

        Self {
            config,
            http_client,
        }
    }
}
