import { useEffect, useRef } from "react";
import type { AssistantConfig, AssistantTab, FeatureFlags } from "../types";
import { NlQueryPanel } from "./NlQueryPanel";
import { PageAgentPanel } from "./PageAgentPanel";

interface Props {
  open: boolean;
  onClose: () => void;
  config: AssistantConfig;
  flags: FeatureFlags;
  activeTab: AssistantTab;
  onTabChange: (tab: AssistantTab) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onCitationClick?: (type: string, id: string) => void;
}

export function AssistantOverlay({
  open, onClose, config, flags, activeTab, onTabChange, t, onCitationClick,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Trap focus inside panel
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const firstFocusable = panel.querySelector<HTMLElement>("input, button, [tabindex]");
    firstFocusable?.focus();
  }, [open, activeTab]);

  if (!open) return null;

  // Determine which tabs are available
  const showQueryTab = flags.nl_query;
  const showAgentTab = flags.page_agent;
  const showTabs = showQueryTab && showAgentTab;

  // If current tab's feature is disabled, switch to the other
  const effectiveTab = activeTab === "query" && !showQueryTab && showAgentTab ? "agent"
    : activeTab === "agent" && !showAgentTab && showQueryTab ? "query"
    : activeTab;

  return (
    <div className="assistant-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="presentation">
      <div className="assistant-panel" ref={panelRef} role="dialog" aria-modal="true" aria-label={t("assistant.title")}>
        {/* Header */}
        <div className="assistant-header">
          <h2 className="assistant-header__title">{t("assistant.title")}</h2>
          <button type="button" className="assistant-header__close" onClick={onClose} aria-label={t("assistant.close")}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Offline banner */}
        {config.isOffline && (
          <div className="assistant-offline" role="alert">{t("assistant.offline")}</div>
        )}

        {/* Tabs */}
        {showTabs && (
          <div className="assistant-tabs" role="tablist">
            <button
              type="button"
              className={`assistant-tabs__tab${effectiveTab === "query" ? " assistant-tabs__tab--active" : ""}`}
              onClick={() => onTabChange("query")}
              role="tab"
              aria-selected={effectiveTab === "query"}
              disabled={!showQueryTab}
            >
              {t("assistant.tab_query")}
            </button>
            <button
              type="button"
              className={`assistant-tabs__tab${effectiveTab === "agent" ? " assistant-tabs__tab--active" : ""}`}
              onClick={() => onTabChange("agent")}
              role="tab"
              aria-selected={effectiveTab === "agent"}
              disabled={!showAgentTab}
            >
              {t("assistant.tab_agent")}
            </button>
          </div>
        )}

        {/* Panel content */}
        {effectiveTab === "query" && showQueryTab && (
          <NlQueryPanel config={config} t={t} onCitationClick={onCitationClick} />
        )}
        {effectiveTab === "agent" && showAgentTab && (
          <PageAgentPanel config={config} t={t} />
        )}

        {/* Both features disabled */}
        {!showQueryTab && !showAgentTab && (
          <div className="assistant-body">
            <div className="assistant-empty">{t("assistant.feature_disabled")}</div>
          </div>
        )}
      </div>
    </div>
  );
}
