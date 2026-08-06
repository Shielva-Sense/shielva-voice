"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The single owner of destructive confirmation in this app.
 *
 * Before this existed every caller rolled its own: the analytics table swapped
 * the row's action buttons for an inline "Delete? Yes No" strip, which does not
 * fit — the row is a fixed-column CSS grid, so the wider content either
 * overlapped the timestamp or forced a horizontal scrollbar. The voice library
 * grew a second, differently-styled in-place confirm strip. Neither could be
 * reused by the other, and `window.confirm` is not permitted.
 *
 * Usage is imperative so a caller can simply await the answer inline:
 *
 *   if (!(await confirmDialog({ title: "Delete item?", danger: true }))) return;
 *
 * `<ConfirmDialogHost />` is mounted once in the root layout; the promise
 * resolves false if the user cancels, presses Escape, or clicks the backdrop.
 */

export interface ConfirmOptions {
  title: string;
  /** Optional supporting copy. Say what is irreversible. */
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm action as destructive and uses role="alertdialog". */
  danger?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

// The host registers itself here on mount. Module scope (not context) is what
// lets callers await a confirm from anywhere without threading a prop down.
let present: ((req: PendingConfirm) => void) | null = null;

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  if (!present) {
    // No host mounted — refuse rather than silently destroying data.
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    present?.({ ...options, resolve });
  });
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ConfirmDialogHost(): ReactNode {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    present = (req) => {
      // A second request while one is open answers the first as "cancelled" —
      // never leave a promise dangling.
      setPending((prev) => {
        prev?.resolve(false);
        return req;
      });
    };
    return () => {
      present = null;
    };
  }, []);

  const close = useCallback((ok: boolean) => {
    setPending((prev) => {
      prev?.resolve(ok);
      return null;
    });
  }, []);

  // Focus management: remember where focus was, move it into the dialog, and
  // put it back on close so keyboard users are not dumped at the top of the page.
  useEffect(() => {
    if (!pending) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    // Cancel takes initial focus: for a destructive prompt the safe answer
    // should be the one a stray Enter hits.
    const node = dialogRef.current?.querySelector<HTMLElement>("[data-confirm-cancel]");
    node?.focus();
    return () => {
      restoreFocusRef.current?.focus?.();
    };
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pending, close]);

  if (!pending || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="vm-confirm-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close(false);
      }}
    >
      <div
        ref={dialogRef}
        className="vm-confirm"
        role={pending.danger ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        {...(pending.message ? { "aria-describedby": messageId } : {})}
      >
        <h2 id={titleId} className="vm-confirm-title">
          {pending.title}
        </h2>
        {pending.message && (
          <div id={messageId} className="vm-confirm-msg">
            {pending.message}
          </div>
        )}
        <div className="vm-confirm-actions">
          <button type="button" data-confirm-cancel className="vm-confirm-btn" onClick={() => close(false)}>
            {pending.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            className={`vm-confirm-btn ${pending.danger ? "vm-confirm-btn--danger" : "vm-confirm-btn--primary"}`}
            onClick={() => close(true)}
          >
            {pending.confirmLabel ?? (pending.danger ? "Delete" : "Confirm")}
          </button>
        </div>
      </div>

      <style>{`
        .vm-confirm-backdrop {
          position: fixed; inset: 0; z-index: 10000;
          display: flex; align-items: center; justify-content: center;
          padding: 20px;
          background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
        }
        .vm-confirm {
          width: 100%; max-width: 420px;
          background: var(--card, var(--surface, #fff));
          border: 1px solid var(--border-subtle);
          border-radius: 14px; padding: 20px;
          box-shadow: 0 18px 48px rgba(0,0,0,0.35);
          animation: proc-circle-in 0.16s ease;
        }
        .vm-confirm-title {
          margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary);
        }
        .vm-confirm-msg {
          margin-top: 8px; font-size: 13px; line-height: 1.55; color: var(--text-secondary);
        }
        .vm-confirm-actions {
          display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px;
        }
        .vm-confirm-btn {
          height: 32px; padding: 0 12px; border-radius: 7px; font-size: 13px;
          border: 1px solid var(--border-subtle); background: var(--surface);
          color: var(--text-primary); cursor: pointer;
          transition: border-color 0.15s ease, opacity 0.15s ease;
        }
        .vm-confirm-btn:hover { border-color: var(--border-strong, var(--border)); }
        .vm-confirm-btn--danger { color: #fff; background: #c0392b; border-color: #c0392b; }
        .vm-confirm-btn--primary { color: #fff; background: var(--brand-500, #6d9f37); border-color: transparent; }
        @media (prefers-reduced-motion: reduce) {
          .vm-confirm { animation: none; }
        }
      `}</style>
    </div>,
    document.body,
  );
}
