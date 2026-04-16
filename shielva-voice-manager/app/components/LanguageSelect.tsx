"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search } from "lucide-react";

export interface LangOption {
  value: string;
  label: string;
  flag: string;
  group: "indian" | "international";
  sublabel?: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: LangOption[];
  disabled?: boolean;
  placeholder?: string;
}

const ROW_H = 36;
const MAX_ROWS = 10;
const LIST_MAX_H = ROW_H * MAX_ROWS;

export default function LanguageSelect({ value, onChange, options, disabled, placeholder }: Props) {
  const [mounted, setMounted]  = useState(false);
  const [open, setOpen]        = useState(false);
  const [query, setQuery]      = useState("");
  const [hovered, setHovered]  = useState<string | null>(null);
  const [dropPos, setDropPos]  = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => { setMounted(true); }, []);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef  = useRef<HTMLInputElement>(null);

  // Compute portal position whenever dropdown opens
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setDropPos({
      top:   rect.bottom + window.scrollY + 4,
      left:  rect.left   + window.scrollX,
      width: rect.width,
    });
  }, [open]);

  // Recompute on scroll/resize while open
  useEffect(() => {
    if (!open) return;
    const update = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      setDropPos({
        top:   rect.bottom + window.scrollY + 4,
        left:  rect.left   + window.scrollX,
        width: rect.width,
      });
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current && triggerRef.current.contains(target)) return;
      const panel = document.getElementById("ls-portal-panel");
      if (panel && panel.contains(target)) return;
      setOpen(false);
      setQuery("");
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Focus search when open
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => searchRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const indianFiltered = filtered.filter((o) => o.group === "indian");
  const intlFiltered   = filtered.filter((o) => o.group === "international");
  const showGroups     = !query.trim();

  const selected = options.find((o) => o.value === value);

  const handleSelect = (val: string) => {
    onChange(val);
    setOpen(false);
    setQuery("");
    setHovered(null);
  };

  const renderOption = (o: LangOption) => (
    <div
      key={o.value}
      onMouseEnter={() => setHovered(o.value)}
      onMouseLeave={() => setHovered(null)}
      onClick={() => handleSelect(o.value)}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "0 12px", height: ROW_H,
        cursor: "pointer", fontSize: 13,
        background:
          o.value === value
            ? "rgba(109,159,55,0.1)"
            : hovered === o.value
            ? "var(--surface-hover, rgba(0,0,0,0.05))"
            : "transparent",
        transition: "background 0.1s",
      }}
    >
      <span style={{ fontSize: 16, flexShrink: 0 }}>{o.flag}</span>
      <span style={{ flex: 1, color: "var(--text-primary)", fontWeight: o.value === value ? 600 : 400 }}>
        {o.label}
      </span>
      {o.sublabel && (
        <span style={{ fontSize: 10, color: "var(--text-muted)", flexShrink: 0 }}>{o.sublabel}</span>
      )}
      {o.value === value && (
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--bamboo-500, #6d9f37)", flexShrink: 0 }}>✓</span>
      )}
    </div>
  );

  const dropdown = mounted && open && dropPos ? createPortal(
    <div
      id="ls-portal-panel"
      style={{
        position: "absolute",
        top:   dropPos.top,
        left:  dropPos.left,
        width: dropPos.width,
        zIndex: 99999,
        background: "var(--card, #ffffff)",
        border: "1px solid var(--border, #e0e0da)",
        borderRadius: 10,
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        overflow: "hidden",
        animation: "ls-fade-in 0.12s ease",
      }}
    >
      {/* Search */}
      <div
        style={{
          padding: "8px 10px",
          borderBottom: "1px solid var(--border-subtle)",
          display: "flex", alignItems: "center", gap: 6,
          background: "var(--surface-subtle)",
        }}
      >
        <Search size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <input
          ref={searchRef}
          type="text"
          placeholder="Search language..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          style={{
            flex: 1, border: "none", background: "transparent",
            fontSize: 12, color: "var(--text-primary)", outline: "none",
          }}
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--text-muted)", fontSize: 14, lineHeight: 1, padding: 0,
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* Option list */}
      <div style={{ maxHeight: LIST_MAX_H, overflowY: "auto" }}>
        {indianFiltered.length === 0 && intlFiltered.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
            No languages found
          </div>
        )}

        {indianFiltered.length > 0 && (
          <>
            {showGroups && (
              <div style={{ padding: "8px 12px 4px", fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px" }}>
                Indian
              </div>
            )}
            {indianFiltered.map(renderOption)}
          </>
        )}

        {intlFiltered.length > 0 && (
          <>
            {showGroups && (
              <div style={{
                padding: "8px 12px 4px", fontSize: 10, fontWeight: 700,
                color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.6px",
                borderTop: indianFiltered.length > 0 ? "1px solid var(--border-subtle)" : undefined,
                marginTop: indianFiltered.length > 0 ? 4 : 0,
              }}>
                International
              </div>
            )}
            {intlFiltered.map(renderOption)}
          </>
        )}
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "7px 10px", borderRadius: 8,
          border: open ? "1px solid var(--bamboo-500, #6d9f37)" : "1px solid var(--border-subtle)",
          background: "var(--surface-subtle)", color: "var(--text-primary)",
          fontSize: 12, cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1, textAlign: "left", outline: "none",
          transition: "border-color 0.15s", boxSizing: "border-box",
        }}
      >
        <span style={{ fontSize: 16, flexShrink: 0 }}>{selected?.flag ?? "🌐"}</span>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected ? selected.label : (placeholder ?? "Select language")}
        </span>
        {selected?.sublabel && (
          <span style={{ fontSize: 10, color: "var(--text-muted)", flexShrink: 0 }}>{selected.sublabel}</span>
        )}
        <ChevronDown
          size={13}
          style={{
            flexShrink: 0, color: "var(--text-muted)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s",
          }}
        />
      </button>

      {dropdown}

      <style>{`
        @keyframes ls-fade-in {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
