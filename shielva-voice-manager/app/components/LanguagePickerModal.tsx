"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Search } from "lucide-react";
import { type LangOption } from "./LanguageSelect";

type TimeSlot = "morning" | "afternoon" | "evening" | "night";

function getTimeSlot(): TimeSlot {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 21) return "evening";
  return "night";
}

const GREETINGS: Record<string, Record<TimeSlot, string>> = {
  en: { morning: "Hi, good morning, how are you?",      afternoon: "Hi, good afternoon, how are you?",   evening: "Hi, good evening, how are you?",       night: "Hi, good night, how are you?"         },
  hi: { morning: "नमस्ते, शुभ प्रभात, आप कैसे हैं?",  afternoon: "नमस्ते, शुभ अपराह्न, आप कैसे हैं?", evening: "नमस्ते, शुभ संध्या, आप कैसे हैं?",   night: "नमस्ते, शुभ रात्रि, आप कैसे हैं?"    },
  ta: { morning: "வணக்கம், காலை வணக்கம், நீங்கள் எப்படி இருக்கிறீர்கள்?", afternoon: "வணக்கம், மதிய வணக்கம், நீங்கள் எப்படி இருக்கிறீர்கள்?", evening: "வணக்கம், மாலை வணக்கம், நீங்கள் எப்படி இருக்கிறீர்கள்?", night: "வணக்கம், இரவு வணக்கம், நீங்கள் எப்படி இருக்கிறீர்கள்?" },
  te: { morning: "నమస్కారం, శుభోదయం, మీరు ఎలా ఉన్నారు?",    afternoon: "నమస్కారం, శుభ మధ్యాహ్నం, మీరు ఎలా ఉన్నారు?",  evening: "నమస్కారం, శుభ సాయంత్రం, మీరు ఎలా ఉన్నారు?",  night: "నమస్కారం, శుభ రాత్రి, మీరు ఎలా ఉన్నారు?"   },
  kn: { morning: "ನಮಸ್ಕಾರ, ಶುಭೋದಯ, ನೀವು ಹೇಗಿದ್ದೀರಿ?",         afternoon: "ನಮಸ್ಕಾರ, ಶುಭ ಮಧ್ಯಾಹ್ನ, ನೀವು ಹೇಗಿದ್ದೀರಿ?",      evening: "ನಮಸ್ಕಾರ, ಶುಭ ಸಂಜೆ, ನೀವು ಹೇಗಿದ್ದೀರಿ?",           night: "ನಮಸ್ಕಾರ, ಶುಭ ರಾತ್ರಿ, ನೀವು ಹೇಗಿದ್ದೀರಿ?"   },
  ml: { morning: "നമസ്കാരം, ശുഭ പ്രഭാതം, നിങ്ങൾ എങ്ങനെ ഉണ്ട്?",  afternoon: "നമസ്കാരം, ശുഭ ഉച്ചയ്ക്ക്, നിങ്ങൾ എങ്ങനെ ഉണ്ട്?", evening: "നമസ്കാരം, ശുഭ സന്ധ്യ, നിങ്ങൾ എങ്ങനെ ഉണ്ട്?",  night: "നമസ്കാരം, ശുഭ രാത്രി, നിങ്ങൾ എങ്ങനെ ഉണ്ട്?"  },
  mr: { morning: "नमस्कार, शुभ प्रभात, तुम्ही कसे आहात?",        afternoon: "नमस्कार, शुभ दुपार, तुम्ही कसे आहात?",          evening: "नमस्कार, शुभ संध्याकाळ, तुम्ही कसे आहात?",      night: "नमस्कार, शुभ रात्री, तुम्ही कसे आहात?"     },
  bn: { morning: "নমস্কার, শুভ সকাল, আপনি কেমন আছেন?",           afternoon: "নমস্কার, শুভ দুপুর, আপনি কেমন আছেন?",           evening: "নমস্কার, শুভ সন্ধ্যা, আপনি কেমন আছেন?",         night: "নমস্কার, শুভ রাত্রি, আপনি কেমন আছেন?"      },
  gu: { morning: "નમસ્તે, શુભ પ્રભાત, આપ કેમ છો?",                afternoon: "નમસ્તે, શુભ બપોર, આપ કેમ છો?",                  evening: "નમસ્તે, શુભ સાંજ, આપ કેમ છો?",                   night: "નમસ્તે, શુભ રાત્રિ, આપ કેમ છો?"            },
  pa: { morning: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਸ਼ੁਭ ਸਵੇਰ, ਤੁਸੀਂ ਕਿਵੇਂ ਹੋ?",      afternoon: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਸ਼ੁਭ ਦੁਪਹਿਰ, ਤੁਸੀਂ ਕਿਵੇਂ ਹੋ?",    evening: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਸ਼ੁਭ ਸ਼ਾਮ, ਤੁਸੀਂ ਕਿਵੇਂ ਹੋ?",       night: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਸ਼ੁਭ ਰਾਤ, ਤੁਸੀਂ ਕਿਵੇਂ ਹੋ?"   },
  ur: { morning: "السلام علیکم، صبح بخیر، آپ کیسے ہیں؟",          afternoon: "السلام علیکم، دوپہر بخیر، آپ کیسے ہیں؟",        evening: "السلام علیکم، شام بخیر، آپ کیسے ہیں؟",           night: "السلام علیکم، شب بخیر، آپ کیسے ہیں؟"       },
  or: { morning: "ନମସ୍କାର, ଶୁଭ ସକାଳ, ଆପଣ କେମିତି ଅଛନ୍ତି?",        afternoon: "ନମସ୍କାର, ଶୁଭ ଅପରାହ୍ନ, ଆପଣ କେମିତି ଅଛନ୍ତି?",    evening: "ନମସ୍କାର, ଶୁଭ ସନ୍ଧ୍ୟା, ଆପଣ କେମିତି ଅଛନ୍ତି?",      night: "ନମସ୍କାର, ଶୁଭ ରାତ୍ରି, ଆପଣ କେମିତି ଅଛନ୍ତି?"  },
  as: { morning: "নমস্কাৰ, শুভ প্ৰভাত, আপুনি কেনে আছে?",           afternoon: "নমস্কাৰ, শুভ দুপৰ, আপুনি কেনে আছে?",            evening: "নমস্কাৰ, শুভ সন্ধিয়া, আপুনি কেনে আছে?",        night: "নমস্কাৰ, শুভ ৰাতি, আপুনি কেনে আছে?"        },
  sa: { morning: "नमस्ते, सुप्रभातम्, भवान् कथमस्ति?",              afternoon: "नमस्ते, शुभमध्याह्नम्, भवान् कथमस्ति?",          evening: "नमस्ते, शुभसायम्, भवान् कथमस्ति?",               night: "नमस्ते, शुभरात्रिः, भवान् कथमस्ति?"         },
  es: { morning: "Hola, buenos días, ¿cómo estás?",                 afternoon: "Hola, buenas tardes, ¿cómo estás?",              evening: "Hola, buenas noches, ¿cómo estás?",               night: "Hola, buenas noches, ¿cómo estás?"           },
  fr: { morning: "Bonjour, bonne matinée, comment allez-vous?",     afternoon: "Bonjour, bon après-midi, comment allez-vous?",   evening: "Bonsoir, bonne soirée, comment allez-vous?",      night: "Bonsoir, bonne nuit, comment allez-vous?"    },
  de: { morning: "Hallo, guten Morgen, wie geht es Ihnen?",         afternoon: "Hallo, guten Mittag, wie geht es Ihnen?",        evening: "Hallo, guten Abend, wie geht es Ihnen?",          night: "Hallo, gute Nacht, wie geht es Ihnen?"       },
  ja: { morning: "こんにちは、おはようございます、お元気ですか？",    afternoon: "こんにちは、こんにちは、お元気ですか？",             evening: "こんにちは、こんばんは、お元気ですか？",            night: "こんにちは、おやすみなさい、お元気ですか？"  },
  zh: { morning: "你好，早上好，你怎么样？",                           afternoon: "你好，下午好，你怎么样？",                          evening: "你好，晚上好，你怎么样？",                          night: "你好，晚安，你怎么样？"                       },
  ar: { morning: "مرحباً، صباح الخير، كيف حالك؟",                   afternoon: "مرحباً، مساء الخير، كيف حالك؟",                  evening: "مرحباً، مساء الخير، كيف حالك؟",                   night: "مرحباً، تصبح على خير، كيف حالك؟"            },
  pt: { morning: "Olá, bom dia, como vai você?",                    afternoon: "Olá, boa tarde, como vai você?",                 evening: "Olá, boa noite, como vai você?",                  night: "Olá, boa noite, como vai você?"              },
  ru: { morning: "Привет, доброе утро, как дела?",                   afternoon: "Привет, добрый день, как дела?",                 evening: "Привет, добрый вечер, как дела?",                 night: "Привет, спокойной ночи, как дела?"           },
  ko: { morning: "안녕하세요, 좋은 아침이에요, 어떻게 지내세요?",     afternoon: "안녕하세요, 좋은 오후에요, 어떻게 지내세요?",       evening: "안녕하세요, 좋은 저녁이에요, 어떻게 지내세요?",    night: "안녕하세요, 좋은 밤이에요, 어떻게 지내세요?" },
  it: { morning: "Ciao, buongiorno, come stai?",                    afternoon: "Ciao, buon pomeriggio, come stai?",              evening: "Ciao, buonasera, come stai?",                     night: "Ciao, buonanotte, come stai?"                },
  nl: { morning: "Hoi, goedemorgen, hoe gaat het?",                 afternoon: "Hoi, goedemiddag, hoe gaat het?",                evening: "Hoi, goedenavond, hoe gaat het?",                 night: "Hoi, goedenacht, hoe gaat het?"              },
  tr: { morning: "Merhaba, günaydın, nasılsın?",                    afternoon: "Merhaba, iyi günler, nasılsın?",                 evening: "Merhaba, iyi akşamlar, nasılsın?",                night: "Merhaba, iyi geceler, nasılsın?"             },
  pl: { morning: "Cześć, dzień dobry, jak się masz?",               afternoon: "Cześć, dobry dzień, jak się masz?",              evening: "Cześć, dobry wieczór, jak się masz?",             night: "Cześć, dobranoc, jak się masz?"              },
  sv: { morning: "Hej, god morgon, hur mår du?",                    afternoon: "Hej, god eftermiddag, hur mår du?",              evening: "Hej, god kväll, hur mår du?",                     night: "Hej, god natt, hur mår du?"                  },
  vi: { morning: "Xin chào, chào buổi sáng, bạn khỏe không?",      afternoon: "Xin chào, chào buổi chiều, bạn khỏe không?",    evening: "Xin chào, chào buổi tối, bạn khỏe không?",       night: "Xin chào, chúc ngủ ngon, bạn khỏe không?"   },
  th: { morning: "สวัสดี, อรุณสวัสดิ์, สบายดีไหม?",                afternoon: "สวัสดี, สวัสดีตอนบ่าย, สบายดีไหม?",             evening: "สวัสดี, สวัสดีตอนเย็น, สบายดีไหม?",             night: "สวัสดี, ราตรีสวัสดิ์, สบายดีไหม?"           },
  id: { morning: "Halo, selamat pagi, apa kabar?",                  afternoon: "Halo, selamat siang, apa kabar?",                evening: "Halo, selamat sore, apa kabar?",                  night: "Halo, selamat malam, apa kabar?"             },
  uk: { morning: "Привіт, доброго ранку, як справи?",               afternoon: "Привіт, доброго дня, як справи?",                evening: "Привіт, добрий вечір, як справи?",                night: "Привіт, на добраніч, як справи?"             },
  cs: { morning: "Ahoj, dobré ráno, jak se máš?",                   afternoon: "Ahoj, dobré odpoledne, jak se máš?",             evening: "Ahoj, dobrý večer, jak se máš?",                  night: "Ahoj, dobrou noc, jak se máš?"               },
  hu: { morning: "Szia, jó reggelt, hogy vagy?",                    afternoon: "Szia, jó napot, hogy vagy?",                    evening: "Szia, jó estét, hogy vagy?",                      night: "Szia, jó éjszakát, hogy vagy?"               },
};

export function getSampleText(lang: string): string {
  const slot = getTimeSlot();
  return GREETINGS[lang]?.[slot] ?? GREETINGS.en[slot];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  value: string;
  onSelect: (lang: string, sampleText: string) => void;
  options: LangOption[];
  title?: string;
}

const SECTION_LABEL: React.CSSProperties = {
  display: "inline-block",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.7px",
  textTransform: "uppercase",
  color: "#ffffff",
  background: "#537f28",
  padding: "3px 10px",
  borderRadius: 20,
  marginBottom: 14,
};

export default function LanguagePickerModal({ isOpen, onClose, value, onSelect, options, title = "Select Language" }: Props) {
  const [query, setQuery]     = useState("");
  const [hovered, setHovered] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  // Compute time slot client-side only to avoid SSR/client mismatch
  const [slot, setSlot]       = useState<TimeSlot>("morning");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
    setSlot(getTimeSlot());
  }, []);

  const timeLabel = slot === "morning" ? "Good morning" : slot === "afternoon" ? "Good afternoon" : slot === "evening" ? "Good evening" : "Good night";

  useEffect(() => {
    if (isOpen) { setQuery(""); setTimeout(() => searchRef.current?.focus(), 50); }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, [isOpen, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const indian = filtered.filter((o) => o.group === "indian");
  const intl   = filtered.filter((o) => o.group === "international");

  if (!isOpen) return null;

  const card = (o: LangOption) => {
    const sel = o.value === value;
    const hov = hovered === o.value;
    const preview = GREETINGS[o.value]?.[slot] ?? "";
    return (
      <div
        key={o.value}
        onMouseEnter={() => setHovered(o.value)}
        onMouseLeave={() => setHovered(null)}
        onClick={() => { onSelect(o.value, getSampleText(o.value)); }}
        style={{
          padding: "14px 14px 12px",
          borderRadius: 10,
          border: sel ? "2px solid #6d9f37" : hov ? "2px solid var(--border, #ccc)" : "1px solid var(--border-subtle, rgba(255,255,255,0.1))",
          background: sel ? "rgba(109,159,55,0.1)" : hov ? "rgba(255,255,255,0.05)" : "var(--surface-subtle)",
          cursor: "pointer",
          transition: "border-color 0.12s, background 0.12s",
          display: "flex", flexDirection: "column", gap: 5,
          minHeight: 88, userSelect: "none",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <span style={{ fontSize: 26, lineHeight: 1 }}>{o.flag}</span>
          {sel && (
            <span style={{
              width: 18, height: 18, borderRadius: "50%", background: "#6d9f37",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10, fontWeight: 700, color: "#fff",
            }}>✓</span>
          )}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: sel ? "#6d9f37" : "var(--text-primary)", lineHeight: 1.2 }}>
          {o.label}
        </div>
        {preview && (
          <div style={{
            fontSize: 10, color: "var(--text-muted)", lineHeight: 1.45, fontStyle: "italic",
            overflow: "hidden", display: "-webkit-box",
            WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          }}>
            {preview}
          </div>
        )}
      </div>
    );
  };

  const modal = (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "20px",
        overflow: "hidden",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "var(--card, #1a1a1a)",
          borderRadius: 16,
          width: "100%",
          maxWidth: 700,
          /* Fixed height so it never overflows the screen */
          height: "min(680px, calc(100vh - 40px))",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 32px 80px rgba(0,0,0,0.5)",
          border: "1px solid var(--border-subtle, rgba(255,255,255,0.1))",
          animation: "lpm-in 0.18s ease",
          overflow: "hidden",
        }}
      >
        {/* ── Header (never scrolls away) ── */}
        <div style={{
          flexShrink: 0,
          padding: "16px 18px 0",
          borderBottom: "1px solid var(--border-subtle, rgba(255,255,255,0.08))",
          paddingBottom: 0,
        }}>
          {/* Title row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={onClose}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 8, padding: "6px 12px",
                  color: "var(--text-primary)", fontSize: 12, fontWeight: 500,
                  cursor: "pointer", flexShrink: 0,
                }}
              >
                ← Back
              </button>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>{title}</div>
                <div style={{ fontSize: 11, color: "#6d9f37", marginTop: 2 }}>{timeLabel} — select a language to pre-fill sample text</div>
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                background: "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.15)",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", color: "var(--text-primary)",
              }}
            >
              <X size={16} strokeWidth={2.5} />
            </button>
          </div>

          {/* Search */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 8,
            padding: "8px 12px",
            marginBottom: 14,
          }}>
            <Search size={14} color="#6d9f37" style={{ flexShrink: 0 }} />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search languages…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{
                flex: 1, border: "none", background: "transparent",
                fontSize: 13, color: "var(--text-primary)", outline: "none",
              }}
            />
            {query && (
              <button onClick={() => setQuery("")}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 18, lineHeight: 1, padding: 0 }}>
                ×
              </button>
            )}
          </div>
        </div>

        {/* ── Scrollable card grid ── */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 18px 32px" }}>
          {filtered.length === 0 && (
            <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-muted)", fontSize: 13 }}>
              No languages found for &quot;{query}&quot;
            </div>
          )}

          {indian.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={SECTION_LABEL}>Indian Languages</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(175px, 1fr))", gap: 10 }}>
                {indian.map(card)}
              </div>
            </div>
          )}

          {intl.length > 0 && (
            <div>
              <div style={{ ...SECTION_LABEL, background: "#416223", marginTop: indian.length > 0 ? 4 : 0 }}>
                International Languages
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(175px, 1fr))", gap: 10 }}>
                {intl.map(card)}
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes lpm-in {
          from { opacity: 0; transform: scale(0.95) translateY(8px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);   }
        }
      `}</style>
    </div>
  );

  if (!mounted) return null;
  return createPortal(modal, document.body);
}
