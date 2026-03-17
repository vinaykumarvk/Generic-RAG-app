import { useEffect } from "react";

/**
 * Listens for Ctrl+K / Cmd+K to toggle the assistant overlay.
 */
export function useKeyboardShortcut(callback: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        callback();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [callback]);
}
