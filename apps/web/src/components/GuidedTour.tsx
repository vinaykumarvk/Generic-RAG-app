import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { X, ChevronRight, ChevronLeft, SkipForward } from "lucide-react";

const TOUR_STORAGE_KEY = "intellirag_tour_complete";

interface TourStep {
  target: string;
  title: string;
  description: string;
  position: "top" | "right" | "bottom" | "left";
}

const STEPS: TourStep[] = [
  {
    target: '[aria-label="Main navigation"]',
    title: "Sidebar Navigation",
    description:
      "Use the sidebar to navigate between pages. Access your dashboard, workspaces, documents, and more.",
    position: "right",
  },
  {
    target: '[data-tour="workspace-select"]',
    title: "Workspace Selection",
    description:
      "Select or create a workspace to organize your documents and conversations by project or team.",
    position: "bottom",
  },
  {
    target: '[data-tour="document-upload"]',
    title: "Document Upload",
    description:
      "Upload PDFs, Word documents, and other files. They will be automatically processed and made searchable.",
    position: "bottom",
  },
  {
    target: '[data-tour="query-page"]',
    title: "Query Page",
    description:
      "Ask natural language questions about your documents. Choose a retrieval preset for speed vs. depth.",
    position: "right",
  },
  {
    target: '[data-tour="graph-explorer"]',
    title: "Graph Explorer",
    description:
      "Visualize the knowledge graph extracted from your documents. Explore entities and their relationships.",
    position: "right",
  },
];

function getTargetRect(selector: string): DOMRect | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  return el.getBoundingClientRect();
}

interface TooltipPosition {
  top: number;
  left: number;
}

function computeTooltipPosition(
  rect: DOMRect,
  position: TourStep["position"],
  tooltipWidth: number,
  tooltipHeight: number,
): TooltipPosition {
  const OFFSET = 12;
  switch (position) {
    case "right":
      return {
        top: rect.top + rect.height / 2 - tooltipHeight / 2,
        left: rect.right + OFFSET,
      };
    case "left":
      return {
        top: rect.top + rect.height / 2 - tooltipHeight / 2,
        left: rect.left - tooltipWidth - OFFSET,
      };
    case "bottom":
      return {
        top: rect.bottom + OFFSET,
        left: rect.left + rect.width / 2 - tooltipWidth / 2,
      };
    case "top":
    default:
      return {
        top: rect.top - tooltipHeight - OFFSET,
        left: rect.left + rect.width / 2 - tooltipWidth / 2,
      };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function GuidedTour() {
  const [active, setActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Check if the tour should show on first visit
  useEffect(() => {
    try {
      const complete = localStorage.getItem(TOUR_STORAGE_KEY);
      if (!complete) {
        // Delay to let the page render and targets become available
        const timer = setTimeout(() => setActive(true), 1000);
        return () => clearTimeout(timer);
      }
    } catch {
      // localStorage unavailable, skip tour
    }
  }, []);

  // Update target rect when step changes or on resize
  const updateRect = useCallback(() => {
    if (!active) return;
    const step = STEPS[currentStep];
    if (!step) return;
    const rect = getTargetRect(step.target);
    setTargetRect(rect);
  }, [active, currentStep]);

  useEffect(() => {
    updateRect();
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [updateRect]);

  const completeTour = useCallback(() => {
    setActive(false);
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, "true");
    } catch {
      // localStorage unavailable
    }
  }, []);

  const handleNext = useCallback(() => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      completeTour();
    }
  }, [currentStep, completeTour]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  }, [currentStep]);

  // Keyboard navigation
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        completeTour();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        handleNext();
      } else if (e.key === "ArrowLeft") {
        handleBack();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, completeTour, handleNext, handleBack]);

  if (!active) return null;

  const step = STEPS[currentStep];
  const TOOLTIP_WIDTH = 320;
  const TOOLTIP_HEIGHT = 180;
  const PADDING = 8;

  // Compute spotlight and tooltip position
  let spotlightStyle: React.CSSProperties = { display: "none" };
  let tooltipStyle: React.CSSProperties = {};

  if (targetRect) {
    spotlightStyle = {
      position: "fixed",
      top: targetRect.top - PADDING,
      left: targetRect.left - PADDING,
      width: targetRect.width + PADDING * 2,
      height: targetRect.height + PADDING * 2,
      borderRadius: "0.5rem",
      boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.55)",
      pointerEvents: "none",
      zIndex: 70,
      transition: "all 300ms ease-in-out",
    };

    const pos = computeTooltipPosition(targetRect, step.position, TOOLTIP_WIDTH, TOOLTIP_HEIGHT);
    tooltipStyle = {
      position: "fixed",
      top: clamp(pos.top, 8, window.innerHeight - TOOLTIP_HEIGHT - 8),
      left: clamp(pos.left, 8, window.innerWidth - TOOLTIP_WIDTH - 8),
      width: TOOLTIP_WIDTH,
      zIndex: 71,
      transition: "all 300ms ease-in-out",
    };
  } else {
    // Target not found — center the tooltip
    tooltipStyle = {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      width: TOOLTIP_WIDTH,
      zIndex: 71,
    };
  }

  return createPortal(
    <>
      {/* Overlay backdrop — click to dismiss */}
      <div
        className="fixed inset-0 z-[69]"
        onClick={completeTour}
        aria-hidden="true"
      />

      {/* Spotlight cutout */}
      {targetRect && <div style={spotlightStyle} aria-hidden="true" />}

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-step-title"
        style={tooltipStyle}
      >
        <div className="bg-surface border border-skin rounded-xl shadow-2xl p-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-2 mb-3">
            <div>
              <p className="text-xs font-medium text-primary-600 mb-1">
                Step {currentStep + 1} of {STEPS.length}
              </p>
              <h3 id="tour-step-title" className="text-sm font-semibold text-text-primary">
                {step.title}
              </h3>
            </div>
            <button
              type="button"
              onClick={completeTour}
              className="p-1 rounded-lg hover:bg-surface-alt text-text-secondary transition-colors"
              aria-label="Close tour"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          {/* Step description (announced to screen readers) */}
          <p
            className="text-sm text-text-secondary mb-4 leading-relaxed"
            aria-live="polite"
          >
            {step.description}
          </p>

          {/* Progress dots */}
          <div className="flex items-center gap-1.5 mb-4" aria-hidden="true">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`w-2 h-2 rounded-full transition-colors ${
                  i === currentStep ? "bg-primary-700" : "bg-surface-alt border border-skin"
                }`}
              />
            ))}
          </div>

          {/* Navigation buttons */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={completeTour}
              className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
            >
              <SkipForward size={12} aria-hidden="true" />
              Skip tour
            </button>

            <div className="flex items-center gap-2">
              {currentStep > 0 && (
                <button
                  type="button"
                  onClick={handleBack}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-skin text-text-primary hover:bg-surface-alt transition-colors"
                >
                  <ChevronLeft size={14} aria-hidden="true" />
                  Back
                </button>
              )}
              <button
                type="button"
                onClick={handleNext}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-brand text-on-brand hover:bg-brand-hover transition-colors"
              >
                {currentStep === STEPS.length - 1 ? "Finish" : "Next"}
                {currentStep < STEPS.length - 1 && (
                  <ChevronRight size={14} aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
