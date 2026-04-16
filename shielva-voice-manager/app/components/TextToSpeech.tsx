"use client";

import { useState, useEffect, useRef } from "react";
import { Volume2, Play } from "lucide-react";
import { notify } from "../lib/toast";
import { phonemize, synthesize, synthesizeStream, synthesizeWithProgress, synthesizeStreamSentences, openTtsWebSocket, vocode, translate, getLanguages, getEngineCapabilities, type VoiceInfo, type WsTtsCallbacks, type EngineCapabilities } from "../lib/amt-api";
import { Mic2, AudioWaveform, Keyboard } from "lucide-react";
import { type LangOption } from "./LanguageSelect";
import LanguagePickerModal from "./LanguagePickerModal";
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

const INDIAN_LANG_CODES = new Set(
  Object.entries(LANGUAGES).filter(([, v]) => v.group === "indian").map(([k]) => k)
);

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
  { label: "Phonemizing text...", percent: 15 },
  { label: "Synthesizing mel spectrogram...", percent: 45 },
  { label: "Vocoding with HiFi-GAN...", percent: 75 },
  { label: "Generating audio...", percent: 95 },
];

const TRANSLATE_STAGE = { label: "Translating text...", percent: 8 };

export default function TextToSpeech() {
  const { state: { refreshSeq: refreshKey } } = useVoice();
  const { voices, trainedVoices } = useVoices();
  const { canUseFeature, openModal: openStorageModal } = useStorage();
  const storageAccess = canUseFeature("tts");
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioName, setAudioName] = useState("Generated Speech");
  const [streamedPlayback, setStreamedPlayback] = useState(false); // true when audio already played via streaming
  const [step, setStep] = useState("");
  const [elapsed, setElapsed] = useState(0);          // seconds since generation started
  const [inputLang, setInputLang] = useState("en");
  const [outputLang, setOutputLang] = useState("en");
  const [availableLangs, setAvailableLangs] = useState<string[]>(Object.keys(LANGUAGES));
  // "basic"  = Edge TTS (fast, no cloning, no voice selection)
  // "cloned" = Uses a voice from Voice Library — user picks engine
  const [voiceMode, setVoiceMode] = useState<"basic" | "cloned">("basic");
  const [ttsEngine, setTtsEngine] = useState<"edge_tts" | "vits" | "indicf5">("vits");
  const [gender, setGender] = useState<"male" | "female">("female");
  const [vitsAccent, setVitsAccent] = useState<string>("GB");
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [langPickerOpen, setLangPickerOpen] = useState(false);
  const [langPickerTarget, setLangPickerTarget] = useState<"input" | "output">("output");
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [engines, setEngines] = useState<EngineCapabilities>({
    gpu_assist: false,
    engines: { xtts: false, vits: false, indicf5: false, edge_tts: true },
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fakeProgressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const proc = useProcessing();
  const { isAuthenticated, refreshUsage } = useAuth();
  const charLimit = isAuthenticated ? Infinity : PUBLIC_MAX_CHARS;

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
    // Fake progress — advances from 15% toward 90% over ~75s using eased increments
    // so the user sees continuous movement during the Chatterbox inference.
    let fakePct = 15;
    fakeProgressRef.current = setInterval(() => {
      // Logarithmic slow-down: fast at start, slows as it approaches 90%
      const remaining = 90 - fakePct;
      const increment = Math.max(0.3, remaining * 0.025);
      fakePct = Math.min(90, fakePct + increment);
      proc.setPercent(fakePct);
    }, 800);
  };

  // Fetch engine capabilities (gpu_assist, xtts, indicf5)
  useEffect(() => {
    getEngineCapabilities().then(setEngines).catch(() => {});
  }, []);

  // Derived engine availability
  const xttsAvailable = engines.engines.xtts;
  const vitsAvailable = engines.engines.vits;
  const indicf5Available = engines.engines.indicf5;

  // Auto-select first voice when list loads
  useEffect(() => {
    if (voices.length > 0) setVoiceId((prev) => prev || voices[0].voice_id);
  }, [voices]);

  // If cloned mode is active but there are no trained voices, fall back to basic
  useEffect(() => {
    if (voiceMode === "cloned" && trainedVoices.length === 0) setVoiceMode("basic");
  }, [trainedVoices, voiceMode]);

  useEffect(() => {
    if (!isAuthenticated) { setVoiceId(""); setVoiceMode("basic"); }
    getLanguages()
      .then((langs) => { if (langs.length > 0) setAvailableLangs(langs.filter((l) => l in LANGUAGES)); })
      .catch(() => { setAvailableLangs(Object.keys(LANGUAGES)); });
    return () => clearTimers();
  }, [refreshKey, isAuthenticated]);

  // Engine auto-switch on language change
  useEffect(() => {
    const indian = INDIAN_LANG_CODES.has(outputLang);
    // VITS is English-only — switch to edge_tts for Indian languages
    if (indian && ttsEngine === "vits") setTtsEngine("edge_tts");
    // IndicF5 is Indian-only — switch back to vits for non-Indian
    if (!indian && ttsEngine === "indicf5") setTtsEngine("vits");
  }, [outputLang]);

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  // Authenticated users: no word limit. Public users: capped at PUBLIC_MAX_WORDS.
  const maxWords = isAuthenticated ? Infinity : PUBLIC_MAX_WORDS;
  const overWordLimit = wordCount > maxWords;
  const overCharLimit = !isAuthenticated && text.length > charLimit;
  const overLimit = overWordLimit || overCharLimit;

  // Compute the effective backend voice_mode and voice ID based on the 3 frontend modes
  const isIndian = INDIAN_LANG_CODES.has(outputLang);
  const effectiveBackendMode: "natural" | "cloned" =
    voiceMode === "basic" ? "natural" : "cloned";
  // Send voiceId for all non-basic modes (IndicF5 uses it for zero-shot cloning)
  const effectiveVoiceId = voiceMode === "basic" ? "" : voiceId;
  // tts_engine sent to backend: pass chosen engine for cloned mode, "auto" for basic
  const effectiveTtsEngine = voiceMode === "basic" ? "auto" : ttsEngine;
  // voiceName for RVC model lookup — needed so RVC worker can find the model in R2 by slug
  const effectiveVoiceName = voices.find((v) => v.voice_id === voiceId)?.name || "";

  // Engine label for the language dropdown based on current mode + chosen engine
  const engineLabel = (lang: string): string => {
    if (voiceMode === "basic") return "Edge TTS";
    if (ttsEngine === "indicf5") return indicf5Available ? "IndicF5" : "Edge TTS";
    if (ttsEngine === "vits") return vitsAvailable ? "VITS+RVC" : "Edge TTS+RVC";
    return "Edge TTS+RVC";
  };

  // ── Computed option arrays for LanguageSelect ────────────────────────────
  const inputLangOptions: LangOption[] = availableLangs
    .filter((l) => LANGUAGES[l])
    .map((l) => ({
      value: l,
      label: LANGUAGES[l].name,
      flag: LANGUAGES[l].flag,
      group: LANGUAGES[l].group,
    }));

  const outputLangOptions: LangOption[] = availableLangs
    .filter((l) => LANGUAGES[l])
    .map((l) => ({
      value: l,
      label: LANGUAGES[l].name,
      flag: LANGUAGES[l].flag,
      group: LANGUAGES[l].group,
      sublabel: engineLabel(l),
    }));

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
    setStreamedPlayback(false);

    try {
      // ── Translate if input and output languages differ ─────────────
      let speakText = text;
      if (needsTranslation) {
        setStep("Translating...");
        setIsTranslating(true);
        proc.addLog(`Translating ${LANGUAGES[inputLang]?.name || inputLang} → ${LANGUAGES[outputLang]?.name || outputLang}...`);
        try {
          const TRANSLATION_TIMEOUT = 20_000; // 20s max — NLLB can be slow on CPU
          const translationTimeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Translation timeout")), TRANSLATION_TIMEOUT)
          );
          const res = await Promise.race([translate(text, inputLang, outputLang), translationTimeout]);
          speakText = res.translated_text;
          setTranslatedText(speakText);
          proc.nextStage(`Translated → "${speakText.slice(0, 60)}${speakText.length > 60 ? "…" : ""}"`);
        } catch (transErr) {
          // Translation timed out or failed — proceed with original text
          proc.addLog(`Translation unavailable — synthesizing original text`);
          proc.nextStage("Synthesizing original text...");
        } finally {
          setIsTranslating(false);
        }
      }

      // ── PRIMARY: WebSocket binary streaming (lowest latency) ──────────
      let wavBlob: Blob;
      let usedWebSocket = false;
      try {
        setStep("Synthesizing...");
        proc.addLog("Connecting via WebSocket (binary streaming)...");
        proc.nextStage("Streaming speech sentence-by-sentence...");

        const audioQueue: Blob[] = [];
        let isPlaying = false;
        let currentIndex = 0;
        let totalSentences = 0;
        let streamComplete = false;
        let streamError: string | null = null;
        let resolveStream: () => void;
        let rejectStream: (err: Error) => void;

        const streamPromise = new Promise<void>((resolve, reject) => {
          resolveStream = resolve;
          rejectStream = reject;
        });

        const playNext = () => {
          if (currentIndex >= audioQueue.length || !isPlaying) return;
          const blob = audioQueue[currentIndex];
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          setStep(`Sentence ${currentIndex + 1}/${totalSentences || "?"} playing...`);
          proc.addLog(`Playing sentence ${currentIndex + 1}...`);
          audio.onended = () => {
            URL.revokeObjectURL(url);
            currentIndex++;
            if (currentIndex < audioQueue.length) {
              playNext();
            } else if (streamComplete) {
              isPlaying = false;
            }
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            currentIndex++;
            if (currentIndex < audioQueue.length) playNext();
          };
          audio.play().catch(() => {
            URL.revokeObjectURL(url);
            currentIndex++;
            if (currentIndex < audioQueue.length) playNext();
          });
        };

        // Open WebSocket, send synthesis request, collect binary frames
        const ttsWs = openTtsWebSocket(
          { voiceId: effectiveVoiceId || "default", lang: outputLang, voiceMode: effectiveBackendMode, ttsEngine: effectiveTtsEngine, gender, accent: ttsEngine === "vits" ? vitsAccent : "" },
          {
            onReady: () => {
              // Connection established — send synthesis request
              ttsWs.synthesize(speakText, `gen-${Date.now()}`);
            },
            onSentenceStart: (index, total, sentenceText) => {
              totalSentences = total;
              setStep(`Sentence ${index + 1}/${total}: synthesizing...`);
              proc.addLog(`Sentence ${index + 1}/${total}: "${sentenceText.slice(0, 50)}${sentenceText.length > 50 ? "…" : ""}"`);
              const pct = Math.min(90, 10 + ((index + 1) / total) * 80);
              proc.setPercent(pct);
            },
            onSentenceAudio: (index, audioBlob) => {
              audioQueue.push(audioBlob);
              if (index === 0) {
                isPlaying = true;
                playNext();
              }
            },
            onComplete: (total) => {
              streamComplete = true;
              totalSentences = total;
              ttsWs.close();
              resolveStream();
            },
            onError: (errorMsg) => {
              streamError = errorMsg;
              ttsWs.close();
              rejectStream(new Error(errorMsg));
            },
          },
        );

        // Wait for completion with a timeout
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("WebSocket TTS timeout")), 120_000),
        );
        await Promise.race([streamPromise, timeout]).catch((err) => {
          ttsWs.close();
          throw err;
        });

        wavBlob = new Blob(audioQueue, { type: audioQueue[0]?.type || "audio/wav" });
        usedWebSocket = true;
        setStreamedPlayback(true); // audio already played sentence-by-sentence
        proc.nextStage("Audio ready");

      } catch (wsErr) {
        // ── FALLBACK 1: SSE sentence-level streaming ───────────────────
        usedWebSocket = false;
        try {
          setStep("Synthesizing (SSE fallback)...");
          proc.addLog("WebSocket unavailable, falling back to SSE streaming...");
          proc.nextStage("Streaming speech sentence-by-sentence (SSE)...");

          const audioQueue: Blob[] = [];
          let isPlaying = false;
          let currentIndex = 0;
          let totalSentences = 0;
          let streamComplete = false;
          let resolveStream: () => void;
          let rejectStream: (err: Error) => void;
          const streamPromise = new Promise<void>((resolve, reject) => {
            resolveStream = resolve;
            rejectStream = reject;
          });

          const playNext = () => {
            if (currentIndex >= audioQueue.length || !isPlaying) return;
            const blob = audioQueue[currentIndex];
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            setStep(`Sentence ${currentIndex + 1}/${totalSentences || "?"} playing...`);
            audio.onended = () => {
              URL.revokeObjectURL(url);
              currentIndex++;
              if (currentIndex < audioQueue.length) playNext();
              else if (streamComplete) isPlaying = false;
            };
            audio.onerror = () => { URL.revokeObjectURL(url); currentIndex++; if (currentIndex < audioQueue.length) playNext(); };
            audio.play().catch(() => { URL.revokeObjectURL(url); currentIndex++; if (currentIndex < audioQueue.length) playNext(); });
          };

          await synthesizeStreamSentences(
            speakText,
            effectiveVoiceId || "default",
            (index, total, sentenceText) => {
              totalSentences = total;
              setStep(`Sentence ${index + 1}/${total}: synthesizing...`);
              proc.addLog(`Sentence ${index + 1}/${total}: "${sentenceText.slice(0, 50)}..."`);
              proc.setPercent(Math.min(90, 10 + ((index + 1) / total) * 80));
            },
            (index, audioBlob) => {
              audioQueue.push(audioBlob);
              if (index === 0) { isPlaying = true; playNext(); }
            },
            (total) => { streamComplete = true; totalSentences = total; resolveStream(); },
            (errorMsg) => { rejectStream(new Error(errorMsg)); },
            outputLang,
            "",
            effectiveBackendMode,
            effectiveTtsEngine,
            effectiveVoiceName,
            gender,
          );
          if (!streamComplete) { streamComplete = true; }
          await streamPromise;
          wavBlob = new Blob(audioQueue, { type: audioQueue[0]?.type || "audio/mpeg" });
          setStreamedPlayback(true); // audio already played sentence-by-sentence
          proc.nextStage("Audio ready");

        } catch (sseErr) {
          // ── FALLBACK 2: synthesizeWithProgress (single-blob SSE) ────
          try {
            setStep("Synthesizing...");
            proc.addLog("SSE stream unavailable, falling back to neural TTS...");
            proc.nextStage("Generating speech via neural TTS...");
            wavBlob = await synthesizeWithProgress(
              speakText,
              effectiveVoiceId || "default",
              (stage, percent) => {
                setStep(stage);
                proc.setPercent(percent);
                proc.addLog(stage);
              },
              outputLang,
              "",
              effectiveBackendMode,
              effectiveTtsEngine,
              effectiveVoiceName,
              gender,
            );
            proc.nextStage("Audio ready");
          } catch {
            // FALLBACK 3: classic phonemize -> shielva-tts -> vocode pipeline
            setStep("Phonemizing...");
            proc.addLog("Converting text to phonemes...");
            const { phonemes } = await phonemize(speakText);

            setStep("Synthesizing...");
            proc.nextStage("Generating speech via Shielva TTS...");
            const mel = await synthesize(phonemes, effectiveVoiceId || "default", speakText);

            if (mel.type === "wav" && mel.wav_data_b64) {
              proc.nextStage("Direct TTS audio — vocoder bypassed");
              const wavBytes = Uint8Array.from(atob(mel.wav_data_b64), (c) => c.charCodeAt(0));
              wavBlob = new Blob([wavBytes], { type: "audio/wav" });
            } else {
              setStep("Vocoding...");
              proc.nextStage("Converting mel to waveform via HiFi-GAN...");
              wavBlob = await vocode(mel.mel_data_b64!, mel.n_mel!, mel.n_frames!);
            }
          }
        }
      }

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
      if (isAuthenticated) refreshUsage();
    } catch (err: any) {
      clearTimers();
      proc.cancel();
      if (err?.quota) {
        notify.quotaExceeded(err.quota);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes("phonem") || (msg.toLowerCase().includes("fetch") && step === "Phonemizing...")) {
          notify.serviceOffline("Acoustic (Phonemizer)");
        } else if (msg.toLowerCase().includes("synth") || (msg.toLowerCase().includes("fetch") && step === "Synthesizing mel...")) {
          notify.serviceOffline("Shielva TTS");
        } else if (msg.toLowerCase().includes("vocod") || (msg.toLowerCase().includes("fetch") && step === "Vocoding...")) {
          notify.serviceOffline("HiFi-GAN Vocoder");
        } else if (msg.toLowerCase().includes("fetch")) {
          notify.serviceOffline("Text-to-speech");
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
          <div className="vm-card-subtitle">
            {voiceMode === "basic" ? "Basic · Edge TTS" : `Cloned · ${ttsEngine === "indicf5" ? "IndicF5" : ttsEngine === "vits" ? "VITS+RVC" : "Edge TTS+RVC"}`}
          </div>
        </div>
        <UsageIndicator resource="both" />
      </div>

      {/* Language selectors — Input + Output */}
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

      {/* Voice Mode Toggle + Voice Selector */}
      <div style={{ marginTop: 12 }}>
        {/* Basic / Cloned toggle */}
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <button
            className={`tts-mode-btn${voiceMode === "basic" ? " tts-mode-btn--active" : ""}`}
            onClick={() => { setVoiceMode("basic"); setVoiceId(""); }}
            disabled={generating}
            title="Basic: Edge TTS — fast, no voice cloning"
          >
            <AudioWaveform size={12} /> Basic
          </button>
          <button
            className={`tts-mode-btn${voiceMode === "cloned" ? " tts-mode-btn--active tts-mode-btn--cloned" : ""}`}
            onClick={() => setVoiceMode("cloned")}
            disabled={generating || !isAuthenticated || trainedVoices.length === 0}
            title={
              !isAuthenticated ? "Sign in to use Cloned voice mode"
              : trainedVoices.length === 0 ? "No trained voices — train a voice in Voice Library first"
              : "Cloned: Uses your voice from the Voice Library"
            }
          >
            <Mic2 size={12} /> Cloned
          </button>
        </div>


        {/* Engine selector — only in cloned mode */}
        {voiceMode === "cloned" && (
          <div style={{ marginBottom: 10 }}>
            <div className="vm-label" style={{ marginBottom: 4 }}>Engine</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {/* Edge TTS+RVC — works for all languages incl. Indian */}
              <button
                className={`tts-mode-btn${ttsEngine === "edge_tts" ? " tts-mode-btn--active" : ""}`}
                onClick={() => setTtsEngine("edge_tts")}
                disabled={generating}
                title="Edge TTS + RVC — neural voice with voice conversion"
              >
                Edge+RVC
              </button>
              {/* VITS+RVC — English only */}
              {!isIndian && (
                <button
                  className={`tts-mode-btn${ttsEngine === "vits" ? " tts-mode-btn--active" : ""}`}
                  onClick={() => setTtsEngine("vits")}
                  disabled={generating}
                  title="VITS + RVC — fast synthesis with voice conversion (English only)"
                >
                  VITS+RVC
                </button>
              )}
              {/* IndicF5 — Indian languages only, needs GPU for realtime */}
              {isIndian && indicf5Available && (
                <button
                  className={`tts-mode-btn${ttsEngine === "indicf5" ? " tts-mode-btn--active" : ""}`}
                  onClick={() => setTtsEngine("indicf5")}
                  disabled={generating}
                  title="IndicF5 — AI4Bharat zero-shot Indian language cloning (GPU recommended)"
                >
                  IndicF5
                </button>
              )}
            </div>
          </div>
        )}

        {/* Accent selector — VITS+RVC and Edge+RVC in cloned mode, English output only */}
        {voiceMode === "cloned" && !isIndian && (ttsEngine === "vits" || ttsEngine === "edge_tts") && (
          <div style={{ marginBottom: 10 }}>
            <div className="vm-label" style={{ marginBottom: 4 }}>Accent</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {([
                { key: "GB", label: "British" },
                { key: "US", label: "American" },
                { key: "IN", label: "Indian" },
                { key: "AU", label: "Australian" },
                { key: "CA", label: "Canadian" },
                ...(ttsEngine === "vits" ? [
                  { key: "SC", label: "Scottish" },
                  { key: "IE", label: "Irish" },
                ] : []),
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  className={`tts-mode-btn${vitsAccent === key ? " tts-mode-btn--active" : ""}`}
                  onClick={() => setVitsAccent(key)}
                  disabled={generating}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Gender selector — basic mode only (natural Edge TTS, no cloning).
            In cloned mode, RVC replaces voice timbre entirely — gender of base voice
            doesn't affect the output. f0_up_key in the trained model handles pitch. */}
        {voiceMode === "basic" && (
          <div style={{ marginBottom: 10 }}>
            <div className="vm-label" style={{ marginBottom: 4 }}>Voice Gender</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className={`tts-mode-btn${gender === "female" ? " tts-mode-btn--active" : ""}`}
                onClick={() => setGender("female")}
                disabled={generating}
              >Female</button>
              <button
                className={`tts-mode-btn${gender === "male" ? " tts-mode-btn--active" : ""}`}
                onClick={() => setGender("male")}
                disabled={generating}
              >Male</button>
            </div>
          </div>
        )}

        {/* Voice selector — varies by mode */}
        <div className="vm-label" style={{ marginBottom: 4 }}>Voice</div>
        {voiceMode === "basic" ? (
          <div style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--bamboo-800)", fontSize: 13, color: "var(--text-muted)", background: "rgba(0,0,0,0.1)" }}>
            Edge TTS — {LANGUAGES[outputLang]?.name || outputLang} neural voice (&lt;1s)
          </div>
        ) : (
          (() => {
            if (voices.length === 0) {
              return (
                <div style={{ padding: "8px 12px", borderRadius: 8, border: "1px dashed var(--bamboo-800)", fontSize: 12, color: "var(--text-muted)" }}>
                  No voices registered — add a voice in <strong>Voice Library</strong> first.
                </div>
              );
            }
            return (
              <div>
                <select
                  className="vm-select"
                  value={voiceId}
                  onChange={(e) => setVoiceId(e.target.value)}
                  disabled={generating}
                >
                  <option value="">— Select a voice —</option>
                  {voices.map((v) => {
                    const trained = v.training_status === "trained";
                    return (
                      <option key={v.voice_id} value={v.voice_id}>
                        {v.name || v.voice_id}
                        {trained ? " ✓" : ""}
                        {v.language ? ` · ${LANGUAGES[v.language]?.flag ?? ""} ${LANGUAGES[v.language]?.name ?? v.language}` : ""}
                      </option>
                    );
                  })}
                </select>
                {isIndian && ttsEngine === "indicf5" && (
                  <div style={{ fontSize: 10, color: "var(--bamboo-500)", marginTop: 4, paddingLeft: 4 }}>
                    No training needed — zero-shot voice cloning from reference audio
                  </div>
                )}
              </div>
            );
          })()
        )}
      </div>

      <style>{`
        .tts-mode-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 5px 12px;
          border-radius: 20px;
          border: 1px solid var(--bamboo-800);
          background: transparent;
          color: var(--text-muted);
          font-size: 12px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .tts-mode-btn:hover:not(:disabled) { border-color: var(--bamboo-600); color: var(--bamboo-300); }
        .tts-mode-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .tts-mode-btn--active {
          background: var(--bamboo-800);
          border-color: var(--bamboo-600);
          color: var(--bamboo-200);
        }
        .tts-mode-btn--cloned.tts-mode-btn--active {
          background: rgba(109,159,55,0.15);
          border-color: var(--bamboo-500);
          color: var(--bamboo-300);
        }
      `}</style>

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
              <span>
                {voiceMode === "basic"
                  ? (isIndian ? "Edge TTS — <2s" : "Edge TTS — <1s")
                  : isIndian && ttsEngine === "indicf5"
                  ? "IndicF5 zero-shot — ~5–15s (GPU)"
                  : "Edge TTS + RVC — ~2–5s"}
              </span>
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
          <SoapBubblePlayer key={audioUrl} audioUrl={audioUrl} name={audioName} autoPlay={!streamedPlayback} />
        </div>
      )}

      {/* Info */}
      <div className="vm-info">
        <strong>Basic:</strong> Edge TTS (&lt;2s). &nbsp;
        <strong>Cloned:</strong> Your voice from Voice Library — Edge TTS + RVC for international (~2–5s); IndicF5 for Indian (~5–15s).
        Cached responses are instant.
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
              translate(text, prevLang, lang)
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
