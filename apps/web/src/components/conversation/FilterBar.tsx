/**
 * FilterBar — Query filter chips bar (FR-003/FR-004).
 * Shows active filters with removal, org unit dropdown, case ref, date range, language.
 */

import { useState } from "react";
import { X, SlidersHorizontal, Calendar, Globe, Building2, FileSearch } from "lucide-react";

export interface QueryFilters {
  categories?: string[];
  document_ids?: string[];
  date_from?: string;
  date_to?: string;
  org_unit_id?: string;
  case_reference?: string;
  fir_number?: string;
  station_code?: string;
  language?: string;
  sensitivity_levels?: string[];
}

interface FilterBarProps {
  filters: QueryFilters;
  onChange: (filters: QueryFilters) => void;
}

export function FilterBar({ filters, onChange }: FilterBarProps) {
  const [expanded, setExpanded] = useState(false);

  const activeCount = Object.values(filters).filter(
    (v) => v !== undefined && v !== "" && (!Array.isArray(v) || v.length > 0)
  ).length;

  const removeFilter = (key: keyof QueryFilters) => {
    const next = { ...filters };
    delete next[key];
    onChange(next);
  };

  const updateFilter = <K extends keyof QueryFilters>(key: K, value: QueryFilters[K]) => {
    onChange({ ...filters, [key]: value || undefined });
  };

  return (
    <div className="space-y-2">
      {/* Active filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-2 rounded-lg border transition-colors min-h-[2.75rem] ${
            activeCount > 0
              ? "border-primary-300 surface-brand-soft text-primary-700"
              : "border-border-primary text-text-secondary hover:bg-surface-secondary"
          }`}
          aria-label="Toggle filters"
        >
          <SlidersHorizontal size={12} aria-hidden="true" />
          Filters{activeCount > 0 ? ` (${activeCount})` : ""}
        </button>

        {filters.case_reference && (
          <FilterChip label={`Case: ${filters.case_reference}`} onRemove={() => removeFilter("case_reference")} />
        )}
        {filters.fir_number && (
          <FilterChip label={`FIR: ${filters.fir_number}`} onRemove={() => removeFilter("fir_number")} />
        )}
        {filters.station_code && (
          <FilterChip label={`Station: ${filters.station_code}`} onRemove={() => removeFilter("station_code")} />
        )}
        {filters.org_unit_id && (
          <FilterChip label={`Org Unit: ${filters.org_unit_id}`} onRemove={() => removeFilter("org_unit_id")} />
        )}
        {filters.language && (
          <FilterChip label={`Lang: ${filters.language}`} onRemove={() => removeFilter("language")} />
        )}
        {filters.date_from && (
          <FilterChip label={`From: ${filters.date_from}`} onRemove={() => removeFilter("date_from")} />
        )}
        {filters.date_to && (
          <FilterChip label={`To: ${filters.date_to}`} onRemove={() => removeFilter("date_to")} />
        )}
        {filters.sensitivity_levels && filters.sensitivity_levels.length > 0 && (
          <FilterChip
            label={`Sensitivity: ${filters.sensitivity_levels.join(", ")}`}
            onRemove={() => removeFilter("sensitivity_levels")}
          />
        )}

        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => onChange({})}
            className="text-xs text-text-tertiary hover:text-text-primary"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Expanded filter inputs */}
      {expanded && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-3 bg-surface-secondary rounded-lg border border-border-primary">
          <div>
            <label className="text-xs text-text-secondary mb-1 flex items-center gap-1">
              <FileSearch size={10} aria-hidden="true" /> Case Reference
            </label>
            <input
              type="text"
              value={filters.case_reference || ""}
              onChange={(e) => updateFilter("case_reference", e.target.value)}
              placeholder="e.g. Case/2024/001"
              className="w-full text-xs px-2 py-1.5 border border-border-primary rounded bg-surface-primary text-text-primary focus:ring-1 focus:ring-primary-500 outline-none"
            />
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1 flex items-center gap-1">
              <FileSearch size={10} aria-hidden="true" /> FIR Number
            </label>
            <input
              type="text"
              value={filters.fir_number || ""}
              onChange={(e) => updateFilter("fir_number", e.target.value)}
              placeholder="e.g. FIR/123/2024"
              className="w-full text-xs px-2 py-1.5 border border-border-primary rounded bg-surface-primary text-text-primary focus:ring-1 focus:ring-primary-500 outline-none"
            />
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1 flex items-center gap-1">
              <Building2 size={10} aria-hidden="true" /> Station Code
            </label>
            <input
              type="text"
              value={filters.station_code || ""}
              onChange={(e) => updateFilter("station_code", e.target.value)}
              placeholder="e.g. PS-NORTH-01"
              className="w-full text-xs px-2 py-1.5 border border-border-primary rounded bg-surface-primary text-text-primary focus:ring-1 focus:ring-primary-500 outline-none"
            />
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1 flex items-center gap-1">
              <Globe size={10} aria-hidden="true" /> Language
            </label>
            <select
              value={filters.language || ""}
              onChange={(e) => updateFilter("language", e.target.value)}
              className="w-full text-xs px-2 py-1.5 border border-border-primary rounded bg-surface-primary text-text-primary focus:ring-1 focus:ring-primary-500 outline-none"
            >
              <option value="">All languages</option>
              <option value="en">English</option>
              <option value="hi">Hindi</option>
              <option value="mr">Marathi</option>
              <option value="ta">Tamil</option>
              <option value="te">Telugu</option>
              <option value="bn">Bengali</option>
              <option value="gu">Gujarati</option>
              <option value="kn">Kannada</option>
              <option value="ml">Malayalam</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1 flex items-center gap-1">
              <Calendar size={10} aria-hidden="true" /> From Date
            </label>
            <input
              type="date"
              value={filters.date_from || ""}
              onChange={(e) => updateFilter("date_from", e.target.value)}
              className="w-full text-xs px-2 py-1.5 border border-border-primary rounded bg-surface-primary text-text-primary focus:ring-1 focus:ring-primary-500 outline-none"
            />
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1 flex items-center gap-1">
              <Calendar size={10} aria-hidden="true" /> To Date
            </label>
            <input
              type="date"
              value={filters.date_to || ""}
              onChange={(e) => updateFilter("date_to", e.target.value)}
              className="w-full text-xs px-2 py-1.5 border border-border-primary rounded bg-surface-primary text-text-primary focus:ring-1 focus:ring-primary-500 outline-none"
            />
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1 flex items-center gap-1">
              <Building2 size={10} aria-hidden="true" /> Org Unit
            </label>
            <input
              type="text"
              value={filters.org_unit_id || ""}
              onChange={(e) => updateFilter("org_unit_id", e.target.value)}
              placeholder="Org unit ID"
              className="w-full text-xs px-2 py-1.5 border border-border-primary rounded bg-surface-primary text-text-primary focus:ring-1 focus:ring-primary-500 outline-none"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 surface-brand-soft text-primary-700 rounded-full min-h-[2.75rem]">
      {label}
      <button type="button" onClick={onRemove} className="hover-text-brand p-1 min-w-[1.75rem] min-h-[1.75rem] flex items-center justify-center" aria-label={`Remove filter: ${label}`}>
        <X size={12} aria-hidden="true" />
      </button>
    </span>
  );
}
