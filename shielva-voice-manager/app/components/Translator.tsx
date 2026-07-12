"use client";

import { useState, useEffect, useMemo } from "react";
import { Languages, ArrowRightLeft } from "lucide-react";
import { notify } from "../lib/toast";
import { translate, getLanguages, type TranslateEngine } from "../lib/amt-api";
import { useProcessing } from "../context/ProcessingContext";
import { useAuth } from "../context/AuthContext";
import UsageIndicator from "./UsageIndicator";
import LanguageSelect, { type LangOption } from "./LanguageSelect";
import EngineToggle from "./EngineToggle";

const PUBLIC_MAX_CHARS = Number(process.env.NEXT_PUBLIC_PUBLIC_MAX_TEXT_CHARS || "100");

type LangMeta = { label: string; flag: string; group: "indian" | "international" };

const LANG_META: Record<string, LangMeta> = {
  en: { label: "English",    flag: "🇬🇧", group: "international" },
  hi: { label: "Hindi",      flag: "🇮🇳", group: "indian" },
  ta: { label: "Tamil",      flag: "🇮🇳", group: "indian" },
  te: { label: "Telugu",     flag: "🇮🇳", group: "indian" },
  kn: { label: "Kannada",    flag: "🇮🇳", group: "indian" },
  ml: { label: "Malayalam",  flag: "🇮🇳", group: "indian" },
  mr: { label: "Marathi",    flag: "🇮🇳", group: "indian" },
  bn: { label: "Bengali",    flag: "🇮🇳", group: "indian" },
  gu: { label: "Gujarati",   flag: "🇮🇳", group: "indian" },
  pa: { label: "Punjabi",    flag: "🇮🇳", group: "indian" },
  ur: { label: "Urdu",       flag: "🇵🇰", group: "indian" },
  or: { label: "Odia",       flag: "🇮🇳", group: "indian" },
  as: { label: "Assamese",   flag: "🇮🇳", group: "indian" },
  sa: { label: "Sanskrit",   flag: "🇮🇳", group: "indian" },
  es: { label: "Spanish",    flag: "🇪🇸", group: "international" },
  fr: { label: "French",     flag: "🇫🇷", group: "international" },
  de: { label: "German",     flag: "🇩🇪", group: "international" },
  ja: { label: "Japanese",   flag: "🇯🇵", group: "international" },
  zh: { label: "Chinese",    flag: "🇨🇳", group: "international" },
  ar: { label: "Arabic",     flag: "🇸🇦", group: "international" },
  pt: { label: "Portuguese", flag: "🇧🇷", group: "international" },
  ru: { label: "Russian",    flag: "🇷🇺", group: "international" },
  ko: { label: "Korean",     flag: "🇰🇷", group: "international" },
  it: { label: "Italian",    flag: "🇮🇹", group: "international" },
  nl: { label: "Dutch",      flag: "🇳🇱", group: "international" },
  tr: { label: "Turkish",    flag: "🇹🇷", group: "international" },
  pl: { label: "Polish",     flag: "🇵🇱", group: "international" },
  sv: { label: "Swedish",    flag: "🇸🇪", group: "international" },
  vi: { label: "Vietnamese", flag: "🇻🇳", group: "international" },
  th: { label: "Thai",       flag: "🇹🇭", group: "international" },
  id: { label: "Indonesian", flag: "🇮🇩", group: "international" },
  ms: { label: "Malay",      flag: "🇲🇾", group: "international" },
  uk: { label: "Ukrainian",  flag: "🇺🇦", group: "international" },
  cs: { label: "Czech",      flag: "🇨🇿", group: "international" },
  ro: { label: "Romanian",   flag: "🇷🇴", group: "international" },
  hu: { label: "Hungarian",  flag: "🇭🇺", group: "international" },
  el: { label: "Greek",      flag: "🇬🇷", group: "international" },
  he: { label: "Hebrew",     flag: "🇮🇱", group: "international" },
  da: { label: "Danish",     flag: "🇩🇰", group: "international" },
  fi: { label: "Finnish",    flag: "🇫🇮", group: "international" },
  no: { label: "Norwegian",  flag: "🇳🇴", group: "international" },
  sk: { label: "Slovak",     flag: "🇸🇰", group: "international" },
  bg: { label: "Bulgarian",  flag: "🇧🇬", group: "international" },
  hr: { label: "Croatian",   flag: "🇭🇷", group: "international" },
  sr: { label: "Serbian",    flag: "🇷🇸", group: "international" },
  lt: { label: "Lithuanian", flag: "🇱🇹", group: "international" },
  lv: { label: "Latvian",    flag: "🇱🇻", group: "international" },
  et: { label: "Estonian",   flag: "🇪🇪", group: "international" },
  sw: { label: "Swahili",    flag: "🇰🇪", group: "international" },
  af: { label: "Afrikaans",  flag: "🇿🇦", group: "international" },
};

const TRANSLATE_STAGES = [
  { label: "Preparing translation...", percent: 15 },
  { label: "Translating via Qwen...", percent: 50 },
  { label: "Formatting output...", percent: 90 },
];

export default function Translator() {
  const [langs, setLangs] = useState<string[]>([]);
  const [srcLang, setSrcLang] = useState("en");
  const [tgtLang, setTgtLang] = useState("hi");
  const [srcText, setSrcText] = useState("");
  const [tgtText, setTgtText] = useState("");
  const [engine, setEngine] = useState<TranslateEngine>("qwen");
  const [translating, setTranslating] = useState(false);
  const proc = useProcessing();
  const { isAuthenticated, refreshUsage } = useAuth();
  const overCharLimit = !isAuthenticated && srcText.length > PUBLIC_MAX_CHARS;

  useEffect(() => {
    getLanguages()
      .then(setLangs)
      .catch(() => setLangs(Object.keys(LANG_META)));
  }, []);

  const handleTranslate = async () => {
    if (!srcText.trim() || overCharLimit) return;
    setTranslating(true);
    proc.startProcessing(TRANSLATE_STAGES);

    try {
      proc.addLog(`Translating ${LANG_META[srcLang]?.label || srcLang} → ${LANG_META[tgtLang]?.label || tgtLang}...`);
      proc.nextStage();
      const res = await translate(srcText, srcLang, tgtLang, engine);
      setTgtText(res.translated_text);
      proc.nextStage();
      proc.complete("Translation complete");
      if (isAuthenticated) refreshUsage();
    } catch (err: any) {
      proc.cancel();
      if (err?.quota) {
        notify.quotaExceeded(err.quota);
      } else {
        notify.serviceOffline(engine === "qwen" ? "Qwen Translator" : "NLLB Translator");
      }
    } finally {
      setTranslating(false);
    }
  };

  const handleSwap = () => {
    setSrcLang(tgtLang);
    setTgtLang(srcLang);
    setSrcText(tgtText);
    setTgtText(srcText);
  };

  const displayLangs = langs.length > 0 ? langs : Object.keys(LANG_META);

  const langOptions: LangOption[] = useMemo(() => {
    const indian = displayLangs
      .filter((l) => LANG_META[l]?.group === "indian")
      .map((l) => ({ value: l, label: LANG_META[l]?.label ?? l, flag: LANG_META[l]?.flag ?? "🌐", group: "indian" as const }));
    const intl = displayLangs
      .filter((l) => LANG_META[l]?.group !== "indian")
      .map((l) => ({ value: l, label: LANG_META[l]?.label ?? l, flag: LANG_META[l]?.flag ?? "🌐", group: "international" as const }));
    return [...indian, ...intl];
  }, [displayLangs]);

  return (
    <div className="vm-card">
      <div className="vm-card-header">
        <div className="vm-card-icon">
          <Languages size={18} strokeWidth={2} />
        </div>
        <div>
          <div className="vm-card-title">Translation</div>
          <div className="vm-card-subtitle">{engine === "qwen" ? "Qwen 7B" : "NLLB-200"} &middot; {displayLangs.length} languages</div>
        </div>
        <UsageIndicator resource="text" />
      </div>

      {/* Language selectors */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <LanguageSelect
            value={srcLang}
            onChange={setSrcLang}
            options={langOptions}
            disabled={translating}
            placeholder="Source language"
          />
        </div>

        <button className="vm-swap-btn" onClick={handleSwap} title="Swap languages" aria-label="Swap languages">
          <ArrowRightLeft size={14} strokeWidth={2} />
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <LanguageSelect
            value={tgtLang}
            onChange={setTgtLang}
            options={langOptions}
            disabled={translating}
            placeholder="Target language"
          />
        </div>
      </div>

      {/* Translation engine */}
      <div style={{ marginBottom: 12 }}>
        <EngineToggle value={engine} onChange={setEngine} disabled={translating} label="Engine" />
      </div>

      {/* Source text */}
      <textarea
        className="vm-textarea"
        placeholder="Enter text to translate..."
        value={srcText}
        onChange={(e) => setSrcText(e.target.value)}
        rows={3}
        disabled={translating}
      />

      {/* Char limit indicator for public */}
      {!isAuthenticated && (
        <div className={`vm-word-count ${overCharLimit ? "over-limit" : ""}`} style={{ marginTop: 4 }}>
          {srcText.length}/{PUBLIC_MAX_CHARS} chars
        </div>
      )}

      {/* Translate button */}
      <button
        className="vm-btn vm-btn-primary"
        style={{ width: "100%", marginTop: 12 }}
        onClick={handleTranslate}
        disabled={translating || !srcText.trim() || overCharLimit}
      >
        {translating ? (
          <div className="vm-step-indicator">
            <div className="vm-spinner" />
            Translating...
          </div>
        ) : (
          <>
            <Languages size={14} strokeWidth={2.5} />
            Translate
          </>
        )}
      </button>

      {/* Result */}
      {tgtText && (
        <div className="vm-fade-in" style={{ marginTop: 12 }}>
          <div className="vm-label">Translation</div>
          <div className="vm-result vm-result-text">{tgtText}</div>
        </div>
      )}
    </div>
  );
}
