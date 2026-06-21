import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Calendar, ChevronDown, Download, RefreshCw, X } from "lucide-react";
import { DistrictSourceDashboard } from "@/components/admin/DistrictSourceDashboard";
import { DistrictCaseDrilldown } from "@/components/analytics/DistrictCaseDrilldown";
import { DistrictCaseVolumeChart } from "@/components/analytics/DistrictCaseVolumeChart";
import { DistrictCoveragePanel } from "@/components/analytics/DistrictCoveragePanel";
import { DistrictOutcomeChart } from "@/components/analytics/DistrictOutcomeChart";
import { apiFetch, apiPost, buildApiUrl } from "@/lib/api";

interface FilterOption {
  value: string;
  label: string;
  count?: number;
  state_code?: number;
}

interface DistrictFilterOptions {
  states: FilterOption[];
  districts: FilterOption[];
  court_levels: FilterOption[];
  statutes: FilterOption[];
  sections: FilterOption[];
  offence_categories: FilterOption[];
  dispositions: FilterOption[];
  languages: FilterOption[];
  sources: FilterOption[];
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function appendAll(params: URLSearchParams, key: string, values: string[]) {
  values.forEach((value) => params.append(key, value));
}

export function DistrictAnalyticsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const queryClient = useQueryClient();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState(todayStr());
  const [stateCodes, setStateCodes] = useState<string[]>([]);
  const [districtKeys, setDistrictKeys] = useState<string[]>([]);
  const [courtLevels, setCourtLevels] = useState<string[]>([]);
  const [statutes, setStatutes] = useState<string[]>([]);
  const [sections, setSections] = useState<string[]>([]);
  const [offenceCategories, setOffenceCategories] = useState<string[]>([]);
  const [dispositions, setDispositions] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [commercialSafe, setCommercialSafe] = useState(true);
  const [bucket, setBucket] = useState<"month" | "day" | "year">("month");

  const { data: filterOptions } = useQuery({
    queryKey: ["district-filter-options", workspaceId],
    queryFn: () => apiFetch<DistrictFilterOptions>(`/api/v1/workspaces/${workspaceId}/district/analytics/filter-options`),
    enabled: !!workspaceId,
  });

  const visibleDistrictOptions = useMemo(() => {
    const districts = filterOptions?.districts || [];
    if (!stateCodes.length) return districts;
    const selectedStates = new Set(stateCodes.map((value) => Number(value)));
    return districts.filter((option) => selectedStates.has(Number(option.state_code)));
  }, [filterOptions?.districts, stateCodes]);

  useEffect(() => {
    if (!stateCodes.length) return;
    const visibleValues = new Set(visibleDistrictOptions.map((option) => option.value));
    setDistrictKeys((current) => current.filter((value) => visibleValues.has(value)));
  }, [stateCodes, visibleDistrictOptions]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    appendAll(params, "state_code", stateCodes);
    appendAll(params, "district_key", districtKeys);
    appendAll(params, "court_level", courtLevels);
    appendAll(params, "statute", statutes);
    appendAll(params, "section", sections);
    appendAll(params, "offence_category", offenceCategories);
    appendAll(params, "disposition", dispositions);
    appendAll(params, "language", languages);
    appendAll(params, "source_name", sources);
    if (!commercialSafe) params.set("commercial_safe", "false");
    params.set("bucket", bucket);
    return params.toString();
  }, [bucket, commercialSafe, courtLevels, dateFrom, dateTo, districtKeys, dispositions, languages, offenceCategories, sections, sources, stateCodes, statutes]);

  const refreshMutation = useMutation({
    mutationFn: () => apiPost(`/api/v1/workspaces/${workspaceId}/district/analytics/refresh`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["district-analytics-summary", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["district-analytics-coverage", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["district-analytics-volume", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["district-analytics-outcomes", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["district-source-performance", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["district-cases", workspaceId] });
    },
  });

  if (!workspaceId) return null;

  const analyticsCsvUrl = buildApiUrl(`/api/v1/workspaces/${workspaceId}/district/analytics/export.csv?${queryString}`);
  const cnrCsvUrl = buildApiUrl(`/api/v1/workspaces/${workspaceId}/district/analytics/cnrs.csv?${queryString}`);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-skin-base">District Analytics</h2>
          <p className="text-skin-muted text-sm mt-1">District-court metadata, source coverage, translation, and text readiness</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-skin bg-surface text-skin-base hover:bg-surface-alt disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshMutation.isPending ? "animate-spin" : ""} aria-hidden="true" />
            Refresh
          </button>
          <a
            href={analyticsCsvUrl}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-skin bg-surface text-skin-base hover:bg-surface-alt"
          >
            <Download size={14} aria-hidden="true" />
            Analytics CSV
          </a>
          <a
            href={cnrCsvUrl}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-skin bg-surface text-skin-base hover:bg-surface-alt"
          >
            <Download size={14} aria-hidden="true" />
            CNR CSV
          </a>
        </div>
      </div>

      <section className="bg-surface border border-skin rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
          <label className="space-y-1">
            <span className="text-xs font-medium text-skin-muted">From</span>
            <div className="relative">
              <Calendar size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-skin-muted" aria-hidden="true" />
              <input type="date" value={dateFrom} max={dateTo} onChange={(event) => setDateFrom(event.target.value)} className="w-full pl-8 pr-2 py-2 text-sm rounded-lg border border-skin bg-surface text-skin-base" />
            </div>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-skin-muted">To</span>
            <input type="date" value={dateTo} min={dateFrom} max={todayStr()} onChange={(event) => setDateTo(event.target.value)} className="w-full px-2 py-2 text-sm rounded-lg border border-skin bg-surface text-skin-base" />
          </label>
          <MultiSelect label="State" options={filterOptions?.states || []} selected={stateCodes} onChange={setStateCodes} placeholder="All states" />
          <MultiSelect label="District" options={visibleDistrictOptions} selected={districtKeys} onChange={setDistrictKeys} placeholder="All districts" />
          <MultiSelect label="Court Level" options={filterOptions?.court_levels || []} selected={courtLevels} onChange={setCourtLevels} placeholder="All courts" />
          <label className="space-y-1">
            <span className="text-xs font-medium text-skin-muted">Bucket</span>
            <select value={bucket} onChange={(event) => setBucket(event.target.value as "month" | "day" | "year")} className="w-full px-2 py-2 text-sm rounded-lg border border-skin bg-surface text-skin-base">
              <option value="month">Month</option>
              <option value="day">Day</option>
              <option value="year">Year</option>
            </select>
          </label>
          <MultiSelect label="Statute" options={filterOptions?.statutes || []} selected={statutes} onChange={setStatutes} placeholder="All statutes" />
          <MultiSelect label="Section" options={filterOptions?.sections || []} selected={sections} onChange={setSections} placeholder="All sections" />
          <MultiSelect label="Offence" options={filterOptions?.offence_categories || []} selected={offenceCategories} onChange={setOffenceCategories} placeholder="All offences" />
          <MultiSelect label="Disposition" options={filterOptions?.dispositions || []} selected={dispositions} onChange={setDispositions} placeholder="All outcomes" />
          <MultiSelect label="Language" options={filterOptions?.languages || []} selected={languages} onChange={setLanguages} placeholder="All languages" />
          <MultiSelect label="Source" options={filterOptions?.sources || []} selected={sources} onChange={setSources} placeholder="All sources" />
          <label className="flex items-end gap-2 pb-2 text-sm text-skin-base">
            <input type="checkbox" checked={commercialSafe} onChange={(event) => setCommercialSafe(event.target.checked)} className="h-4 w-4 rounded border-skin" />
            Commercial-safe only
          </label>
        </div>
      </section>

      <DistrictCoveragePanel workspaceId={workspaceId} queryString={queryString} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <DistrictCaseVolumeChart workspaceId={workspaceId} queryString={queryString} />
        <DistrictOutcomeChart workspaceId={workspaceId} queryString={queryString} />
      </div>

      <DistrictSourceDashboard workspaceId={workspaceId} queryString={queryString} />
      <DistrictCaseDrilldown workspaceId={workspaceId} queryString={queryString} />
    </div>
  );
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
  placeholder,
}: {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (value: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedOptions = options.filter((option) => selected.includes(option.value));
  const buttonLabel = selectedOptions.length === 0
    ? placeholder
    : selectedOptions.length <= 2
      ? selectedOptions.map((option) => option.label).join(", ")
      : `${selectedOptions.length} selected`;

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  }

  return (
    <div ref={rootRef} className="space-y-1 relative">
      <span className="text-xs font-medium text-skin-muted">{label}</span>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="w-full px-2 py-2 text-sm rounded-lg border border-skin bg-surface text-skin-base flex items-center justify-between gap-2"
      >
        <span className={selectedOptions.length ? "truncate" : "truncate text-skin-muted"}>{buttonLabel}</span>
        <ChevronDown size={14} className={`shrink-0 text-skin-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[18rem] rounded-lg border border-skin bg-surface shadow-lg p-2">
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-skin">
            <span className="text-xs text-skin-muted">{selected.length} of {options.length} selected</span>
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={!selected.length}
              className="inline-flex items-center gap-1 text-xs text-skin-muted hover:text-skin-base disabled:opacity-40"
            >
              <X size={12} aria-hidden="true" />
              Clear
            </button>
          </div>
          <div className="max-h-64 overflow-auto py-1">
            {options.map((option) => (
              <label key={option.value} className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-surface-alt text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(option.value)}
                  onChange={() => toggle(option.value)}
                  className="mt-0.5 h-4 w-4 rounded border-skin"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-skin-base truncate">{option.label}</span>
                  {option.count != null && <span className="block text-[11px] text-skin-muted">{option.count} cases</span>}
                </span>
              </label>
            ))}
            {options.length === 0 && <div className="px-2 py-3 text-sm text-skin-muted">No options available.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
