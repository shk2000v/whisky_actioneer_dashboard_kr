import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "./components/Icon";

/**
 * Three window sizes (same values as the CSS media queries in styles.css):
 *  - wide    >= 1024px  desktop window: two-column pages, nav in the top bar
 *  - pad     640-1023px tablet-sized window: one column, tab row under the top bar, details in a side sheet
 *  - compact < 640px    phone-sized window: bottom tab bar, cards instead of tables, full-screen sheets
 */
export type Size = "wide" | "pad" | "compact";

const WIDE = "(min-width: 1024px)";
const PAD = "(min-width: 640px)";

function read(): Size {
  if (typeof window === "undefined") return "wide";
  if (window.matchMedia(WIDE).matches) return "wide";
  if (window.matchMedia(PAD).matches) return "pad";
  return "compact";
}

function subscribe(cb: () => void) {
  const a = window.matchMedia(WIDE);
  const b = window.matchMedia(PAD);
  a.addEventListener("change", cb);
  b.addEventListener("change", cb);
  return () => {
    a.removeEventListener("change", cb);
    b.removeEventListener("change", cb);
  };
}

export function useSize(): Size {
  return useSyncExternalStore(subscribe, read, () => "wide");
}

/**
 * Modal sheet built on <dialog>: native focus trap, Escape to close, focus returns to the opener.
 * Renders as a right-hand panel on pad and full screen on compact (see .sheet in styles.css).
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const [id] = useState(() => `sheet-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCloseEvt = () => {
      onClose();
      (opener.current as HTMLElement | null)?.focus?.();
    };
    d.addEventListener("close", onCloseEvt);
    return () => d.removeEventListener("close", onCloseEvt);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={id}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <div className="sheet-inner">
        <header className="sheet-head">
          <h2 id={id}>{title}</h2>
          <button className="icon-btn" aria-label="닫기" onClick={() => ref.current?.close()}>
            <Icon name="close" />
          </button>
        </header>
        <div className="sheet-body">{open && children}</div>
      </div>
    </dialog>
  );
}
