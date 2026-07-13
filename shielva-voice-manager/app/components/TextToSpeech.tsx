"use client";

import { useState, useEffect, useRef } from "react";
import { Volume2, Play } from "lucide-react";
import { notify } from "../lib/toast";
import { synthesizeSpeech, translate, getLanguages, recordUsage, engineForLang, SUPPORTED_TTS_LANGS, type TranslateEngine } from "../lib/amt-api";
import { Keyboard } from "lucide-react";
import { type LangOption } from "./LanguageSelect";
import LanguagePickerModal from "./LanguagePickerModal";
import EngineToggle from "./EngineToggle";
import { useProcessing } from "../context/ProcessingContext";
import { useAuth } from "../context/AuthContext";
import { useVoice } from "../context/VoiceContext";
import { useVoices } from "../hooks/useVoices";
import { useStorage } from "../context/StorageContext";
import UsageIndicator from "./UsageIndicator";
import SoapBubblePlayer from "./SoapBubblePlayer";

// ─── Language map (ISO 639-1 → display name + flag) ─────────────────────────
// Indian regional languages grouped first, then international
const LANGUAGES: Record<string, { name: string; flag: string; group: "indian" | "international" }> = {
  // ── Indian regional ──────────────────────────────────────────────────────
  hi: { name: "Hindi",      flag: "🇮🇳", group: "indian" },
  ta: { name: "Tamil",      flag: "🇮🇳", group: "indian" },
  te: { name: "Telugu",     flag: "🇮🇳", group: "indian" },
  kn: { name: "Kannada",    flag: "🇮🇳", group: "indian" },
  ml: { name: "Malayalam",  flag: "🇮🇳", group: "indian" },
  mr: { name: "Marathi",    flag: "🇮🇳", group: "indian" },
  bn: { name: "Bengali",    flag: "🇮🇳", group: "indian" },
  gu: { name: "Gujarati",   flag: "🇮🇳", group: "indian" },
  pa: { name: "Punjabi",    flag: "🇮🇳", group: "indian" },
  or: { name: "Odia",       flag: "🇮🇳", group: "indian" },
  as: { name: "Assamese",   flag: "🇮🇳", group: "indian" },
  ur: { name: "Urdu",       flag: "🇮🇳", group: "indian" },
  sa: { name: "Sanskrit",   flag: "🇮🇳", group: "indian" },
  // ── International ────────────────────────────────────────────────────────
  en: { name: "English",    flag: "🇺🇸", group: "international" },
  es: { name: "Spanish",    flag: "🇪🇸", group: "international" },
  fr: { name: "French",     flag: "🇫🇷", group: "international" },
  de: { name: "German",     flag: "🇩🇪", group: "international" },
  ja: { name: "Japanese",   flag: "🇯🇵", group: "international" },
  zh: { name: "Chinese",    flag: "🇨🇳", group: "international" },
  ar: { name: "Arabic",     flag: "🇸🇦", group: "international" },
  pt: { name: "Portuguese", flag: "🇧🇷", group: "international" },
  ru: { name: "Russian",    flag: "🇷🇺", group: "international" },
  ko: { name: "Korean",     flag: "🇰🇷", group: "international" },
  it: { name: "Italian",    flag: "🇮🇹", group: "international" },
  nl: { name: "Dutch",      flag: "🇳🇱", group: "international" },
  tr: { name: "Turkish",    flag: "🇹🇷", group: "international" },
  pl: { name: "Polish",     flag: "🇵🇱", group: "international" },
  sv: { name: "Swedish",    flag: "🇸🇪", group: "international" },
  vi: { name: "Vietnamese", flag: "🇻🇳", group: "international" },
  th: { name: "Thai",       flag: "🇹🇭", group: "international" },
  id: { name: "Indonesian", flag: "🇮🇩", group: "international" },
  uk: { name: "Ukrainian",  flag: "🇺🇦", group: "international" },
  cs: { name: "Czech",      flag: "🇨🇿", group: "international" },
  hu: { name: "Hungarian",  flag: "🇭🇺", group: "international" },
};

// ─── Virtual Keyboard Layouts ────────────────────────────────────────────────
const KB_LAYOUTS: Record<string, string[][]> = {
  hi: [
    ["अ","आ","इ","ई","उ","ऊ","ए","ऐ","ओ","औ","अं","अः"],
    ["क","ख","ग","घ","ङ","च","छ","ज","झ","ञ","ट","ठ"],
    ["ड","ढ","ण","त","थ","द","ध","न","प","फ","ब","भ"],
    ["म","य","र","ल","व","श","ष","स","ह","क्ष","त्र","ज्ञ"],
    ["ा","ि","ी","ु","ू","े","ै","ो","ौ","्","ं","ः"],
  ],
  ta: [
    ["அ","ஆ","இ","ஈ","உ","ஊ","எ","ஏ","ஐ","ஒ","ஓ","ஔ"],
    ["க","ங","ச","ஞ","ட","ண","த","ந","ப","ம","ய","ர"],
    ["ல","வ","ழ","ள","ற","ன","ஜ","ஷ","ஸ","ஹ","ா","ி"],
    ["ீ","ு","ூ","ெ","ே","ை","ொ","ோ","ௌ","்","ஃ","ௐ"],
  ],
  te: [
    ["అ","ఆ","ఇ","ఈ","ఉ","ఊ","ఎ","ఏ","ఐ","ఒ","ఓ","ఔ"],
    ["క","ఖ","గ","ఘ","ఙ","చ","ఛ","జ","ఝ","ఞ","ట","ఠ"],
    ["డ","ఢ","ణ","త","థ","ద","ధ","న","ప","ఫ","బ","భ"],
    ["మ","య","ర","ల","వ","శ","ష","స","హ","ా","ి","ు"],
  ],
  bn: [
    ["অ","আ","ই","ঈ","উ","ঊ","এ","ঐ","ও","ঔ","অং","অঃ"],
    ["ক","খ","গ","ঘ","ঙ","চ","ছ","জ","ঝ","ঞ","ট","ঠ"],
    ["ড","ঢ","ণ","ত","থ","দ","ধ","ন","প","ফ","ব","ভ"],
    ["ম","য","র","ল","শ","ষ","স","হ","া","ি","ু","্"],
  ],
  kn: [
    ["ಅ","ಆ","ಇ","ಈ","ಉ","ಊ","ಎ","ಏ","ಐ","ಒ","ಓ","ಔ"],
    ["ಕ","ಖ","ಗ","ಘ","ಙ","ಚ","ಛ","ಜ","ಝ","ಞ","ಟ","ಠ"],
    ["ಡ","ಢ","ಣ","ತ","ಥ","ದ","ಧ","ನ","ಪ","ಫ","ಬ","ಭ"],
    ["ಮ","ಯ","ರ","ಲ","ವ","ಶ","ಷ","ಸ","ಹ","ಾ","ಿ","್"],
  ],
  ml: [
    ["അ","ആ","ഇ","ഈ","ഉ","ഊ","എ","ഏ","ഐ","ഒ","ഓ","ഔ"],
    ["ക","ഖ","ഗ","ഘ","ങ","ച","ഛ","ജ","ഝ","ഞ","ട","ഠ"],
    ["ഡ","ഢ","ണ","ത","ഥ","ദ","ധ","ന","പ","ഫ","ബ","ഭ"],
    ["മ","യ","ര","ല","വ","ശ","ഷ","സ","ഹ","ാ","ി","്"],
  ],
  gu: [
    ["અ","આ","ઇ","ઈ","ઉ","ઊ","એ","ઐ","ઓ","ઔ","અં","અઃ"],
    ["ક","ખ","ગ","ઘ","ઙ","ચ","છ","જ","ઝ","ઞ","ટ","ઠ"],
    ["ડ","ઢ","ણ","ત","થ","દ","ધ","ન","પ","ફ","બ","ભ"],
    ["મ","ય","ર","લ","વ","શ","ષ","સ","હ","ા","િ","્"],
  ],
  mr: [
    ["अ","आ","इ","ई","उ","ऊ","ए","ऐ","ओ","औ","अं","अः"],
    ["क","ख","ग","घ","ङ","च","छ","ज","झ","ञ","ट","ठ"],
    ["ड","ढ","ण","त","थ","द","ध","न","प","फ","ब","भ"],
    ["म","य","र","ल","व","श","ष","स","ह","ळ","ा","्"],
  ],
  pa: [
    ["ਅ","ਆ","ਇ","ਈ","ਉ","ਊ","ਏ","ਐ","ਓ","ਔ","ਅੰ","ਅਃ"],
    ["ਕ","ਖ","ਗ","ਘ","ਙ","ਚ","ਛ","ਜ","ਝ","ਞ","ਟ","ਠ"],
    ["ਡ","ਢ","ਣ","ਤ","ਥ","ਦ","ਧ","ਨ","ਪ","ਫ","ਬ","ਭ"],
    ["ਮ","ਯ","ਰ","ਲ","ਵ","ਸ਼","ਸ","ਹ","ਾ","ਿ","ੁ","੍"],
  ],
  ar: [
    ["ض","ص","ث","ق","ف","غ","ع","ه","خ","ح","ج","د"],
    ["ش","س","ي","ب","ل","ا","ت","ن","م","ك","ط","ذ"],
    ["ئ","ء","ؤ","ر","ى","ة","و","ز","ظ","ً","ٌ","ٍ"],
  ],
  ja: [
    ["あ","い","う","え","お","か","き","く","け","こ","さ","し"],
    ["す","せ","そ","た","ち","つ","て","と","な","に","ぬ","ね"],
    ["の","は","ひ","ふ","へ","ほ","ま","み","む","め","も","や"],
    ["ゆ","よ","ら","り","る","れ","ろ","わ","を","ん","ー","。"],
  ],
  ko: [
    ["ㄱ","ㄴ","ㄷ","ㄹ","ㅁ","ㅂ","ㅅ","ㅇ","ㅈ","ㅊ","ㅋ","ㅌ"],
    ["ㅍ","ㅎ","ㅏ","ㅑ","ㅓ","ㅕ","ㅗ","ㅛ","ㅜ","ㅠ","ㅡ","ㅣ"],
  ],
  zh: [
    ["的","一","是","不","了","人","我","在","有","他","这","中"],
    ["大","来","上","国","个","到","说","们","为","子","和","你"],
    ["地","出","会","时","要","也","就","对","以","生","能","而"],
  ],
  ru: [
    ["й","ц","у","к","е","н","г","ш","щ","з","х","ъ"],
    ["ф","ы","в","а","п","р","о","л","д","ж","э","ё"],
    ["я","ч","с","м","и","т","ь","б","ю",".",",","?"],
  ],
  ur: [
    ["ا","ب","پ","ت","ٹ","ث","ج","چ","ح","خ","د","ڈ"],
    ["ذ","ر","ڑ","ز","ژ","س","ش","ص","ض","ط","ظ","ع"],
    ["غ","ف","ق","ک","گ","ل","م","ن","و","ہ","ی","ے"],
  ],
};

const PUBLIC_MAX_CHARS = Number(process.env.NEXT_PUBLIC_PUBLIC_MAX_TEXT_CHARS || "100");
const PUBLIC_MAX_WORDS = 10;  // unauthenticated users only

const TTS_STAGES = [
  { label: "Synthesizing with IndicF5...", percent: 55 },
  { label: "Finalizing audio...", percent: 90 },
];

const TRANSLATE_STAGE = { label: "Translating text...", percent: 8 };

export default function TextToSpeech() {
  const { defaultVoiceId } = useVoice();
  const { voices } = useVoices();
  const { canUseFeature, openModal: openStorageModal } = useStorage();
  const storageAccess = canUseFeature("tts");
  const [text, setText] = useState("");
  // "" = default IndicF5 reference voice; otherwise a cloned voice from the Voice Library.
  const [voiceId, setVoiceId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioName, setAudioName] = useState("Generated Speech");
  const [step, setStep] = useState("");
  const [elapsed, setElapsed] = useState(0);          // seconds since generation started
  const [inputLang, setInputLang] = useState("en");
  const [outputLang, setOutputLang] = useState("en");
  const [engine, setEngine] = useState<TranslateEngine>("qwen");
  // TTS model is DERIVED from the output language — F5 for English/Chinese,
  // IndicF5 for Indian languages. No manual toggle: you can't pick an engine for
  // a language it can't speak.
  const ttsEngine = engineForLang(outputLang);
  const [availableLangs, setAvailableLangs] = useState<string[]>(Object.keys(LANGUAGES));
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const [langPickerTarget, setLangPickerTarget] = useState<"input" | "output">("output");
  const [showKeyboard, setShowKeyboard] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fakeProgressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const proc = useProcessing();
  const { isAuthenticated, refreshUsage } = useAuth();
  const charLimit = isAuthenticated ? Infinity : PUBLIC_MAX_CHARS;
  // Apply the user's default cloned voice once, without fighting later manual picks.
  const defaultAppliedRef = useRef(false);

  // Clean up timers whenever generation finishes
  const clearTimers = () => {
    if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }
    if (fakeProgressRef.current) { clearInterval(fakeProgressRef.current); fakeProgressRef.current = null; }
  };

  const startTimers = () => {
    setElapsed(0);
    clearTimers();
    // Elapsed clock — ticks every second
    elapsedTimerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    // Fake progress — advances from 15% toward 90% using eased increments so the
    // user sees continuous movement during IndicF5 inference.
    let fakePct = 15;
    fakeProgressRef.current = setInterval(() => {
      // Logarithmic slow-down: fast at start, slows as it approaches 90%
      const remaining = 90 - fakePct;
      const increment = Math.max(0.3, remaining * 0.025);
      fakePct = Math.min(90, fakePct + increment);
      proc.setPercent(fakePct);
    }, 800);
  };

  useEffect(() => {
    if (!isAuthenticated) { setVoiceId(""); defaultAppliedRef.current = false; }
    getLanguages()
      .then((langs) => { if (langs.length > 0) setAvailableLangs(langs.filter((l) => l in LANGUAGES)); })
      .catch(() => { setAvailableLangs(Object.keys(LANGUAGES)); });
    return () => clearTimers();
  }, [isAuthenticated]);


  // Pre-select the user's default cloned voice once it is available (authed only).
  useEffect(() => {
    if (!isAuthenticated || defaultAppliedRef.current) return;
    if (defaultVoiceId && voices.some((v) => v.voice_id === defaultVoiceId)) {
      setVoiceId(defaultVoiceId);
      defaultAppliedRef.current = true;
    }
  }, [isAuthenticated, defaultVoiceId, voices]);

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  // Authenticated users: no word limit. Public users: capped at PUBLIC_MAX_WORDS.
  const maxWords = isAuthenticated ? Infinity : PUBLIC_MAX_WORDS;
  const overWordLimit = wordCount > maxWords;
  const overCharLimit = !isAuthenticated && text.length > charLimit;
  const overLimit = overWordLimit || overCharLimit;

  // Human-readable label for the currently selected voice.
  const selectedVoiceName =
    voices.find((v) => v.voice_id === voiceId)?.name || "Default IndicF5 voice";

  // ── Computed option arrays for LanguageSelect ────────────────────────────
  // Only offer languages a TTS engine can actually speak (English/Chinese via F5,
  // the 11 Indian languages via IndicF5). Everything else is hidden — the engine
  // is then chosen automatically from whichever supported language is picked.
  const engineLangOptions: LangOption[] = availableLangs
    .filter((l) => LANGUAGES[l] && SUPPORTED_TTS_LANGS.includes(l))
    .map((l) => ({
      value: l,
      label: LANGUAGES[l].name,
      flag: LANGUAGES[l].flag,
      group: LANGUAGES[l].group,
    }));
  const inputLangOptions = engineLangOptions;
  const outputLangOptions = engineLangOptions;

  const handleGenerate = async () => {
    if (!text.trim() || overLimit) return;
    setGenerating(true);
    setAudioUrl(null);
    setTranslatedText(null);

    const needsTranslation = inputLang !== outputLang;
    const stages = needsTranslation
      ? [TRANSLATE_STAGE, ...TTS_STAGES]
      : TTS_STAGES;
    proc.startProcessing(stages);
    startTimers();

    try {
      // ── Translate input → output language (Qwen) before synthesis ──────
      // IndicF5 renders whatever script it is handed, so we translate first
      // and then synthesize the target-language text directly.
      let speakText = text;
      if (needsTranslation) {
        setStep("Translating...");
        setIsTranslating(true);
        proc.addLog(`Translating ${LANGUAGES[inputLang]?.name || inputLang} → ${LANGUAGES[outputLang]?.name || outputLang}...`);
        try {
          const TRANSLATION_TIMEOUT = 20_000; // 20s max
          const translationTimeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Translation timeout")), TRANSLATION_TIMEOUT)
          );
          const res = await Promise.race([translate(text, inputLang, outputLang, engine), translationTimeout]);
          speakText = res.translated_text;
          setTranslatedText(speakText);
          proc.nextStage(`Translated → "${speakText.slice(0, 60)}${speakText.length > 60 ? "…" : ""}"`);
        } catch {
          // Translation timed out or failed — proceed with original text
          proc.addLog(`Translation unavailable — synthesizing original text`);
          proc.nextStage("Synthesizing original text...");
        } finally {
          setIsTranslating(false);
        }
      }

      // ── Synthesize with IndicF5 (zero-shot; default reference or a cloned voice) ──
      setStep("Synthesizing with IndicF5...");
      proc.addLog(voiceId ? `Cloning "${selectedVoiceName}"...` : "Using default IndicF5 reference voice...");
      const { blob: wavBlob, audioUrl } = await synthesizeSpeech({
        text: speakText,
        engine: ttsEngine,
        ...(voiceId ? { voiceId } : {}),
      });

      proc.nextStage("Audio ready");
      // Use a data URL instead of a blob URL — data URLs are fully loaded into
      // memory so the browser never issues HTTP Range requests, eliminating
      // ERR_REQUEST_RANGE_NOT_SATISFIABLE on the audio element.
      // FileReader handles large WAV files correctly (btoa on large ArrayBuffers
      // causes memory spikes and can produce invalid base64 on some browsers).
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to encode audio"));
        reader.readAsDataURL(wavBlob);
      });
      setAudioUrl(url);
      const displayName = inputLang !== outputLang && translatedText
        ? `${LANGUAGES[inputLang]?.flag}→${LANGUAGES[outputLang]?.flag} ${speakText.slice(0, 35)}${speakText.length > 35 ? "…" : ""}`
        : `${LANGUAGES[outputLang]?.flag} ${text.trim().slice(0, 40)}${text.trim().length > 40 ? "…" : ""}`;
      setAudioName(displayName);
      setStep("");

      clearTimers();
      proc.complete("Speech generated successfully");
      if (isAuthenticated) {
        // Record the operation for Voice Analytics + text-usage metering.
        // Inference ran on the pod, so the authenticated client reports it.
        void recordUsage({
          feature: "text_to_speech",
          featureLabel: "Text to Speech",
          type: "audio",
          inputSummary: text.trim(),
          outputSummary: speakText !== text ? speakText : "",
          textChars: speakText.length,
          audioUrl,
        }).then(() => refreshUsage());
      }
    } catch (err) {
      clearTimers();
      proc.cancel();
      const quota = (err as { quota?: unknown })?.quota;
      if (quota) {
        notify.quotaExceeded(quota as Parameters<typeof notify.quotaExceeded>[0]);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes("fetch") || msg.toLowerCase().includes("synth")) {
          notify.serviceOffline("IndicF5 TTS");
        } else {
          notify.error("Text-to-speech failed", msg);
        }
      }
      setStep("");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="vm-card">
      {/* Storage unavailable banner */}
      {!storageAccess.allowed && (
        <div className="vm-storage-gate-banner">
          <span>Storage not configured.</span>
          <button className="vm-storage-gate-link" onClick={openStorageModal}>
            Configure storage
          </button>
        </div>
      )}
      <div className={!storageAccess.allowed ? "vm-card-gated" : undefined}>
      <div className="vm-card-header">
        <div className="vm-card-icon">
          <Volume2 size={18} strokeWidth={2} />
        </div>
        <div>
          <div className="vm-card-title">Text to Speech</div>
          <div className="vm-card-subtitle">Voice synthesis · IndicF5</div>
        </div>
        <UsageIndicator resource="both" />
      </div>

      {/* Language selectors — Input + Output */}
      {/* TTS model — auto-selected from the output language (read-only) */}
      <div style={{ marginBottom: 8 }}>
        <div className="vm-label" style={{ marginBottom: 4 }}>Voice model</div>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 10px",
          borderRadius: 8, border: "1px solid var(--border-subtle)",
          background: "var(--surface-subtle)", fontSize: 12,
        }}>
          <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
            {ttsEngine === "indicf5" ? "IndicF5" : "F5-TTS"}
          </span>
          <span style={{ color: "var(--text-muted)" }}>
            {ttsEngine === "indicf5" ? "Indian languages" : "English / Chinese"} — auto-selected from output language
          </span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-end" }}>
        {/* Input language — click to open picker modal */}
        <div style={{ flex: 1 }}>
          <div className="vm-label" style={{ marginBottom: 4 }}>Input language</div>
          <button
            type="button"
            disabled={generating || isTranslating}
            onClick={() => { setLangPickerTarget("input"); setLangPickerOpen(true); }}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 8,
              padding: "7px 10px", borderRadius: 8,
              border: "1px solid var(--border-subtle)",
              background: "var(--surface-subtle)",
              color: "var(--text-primary)", fontSize: 12,
              cursor: (generating || isTranslating) ? "not-allowed" : "pointer",
              opacity: (generating || isTranslating) ? 0.5 : 1, textAlign: "left", outline: "none",
            }}
          >
            <span style={{ fontSize: 16 }}>{LANGUAGES[inputLang]?.flag ?? "🌐"}</span>
            <span style={{ flex: 1 }}>{LANGUAGES[inputLang]?.name ?? inputLang}</span>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>▾</span>
          </button>
        </div>

        {/* Arrow */}
        <div style={{ paddingBottom: 10, color: "var(--bamboo-400)", fontSize: 16, flexShrink: 0 }}>→</div>

        {/* Output language — click to open picker modal */}
        <div style={{ flex: 1 }}>
          <div className="vm-label" style={{ marginBottom: 4 }}>Output language</div>
          <button
            type="button"
            disabled={generating}
            onClick={() => { setLangPickerTarget("output"); setLangPickerOpen(true); }}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 8,
              padding: "7px 10px", borderRadius: 8,
              border: "1px solid var(--border-subtle)",
              background: "var(--surface-subtle)",
              color: "var(--text-primary)", fontSize: 12,
              cursor: generating ? "not-allowed" : "pointer",
              opacity: generating ? 0.5 : 1, textAlign: "left", outline: "none",
            }}
          >
            <span style={{ fontSize: 16 }}>{LANGUAGES[outputLang]?.flag ?? "🌐"}</span>
            <span style={{ flex: 1 }}>{LANGUAGES[outputLang]?.name ?? outputLang}</span>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>▾</span>
          </button>
        </div>
      </div>

      {/* Translation engine — used only when input and output languages differ */}
      {inputLang !== outputLang && (
        <div style={{ marginBottom: 8 }}>
          <EngineToggle value={engine} onChange={setEngine} disabled={generating || isTranslating} label="Translation engine" />
        </div>
      )}

      {/* Text Input */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div className="vm-label" style={{ margin: 0 }}>
            {isAuthenticated ? "Text" : `Text (max ${PUBLIC_MAX_WORDS} words)`}
          </div>
          {isTranslating && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--teal-400, #2dd4bf)" }}>
              <svg width="14" height="14" viewBox="0 0 14 14" style={{ animation: "spin 1s linear infinite" }}>
                <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="22 12" strokeLinecap="round" />
              </svg>
              Translating...
            </span>
          )}
        </div>
        <div style={{ position: "relative" }}>
          <textarea
            ref={textareaRef}
            className="vm-textarea"
            placeholder={`Type in ${LANGUAGES[inputLang]?.name || inputLang}...`}
            value={text}
            onChange={(e) => { setText(e.target.value); setTranslatedText(null); }}
            rows={3}
            disabled={generating || isTranslating}
            style={isTranslating ? { opacity: 0.5, pointerEvents: "none" } : undefined}
          />
          {isTranslating && (
            <div style={{
              position: "absolute", inset: 0, borderRadius: 8,
              background: "rgba(0,0,0,0.08)",
              display: "flex", alignItems: "center", justifyContent: "center",
              pointerEvents: "none",
            }} />
          )}
        </div>
        {/* Virtual keyboard toggle */}
        {KB_LAYOUTS[inputLang] && (
          <button
            type="button"
            onClick={() => setShowKeyboard((v) => !v)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              margin: "6px 0 0", padding: "4px 10px", fontSize: 11,
              background: showKeyboard ? "var(--bamboo-800)" : "transparent",
              border: `1px solid ${showKeyboard ? "var(--bamboo-600)" : "var(--border)"}`,
              borderRadius: 6, color: showKeyboard ? "var(--bamboo-300)" : "var(--gray-400)",
              cursor: "pointer", transition: "all 0.15s",
            }}
          >
            <Keyboard size={12} /> {LANGUAGES[inputLang]?.name} keyboard
          </button>
        )}
        {/* Virtual keyboard panel */}
        {showKeyboard && KB_LAYOUTS[inputLang] && (
          <div style={{
            marginTop: 6, padding: 8, borderRadius: 8,
            border: "1px solid var(--border)", background: "rgba(0,0,0,0.3)",
            display: "flex", flexDirection: "column", gap: 4,
          }}>
            {KB_LAYOUTS[inputLang].map((row, ri) => (
              <div key={ri} style={{ display: "flex", gap: 3, flexWrap: "wrap", justifyContent: "center" }}>
                {row.map((ch, ci) => (
                  <button
                    key={ci}
                    type="button"
                    onClick={() => {
                      setText((prev) => prev + ch);
                      setTranslatedText(null);
                      textareaRef.current?.focus();
                    }}
                    style={{
                      minWidth: 28, height: 32, padding: "0 4px",
                      fontSize: 14, fontWeight: 500,
                      background: "var(--gray-700)", border: "1px solid var(--border)",
                      borderRadius: 5, color: "var(--white)", cursor: "pointer",
                      transition: "all 0.1s", display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                  >{ch}</button>
                ))}
              </div>
            ))}
            {/* Space + Backspace row */}
            <div style={{ display: "flex", gap: 3, justifyContent: "center", marginTop: 2 }}>
              <button
                type="button"
                onClick={() => { setText((p) => p + " "); textareaRef.current?.focus(); }}
                onMouseDown={(e) => e.preventDefault()}
                style={{
                  flex: "0 0 45%", height: 32, fontSize: 11, fontWeight: 500,
                  background: "var(--gray-700)", border: "1px solid var(--border)",
                  borderRadius: 5, color: "var(--gray-400)", cursor: "pointer",
                }}
              >Space</button>
              <button
                type="button"
                onClick={() => { setText((p) => p.slice(0, -1)); setTranslatedText(null); textareaRef.current?.focus(); }}
                onMouseDown={(e) => e.preventDefault()}
                style={{
                  flex: "0 0 25%", height: 32, fontSize: 11, fontWeight: 500,
                  background: "var(--gray-700)", border: "1px solid var(--border)",
                  borderRadius: 5, color: "var(--gray-400)", cursor: "pointer",
                }}
              >Backspace</button>
            </div>
          </div>
        )}
        <div className={`vm-word-count ${overLimit ? "over-limit" : ""}`}>
          {isAuthenticated
            ? `${wordCount} words`
            : `${wordCount}/${PUBLIC_MAX_WORDS} words`}
          {!isAuthenticated && (
            <span style={{ marginLeft: 8 }}>
              · {text.length}/{PUBLIC_MAX_CHARS} chars
            </span>
          )}
          {inputLang !== outputLang && (
            <span style={{ marginLeft: 8, color: "var(--bamboo-400)" }}>
              {LANGUAGES[inputLang]?.flag} {LANGUAGES[inputLang]?.name} → {LANGUAGES[outputLang]?.flag} {LANGUAGES[outputLang]?.name}
            </span>
          )}
        </div>
        {/* Show translated preview */}
        {translatedText && inputLang !== outputLang && (
          <div className="vm-fade-in" style={{ marginTop: 6, padding: "6px 10px", background: "rgba(109,159,55,0.08)", borderRadius: 6, fontSize: 12, color: "var(--text-secondary)" }}>
            <span style={{ color: "var(--bamboo-400)", fontWeight: 600 }}>{LANGUAGES[outputLang]?.flag} Translated: </span>
            {translatedText}
          </div>
        )}
      </div>

      {/* Voice selector — default IndicF5 reference or a cloned voice from the Library */}
      <div style={{ marginTop: 12 }}>
        <div className="vm-label" style={{ marginBottom: 4 }}>Voice</div>
        <select
          className="vm-select"
          value={voiceId}
          onChange={(e) => setVoiceId(e.target.value)}
          disabled={generating}
        >
          <option value="">Default IndicF5 voice</option>
          {/* Cloned voices are account-scoped — only offered to signed-in users. */}
          {isAuthenticated && voices.map((v) => (
            <option key={v.voice_id} value={v.voice_id}>
              {v.name || v.voice_id}
              {v.language ? ` · ${LANGUAGES[v.language]?.flag ?? ""} ${LANGUAGES[v.language]?.name ?? v.language}` : ""}
            </option>
          ))}
        </select>
        <div style={{ fontSize: 10, color: "var(--bamboo-500)", marginTop: 4, paddingLeft: 4 }}>
          {!isAuthenticated
            ? "Sign in to clone and use your own voice."
            : voiceId
              ? "Zero-shot clone of your Voice Library reference — no training needed."
              : voices.length === 0
                ? "Add a reference in the Voice Library to clone your own voice."
                : "Using the built-in IndicF5 reference. Pick a Library voice to clone your own."}
        </div>
      </div>

      {/* Generate Button */}
      <button
        className="vm-btn vm-btn-primary"
        style={{ width: "100%", marginTop: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
        onClick={handleGenerate}
        disabled={generating || !text.trim() || overLimit}
      >
        {generating ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div className="vm-step-indicator" style={{ justifyContent: "center" }}>
              <div className="vm-spinner" />
              <span>{step || "Generating…"}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, opacity: 0.65, letterSpacing: "0.02em" }}>
              <span>{elapsed}s elapsed</span>
              <span>·</span>
              <span>IndicF5 — ~2–15s (cached instant)</span>
            </div>
          </div>
        ) : (
          <>
            <Play size={14} strokeWidth={2.5} />
            <span>Generate Speech</span>
          </>
        )}
      </button>

      {/* Soap Bubble Audio Player — full width */}
      {audioUrl && (
        <div className="vm-fade-in" style={{ marginTop: 12, width: "100%" }}>
          <SoapBubblePlayer key={audioUrl} audioUrl={audioUrl} name={audioName} autoPlay />
        </div>
      )}

      {/* Info */}
      <div className="vm-info">
        <strong>IndicF5</strong> zero-shot cloning — English + Indian languages (~2–15s;
        cached responses are instant). Pick a voice from your Voice Library, or use the
        built-in default reference.
      </div>

      {/* Language Picker Modal */}
      <LanguagePickerModal
        isOpen={langPickerOpen}
        onClose={() => setLangPickerOpen(false)}
        value={langPickerTarget === "input" ? inputLang : outputLang}
        options={langPickerTarget === "input" ? inputLangOptions : outputLangOptions}
        title={langPickerTarget === "input" ? "Select Input Language" : "Select Output Language"}
        onSelect={(lang, sampleText) => {
          setLangPickerOpen(false);
          setTranslatedText(null);
          if (langPickerTarget === "input") {
            const prevLang = inputLang;
            setInputLang(lang);
            if (text.trim() && prevLang !== lang) {
              setIsTranslating(true);
              translate(text, prevLang, lang, engine)
                .then((res) => setText(res.translated_text))
                .catch(() => {})
                .finally(() => setIsTranslating(false));
            } else if (!text.trim()) {
              setText(sampleText);
            }
          } else {
            setOutputLang(lang);
          }
        }}
      />
    </div>
    </div>
  );
}
