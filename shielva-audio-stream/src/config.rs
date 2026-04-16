use std::env;

/// Service configuration — all values from environment variables with sensible defaults.
#[derive(Clone, Debug)]
pub struct Config {
    /// Port this service listens on.
    pub port: u16,
    /// Upstream Python tacotron service URL (Chatterbox inference).
    pub tacotron_url: String,
    /// CDN/R2 service URL for audio persistence.
    pub cdn_url: String,
    /// API Gateway URL for service registration.
    pub gateway_url: String,
    /// R2 bucket for synthesized audio.
    pub voice_synthesis_bucket: String,
    /// Chunk size for streaming audio to clients (bytes).
    pub chunk_size: usize,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            port: env("AUDIO_STREAM_PORT", "8210").parse().unwrap_or(8210),
            tacotron_url: env("TACOTRON_URL", "https://localhost:8203"),
            cdn_url: env("CDN_SERVICE_URL", "http://localhost:8030"),
            gateway_url: env("GATEWAY_URL", "https://localhost:8000"),
            voice_synthesis_bucket: env("VOICE_SYNTHESIS_BUCKET", "voice-synthesis"),
            chunk_size: env("STREAM_CHUNK_SIZE", "32768")
                .parse()
                .unwrap_or(32768),
        }
    }
}

fn env(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
}
