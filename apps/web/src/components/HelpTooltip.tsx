import { useState, useRef, useEffect, useCallback } from "react";
import { HelpCircle } from "lucide-react";

interface HelpTooltipProps {
  text: string;
  position?: "top" | "right" | "bottom" | "left";
}

const POSITION_CLASSES: Record<string, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
  right: "left-full top-1/2 -translate-y-1/2 ml-2",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
  left: "right-full top-1/2 -translate-y-1/2 mr-2",
};

const ARROW_CLASSES: Record<string, string> = {
  top: "top-full left-1/2 -translate-x-1/2 border-t-[rgb(var(--color-surface))] border-x-transparent border-b-transparent",
  right: "right-full top-1/2 -translate-y-1/2 border-r-[rgb(var(--color-surface))] border-y-transparent border-l-transparent",
  bottom: "bottom-full left-1/2 -translate-x-1/2 border-b-[rgb(var(--color-surface))] border-x-transparent border-t-transparent",
  left: "left-full top-1/2 -translate-y-1/2 border-l-[rgb(var(--color-surface))] border-y-transparent border-r-transparent",
};

export function HelpTooltip({ text, position = "top" }: HelpTooltipProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open, handleClickOutside]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative inline-flex" onKeyDown={handleKeyDown}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="p-0.5 text-text-secondary hover:text-text-primary transition-colors rounded-full focus:outline-none focus:ring-2 focus:ring-primary-500"
        aria-label="Help"
        aria-expanded={open}
      >
        <HelpCircle size={14} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="tooltip"
          className={`absolute z-50 ${POSITION_CLASSES[position]} pointer-events-none`}
        >
          <div className="relative bg-surface border border-skin rounded-lg shadow-lg px-3 py-2 text-xs text-text-primary max-w-[12rem] whitespace-normal">
            {text}
            <div
              className={`absolute w-0 h-0 border-4 ${ARROW_CLASSES[position]}`}
              aria-hidden="true"
            />
          </div>
        </div>
      )}
    </div>
  );
}
