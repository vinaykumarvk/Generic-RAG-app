import { useState, useCallback } from "react";
import type { AssistantTab } from "../types";

export function useAssistantState() {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<AssistantTab>("query");

  const toggle = useCallback(() => setOpen((prev) => !prev), []);
  const openAssistant = useCallback(() => setOpen(true), []);
  const closeAssistant = useCallback(() => setOpen(false), []);

  return { open, activeTab, setActiveTab, toggle, openAssistant, closeAssistant };
}
