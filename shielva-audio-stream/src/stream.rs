use std::convert::Infallible;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, Response, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use bytes::Bytes;
use futures_util::StreamExt;
use reqwest::multipart::{Form, Part};
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, Mutex};
use tokio_stream::wrappers::ReceiverStream;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::state::AppState;

// ── Request / response types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize, Serialize)]
pub struct SynthesizeRequest {
    #[serde(default)]
    pub phonemes: Vec<String>,
    pub voice_id: String,
    #[serde(default)]
    pub text: String,
}

// ── Header forwarding ────────────────────────────────────────────────────────

/// Forward auth + tenant headers from the client to the upstream tacotron service.
fn forward_headers(src: &HeaderMap) -> reqwest::header::HeaderMap {
    let mut dst = reqwest::header::HeaderMap::new();
    for key in &[
        "x-tenant-id",
        "x-session-id",
        "x-user-email",
        "authorization",
        "x-amt-session-id",
    ] {
        if let Some(val) = src.get(*key) {
            if let Ok(v) = val.to_str() {
                if let Ok(k) = reqwest::header::HeaderName::from_bytes(key.as_bytes()) {
                    if let Ok(hv) = reqwest::header::HeaderValue::from_str(v) {
                        dst.insert(k, hv);
                    }
                }
            }
        }
    }
    dst
}

/// Extract tenant ID from headers (gateway injects this).
fn tenant_id(headers: &HeaderMap) -> String {
    headers
        .get("x-tenant-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string()
}

// ── Core streaming handler ───────────────────────────────────────────────────

/// `POST /amt/v1/synthesize/stream`
///
/// 1. Proxies the request to the Python tacotron service (Chatterbox ML inference).
/// 2. Streams the WAV response back to the client in real-time (32KB chunks).
/// 3. Spawns a background task to upload the full WAV to R2 for persistence.
///
/// The client starts hearing audio within milliseconds of the first chunk.
/// R2 upload happens *after* the client has received the full stream.
pub async fn synthesize_stream(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<SynthesizeRequest>,
) -> impl IntoResponse {
    let tid = tenant_id(&headers);
    let upstream_url = format!(
        "{}/amt/v1/synthesize/stream",
        state.config.tacotron_url
    );

    info!(
        tenant_id = %tid,
        voice_id = %body.voice_id,
        text_len = body.text.len(),
        "Proxying synthesis to tacotron"
    );

    // POST to upstream Python tacotron — get a streaming response
    let upstream_resp = match state
        .http_client
        .post(&upstream_url)
        .headers(forward_headers(&headers))
        .json(&body)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => resp,
        Ok(resp) => {
            let status = resp.status().as_u16();
            let body_text = resp.text().await.unwrap_or_default();
            warn!(status, body = %body_text, "Tacotron returned error");
            return Response::builder()
                .status(StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY))
                .header("content-type", "application/json")
                .body(Body::from(body_text))
                .unwrap();
        }
        Err(e) => {
            error!(error = %e, "Failed to connect to tacotron");
            return Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::json!({"error": "Tacotron service unavailable"}).to_string(),
                ))
                .unwrap();
        }
    };

    // Channel: tacotron chunks → client stream + R2 buffer
    let (tx, rx) = mpsc::channel::<Bytes>(64);
    let upload_buf: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::with_capacity(512 * 1024)));
    let buf_for_task = upload_buf.clone();
    let state_for_task = state.clone();
    let tid_for_task = tid.clone();

    // Spawn: read from tacotron stream → push to channel + accumulate for R2
    tokio::spawn(async move {
        let mut stream = upstream_resp.bytes_stream();
        let mut total_bytes: usize = 0;

        while let Some(chunk_result) = stream.next().await {
            match chunk_result {
                Ok(chunk) => {
                    total_bytes += chunk.len();
                    // Accumulate for R2 upload (cheap — just extends a Vec)
                    buf_for_task.lock().await.extend_from_slice(&chunk);
                    // Send to client channel (zero-copy Bytes)
                    if tx.send(chunk).await.is_err() {
                        warn!("Client disconnected during stream");
                        break;
                    }
                }
                Err(e) => {
                    error!(error = %e, "Error reading from tacotron stream");
                    break;
                }
            }
        }
        // tx is dropped here → client stream ends

        info!(total_bytes, tenant_id = %tid_for_task, "Stream complete, uploading to R2");

        // Background: upload full WAV to R2
        let full_wav = buf_for_task.lock().await.clone();
        if !full_wav.is_empty() {
            upload_to_r2(&state_for_task, &tid_for_task, &full_wav).await;
        }
    });

    // Stream channel → client (zero-copy, immediate)
    let body_stream = ReceiverStream::new(rx).map(Ok::<_, Infallible>);
    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "audio/wav")
        .header("transfer-encoding", "chunked")
        .header("cache-control", "no-cache")
        .header("x-powered-by", "shielva-audio-stream/rust")
        .body(Body::from_stream(body_stream))
        .unwrap()
}

// ── R2 upload (background, non-blocking) ─────────────────────────────────────

async fn upload_to_r2(state: &AppState, tenant_id: &str, wav_bytes: &[u8]) {
    let cdn_key = format!("Synthesis/tts/{}/{}.wav", tenant_id, Uuid::new_v4());
    let upload_url = format!("{}/cdn/upload", state.config.cdn_url);

    let part = match Part::bytes(wav_bytes.to_vec())
        .file_name("output.wav")
        .mime_str("audio/wav")
    {
        Ok(p) => p,
        Err(e) => {
            error!(error = %e, "Failed to create multipart part");
            return;
        }
    };

    let form = Form::new()
        .text("bucket", state.config.voice_synthesis_bucket.clone())
        .text("key", cdn_key.clone())
        .part("file", part);

    match state.http_client.post(&upload_url).multipart(form).send().await {
        Ok(resp) if resp.status().is_success() => {
            info!(key = %cdn_key, size = wav_bytes.len(), "Audio uploaded to R2");
        }
        Ok(resp) => {
            warn!(
                status = %resp.status(),
                key = %cdn_key,
                "R2 upload returned non-success"
            );
        }
        Err(e) => {
            error!(error = %e, key = %cdn_key, "R2 upload failed");
        }
    }
}

// ── Health check ─────────────────────────────────────────────────────────────

pub async fn health() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "service": "shielva-audio-stream",
        "version": "0.1.0",
        "runtime": "rust/tokio"
    }))
}
