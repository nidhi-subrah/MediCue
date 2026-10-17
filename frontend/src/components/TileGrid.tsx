import { useEffect, useRef, useState } from "react";
import type { ModeId } from "@shared/types";
import Icon from "./Icon";

export interface TileOption {
  key: string;
  label: string;
  icon?: string;        // Icon name; defaults to the key
  onSelect: () => void;
}

const SCAN_MS = 1600;

/**
 * Tiles for the patient. Three access modes:
 *  grid  - normal touch targets
 *  large - fewer columns, bigger targets (low vision, tremor, fatigue)
 *  scan  - tiles highlight in turn; Space/Enter or a tap anywhere on the grid selects (single-switch access)
 */
export default function TileGrid({ options, mode, label }: { options: TileOption[]; mode: ModeId; label: string }) {
  const [focus, setFocus] = useState(0);
  const focusRef = useRef(0);
  focusRef.current = focus;

  useEffect(() => setFocus(0), [options.map((o) => o.key).join()]);

  useEffect(() => {
    if (mode !== "scan" || options.length === 0) return;
    const t = window.setInterval(() => setFocus((f) => (f + 1) % options.length), SCAN_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        options[focusRef.current]?.onSelect();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [mode, options]);

  return (
    <div
      role="group"
      aria-label={label}
      className={`tiles tiles-${mode}`}
      onClick={mode === "scan" ? () => options[focus]?.onSelect() : undefined}
    >
      {options.map((o, i) => (
        <button
          key={o.key}
          className={`tile ${mode === "scan" && i === focus ? "scan-focus" : ""}`}
          aria-current={mode === "scan" && i === focus ? "true" : undefined}
          onClick={mode === "scan" ? undefined : o.onSelect}
          tabIndex={mode === "scan" ? -1 : 0}
        >
          <Icon name={o.icon ?? o.key} size={mode === "grid" ? 36 : 48} className="tile-icon" />
          <span className="tile-label">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
