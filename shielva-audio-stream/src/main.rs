mod config;
mod registry;
mod stream;
pub mod state;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::routing::{get, post};
use axum::Router;
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;
use tracing::info;

use config::Config;
use state::AppState;

#[tokio::main]
async fn main() {
    // Structured logging (respects RUST_LOG env var)
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "shielva_audio_stream=info,tower_http=info".into()),
        )
        .init();

    let config = Config::from_env();
    let port = config.port;
    let state = Arc::new(AppState::new(config.clone()));

    // Background: register with gateway every 20s
    tokio::spawn(registry::heartbeat_loop(config));

    let app = Router::new()
        .route("/amt/v1/synthesize/stream", post(stream::synthesize_stream))
        .route("/health", get(stream::health))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!(port, "Shielva Audio Stream service starting");

    let listener = TcpListener::bind(addr)
        .await
        .expect("Failed to bind TCP listener");

    info!(port, "Listening — ready to stream audio");
    axum::serve(listener, app).await.expect("Server error");
}
