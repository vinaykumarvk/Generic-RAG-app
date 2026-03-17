import React, { useState, useEffect, useCallback, useRef } from "react";
import { validateField as runValidation, type ValidationType } from "./validation";
import { PUNJAB_DISTRICTS, INDIAN_STATES } from "./india-data";

/** Fallback English error messages for validation i18n keys */
const VALIDATION_MESSAGES: Record<string, string> = {
  "validation.email": "Enter a valid email address",
  "validation.mobile": "Enter a valid 10-digit mobile number starting with 6-9",
  "validation.aadhaar": "Enter a valid 12-digit Aadhaar number",
  "validation.pan": "Enter a valid PAN (e.g. ABCDE1234F)",
  "validation.pincode": "Enter a valid 6-digit PIN code",
  "validation.name_min": "Must be at least 2 characters with no digits",
};

export interface CitizenProperty {
  property_id: string;
  unique_property_number: string | null;
  property_number: string | null;
  scheme_name: string | null;
  area_sqyd: number | null;
  usage_type: string | null;
  property_type: string | null;
  authority_id: string;
  location: string | null;
  sector: string | null;
  district: string | null;
}

export interface FieldDef {
  key: string;
  label: string;
  label_hi?: string;
  label_pa?: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  readOnly?: boolean;
  ui?: {
    widget?: string;
    options?: { value: string; label: string }[];
    readOnly?: boolean;
    fillFromProperty?: string;
  };
  validations?: any[];
}

export interface FormSection {
  sectionId: string;
  title: string;
  title_hi?: string;
  title_pa?: string;
  fields: FieldDef[];
}

export interface FormPage {
  pageId: string;
  title: string;
  title_hi?: string;
  title_pa?: string;
  sections: FormSection[];
}

export interface FormConfig {
  formId: string;
  version: string;
  pages: FormPage[];
}

interface FormRendererProps {
  config: FormConfig;
  initialData?: any;
  onChange?: (data: any) => void;
  onSubmit?: (data: any) => void;
  readOnly?: boolean;
  unlockedFields?: string[];
  /** Citizen-owned properties for UPN picker auto-population */
  citizenProperties?: CitizenProperty[];
  /** Lookup a property by UPN — returns property details or null if not found */
  onLookupUpn?: (upn: string) => Promise<CitizenProperty | null>;
  pageActions?: Array<{
    pageId: string;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    className?: string;
  }>;
  pageSupplements?: Record<string, React.ReactNode>;
  /** Override the Submit button label on the last page */
  submitLabel?: string;
  /** Disable the Submit button on the last page */
  submitDisabled?: boolean;
  /** Replace the Submit button entirely with custom content on a specific page */
  submitOverride?: React.ReactNode;
  /** Secondary language code for bilingual labels ("hi", "pa", or "none"/undefined) */
  secondaryLanguage?: string;
  /** Extra step tabs appended after form pages (managed externally, e.g. documents step) */
  appendSteps?: Array<{
    id: string;
    title: string;
    title_hi?: string;
    title_pa?: string;
    onClick: () => void;
  }>;
}

export function FormRenderer({
  config,
  initialData = {},
  onChange,
  onSubmit,
  readOnly = false,
  unlockedFields = [],
  citizenProperties = [],
  onLookupUpn,
  pageActions = [],
  pageSupplements = {},
  submitLabel = "Submit",
  submitDisabled = false,
  submitOverride,
  secondaryLanguage,
  appendSteps = [],
}: FormRendererProps) {
  const [data, setData] = useState<any>(initialData);
  const [currentPage, setCurrentPage] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [upnLookupLoading, setUpnLookupLoading] = useState(false);
  const [upnLookupError, setUpnLookupError] = useState<string | null>(null);
  /** Properties discovered via lookup (merged with citizenProperties for display) */
  const [discoveredProperties, setDiscoveredProperties] = useState<CitizenProperty[]>([]);
  /** Whether the user has toggled to manual UPN entry mode */
  const [upnManualMode, setUpnManualMode] = useState(false);
  const pageHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setData(initialData);
  }, [initialData]);

  // Focus the page heading when page changes for screen reader navigation
  useEffect(() => {
    pageHeadingRef.current?.focus();
  }, [currentPage]);

  // Bilingual label helper: renders stacked English + secondary language
  const bilingualText = (primary: string, hi?: string, pa?: string): React.ReactNode => {
    if (!secondaryLanguage || secondaryLanguage === "none") return primary;
    const secondary = secondaryLanguage === "hi" ? hi : secondaryLanguage === "pa" ? pa : undefined;
    if (!secondary || secondary === primary) return primary;
    return (
      <span className="bilingual bilingual--stacked">
        <span className="bilingual__primary">{primary}</span>
        <span className="bilingual__secondary" lang={secondaryLanguage}>{secondary}</span>
      </span>
    );
  };

  // Helper: read a nested dot-key from form data
  const getFieldValue = useCallback((key: string): any => {
    const keys = key.split(".");
    let value = data;
    for (const k of keys) {
      value = value?.[k];
      if (value === undefined) return undefined;
    }
    return value;
  }, [data]);

  // Infer validation type from field definition
  const inferValidationType = useCallback((field: FieldDef): ValidationType | null => {
    if (field.type === "email") return "email";
    if (field.type === "phone") return "mobile";
    if (field.type === "aadhaar") return "aadhaar";
    const k = field.key.toLowerCase();
    if (k.includes("pincode")) return "pincode";
    if (k.endsWith(".pan") || k === "pan") return "pan";
    return null;
  }, []);

  // Helper: validate a single field value
  const validateField = useCallback((field: FieldDef, value: any): string | null => {
    if (field.required && (value === undefined || value === null || value === "")) {
      return `${field.label} is required`;
    }
    if (value) {
      const vType = inferValidationType(field);
      if (vType) {
        const errKey = runValidation(String(value), vType);
        if (errKey) return VALIDATION_MESSAGES[errKey] || errKey;
      }
    }
    return null;
  }, [inferValidationType]);

  // Helper: write a nested dot-key into form data
  const updateField = useCallback((key: string, value: any) => {
    const newData = { ...data };
    const keys = key.split(".");
    let current = newData;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) current[keys[i]] = {};
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
    setData(newData);
    onChange?.(newData);
    if (errors[key]) {
      setErrors((prev) => ({ ...prev, [key]: "" }));
    }
  }, [data, errors, onChange]);

  const handleBlur = useCallback((field: FieldDef) => {
    setTouched((prev) => ({ ...prev, [field.key]: true }));
    const value = getFieldValue(field.key);
    const err = validateField(field, value);
    if (err) {
      setErrors((prev) => ({ ...prev, [field.key]: err }));
    } else {
      setErrors((prev) => { const next = { ...prev }; delete next[field.key]; return next; });
    }
  }, [getFieldValue, validateField]);

  // Merge citizenProperties + discoveredProperties (deduplicate by property_id)
  // NOTE: must be defined before handleUpnSelect which depends on it
  const allProperties = React.useMemo(() => {
    const map = new Map<string, CitizenProperty>();
    for (const p of citizenProperties) map.set(p.property_id, p);
    for (const p of discoveredProperties) map.set(p.property_id, p);
    return Array.from(map.values());
  }, [citizenProperties, discoveredProperties]);

  /**
   * When a UPN is selected from the picker, auto-populate all sibling
   * property.* fields that declare `ui.fillFromProperty`.
   */
  const handleUpnSelect = useCallback((selectedUpn: string) => {
    // Search allProperties (citizenProperties + discovered) so manual-lookup results also auto-fill
    const property = allProperties.find(
      (p) => p.unique_property_number === selectedUpn
    );

    const newData = { ...data };
    const setNested = (key: string, value: any) => {
      const parts = key.split(".");
      let obj = newData;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!obj[parts[i]]) obj[parts[i]] = {};
        obj = obj[parts[i]];
      }
      obj[parts[parts.length - 1]] = value;
    };

    setNested("property.upn", selectedUpn);

    if (property && config?.pages) {
      for (const page of config.pages) {
        for (const section of page.sections) {
          for (const f of section.fields) {
            const fillKey = f.ui?.fillFromProperty;
            if (!fillKey) continue;
            const propValue = (property as any)[fillKey];
            if (propValue !== undefined && propValue !== null) {
              setNested(f.key, propValue);
            }
          }
        }
      }
    }

    setData(newData);
    onChange?.(newData);
  }, [allProperties, data, config?.pages, onChange]);

  /**
   * Handle UPN lookup: call the API, auto-fill form fields, store discovered property.
   */
  const handleUpnLookup = useCallback(async (upn: string) => {
    if (!onLookupUpn || !upn.trim()) return;
    setUpnLookupLoading(true);
    setUpnLookupError(null);
    try {
      const property = await onLookupUpn(upn.trim());
      if (!property) {
        setUpnLookupError("No property found with this UPN");
        return;
      }
      // Store discovered property for summary display
      setDiscoveredProperties((prev) => {
        if (prev.some((p) => p.property_id === property.property_id)) return prev;
        return [...prev, property];
      });
      // Auto-fill form fields via the same handleUpnSelect logic but using the looked-up property
      const newData = { ...data };
      const setNested = (key: string, value: any) => {
        const parts = key.split(".");
        let obj = newData;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!obj[parts[i]]) obj[parts[i]] = {};
          obj = obj[parts[i]];
        }
        obj[parts[parts.length - 1]] = value;
      };
      setNested("property.upn", upn.trim());
      if (config?.pages) {
        for (const page of config.pages) {
          for (const section of page.sections) {
            for (const f of section.fields) {
              const fillKey = f.ui?.fillFromProperty;
              if (!fillKey) continue;
              const propValue = (property as any)[fillKey];
              if (propValue !== undefined && propValue !== null) {
                setNested(f.key, propValue);
              }
            }
          }
        }
      }
      setData(newData);
      onChange?.(newData);
    } catch {
      setUpnLookupError("Failed to look up property. Please try again.");
    } finally {
      setUpnLookupLoading(false);
    }
  }, [onLookupUpn, data, config?.pages, onChange]);

  // Guard: config must have at least one page
  if (!config?.pages?.length) {
    return <p className="form-renderer-error">Form configuration is invalid (no pages defined).</p>;
  }

  const validatePage = (): boolean => {
    const page = config.pages[currentPage];
    const newErrors: Record<string, string> = {};
    let isValid = true;

    page.sections.forEach((section) => {
      section.fields.forEach((field) => {
        const value = getFieldValue(field.key);
        const error = validateField(field, value);
        if (error) {
          newErrors[field.key] = error;
          isValid = false;
        }
      });
    });

    setErrors(newErrors);
    return isValid;
  };

  const isFieldEditable = (field: FieldDef): boolean => {
    if (field.key?.startsWith("applicant.")) return false;
    if (field.key?.startsWith("address.permanent.")) return false;
    if (field.key?.startsWith("address.communication.")) return false;
    if (field.readOnly || field.ui?.readOnly) return false;
    if (readOnly) {
      return unlockedFields.includes(field.key);
    }
    return true;
  };

  const renderField = (field: FieldDef) => {
    const value = getFieldValue(field.key);
    const editable = isFieldEditable(field);
    const error = errors[field.key];

    const fieldId = `fr-${field.key.replace(/\./g, "-")}`;
    const errorId = error ? `${fieldId}-err` : undefined;
    const blurHandler = () => handleBlur(field);
    const ariaProps = { id: fieldId, "aria-invalid": error ? true as const : undefined, "aria-describedby": errorId };

    switch (field.type) {
      case "string":
      case "text":
      case "textarea":
        if (field.type === "string" && field.ui?.widget === "upn-picker") {
          const knownProps = allProperties.filter((p) => p.unique_property_number && p.scheme_name);
          const selectedProp = allProperties.find((x) => x.unique_property_number === value);
          const showDropdown = knownProps.length > 0 && !upnManualMode;
          const showManualInput = knownProps.length === 0 || upnManualMode;
          return (
            <div key={field.key} className="field upn-picker-field">
              <label htmlFor={fieldId}>
                {bilingualText(field.label, field.label_hi, field.label_pa)}
                {field.required && <span className="required">*</span>}
              </label>
              {showDropdown && (
                <>
                  <select
                    {...ariaProps}
                    value={value || ""}
                    onChange={(e) => {
                      if (e.target.value) {
                        handleUpnSelect(e.target.value);
                        setUpnLookupError(null);
                      }
                    }}
                    onBlur={blurHandler}
                    disabled={!editable}
                    className={`upn-picker-select${error ? " error" : ""}`}
                  >
                    <option value="">— Select your property (UPN) —</option>
                    {knownProps.map((p) => {
                      const upn = p.unique_property_number || "";
                      const label = [
                        upn,
                        p.scheme_name,
                        p.property_type,
                        p.area_sqyd ? `${p.area_sqyd} sq.yd` : null,
                      ].filter(Boolean).join(" · ");
                      return <option key={upn} value={upn}>{label}</option>;
                    })}
                  </select>
                  {onLookupUpn && (
                    <button
                      type="button"
                      className="upn-manual-toggle"
                      onClick={() => setUpnManualMode(true)}
                    >
                      Property not listed? Enter UPN manually
                    </button>
                  )}
                </>
              )}
              {showManualInput && (
                <>
                  {knownProps.length > 0 && (
                    <button
                      type="button"
                      className="upn-manual-toggle"
                      onClick={() => { setUpnManualMode(false); setUpnLookupError(null); }}
                    >
                      ← Back to property list
                    </button>
                  )}
                  <div className="upn-picker-input-row">
                    <input
                      {...ariaProps}
                      type="text"
                      value={value || ""}
                      onChange={(e) => {
                        updateField(field.key, e.target.value);
                        if (upnLookupError) setUpnLookupError(null);
                      }}
                      onBlur={blurHandler}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (value && !selectedProp) handleUpnLookup(value);
                        }
                      }}
                      placeholder="e.g. PB-140-001-003-002301"
                      disabled={!editable}
                      className={error ? "error" : ""}
                    />
                    {onLookupUpn && (
                      <button
                        type="button"
                        className="upn-fetch-btn"
                        disabled={!editable || !value || upnLookupLoading}
                        onClick={() => value && handleUpnLookup(value)}
                      >
                        {upnLookupLoading ? "Fetching..." : "Fetch Details"}
                      </button>
                    )}
                  </div>
                  {upnLookupError && <span className="error-message" role="alert">{upnLookupError}</span>}
                </>
              )}
              {error && <span id={errorId} className="error-message" role="alert">{error}</span>}
              {selectedProp && (
                <div className="upn-selected-summary">
                  <dl className="property-summary">
                    {selectedProp.scheme_name && <><dt>Scheme</dt><dd>{selectedProp.scheme_name}</dd></>}
                    {selectedProp.property_number && <><dt>Plot No.</dt><dd>{selectedProp.property_number}</dd></>}
                    {selectedProp.area_sqyd && <><dt>Area</dt><dd>{selectedProp.area_sqyd} sq.yd</dd></>}
                    {selectedProp.usage_type && <><dt>Type</dt><dd>{selectedProp.usage_type}</dd></>}
                    {selectedProp.district && <><dt>District</dt><dd>{selectedProp.district}</dd></>}
                  </dl>
                </div>
              )}
            </div>
          );
        }
        // Render district/state dropdowns only when schema explicitly opts in via ui.widget
        if (field.type === "string" && !field.readOnly && !field.ui?.readOnly) {
          const widget = field.ui?.widget;
          const isDistrict = widget === "district-select";
          const isState = widget === "state-select";
          if (isDistrict || isState) {
            const options = isDistrict ? PUNJAB_DISTRICTS : INDIAN_STATES;
            return (
              <div key={field.key} className="field">
                <label htmlFor={fieldId}>
                  {bilingualText(field.label, field.label_hi, field.label_pa)}
                  {field.required && <span className="required">*</span>}
                </label>
                <select
                  {...ariaProps}
                  value={value || ""}
                  onChange={(e) => updateField(field.key, e.target.value)}
                  onBlur={blurHandler}
                  disabled={!editable}
                  className={error ? "error" : ""}
                >
                  <option value="">Select...</option>
                  {options.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
                {error && <span id={errorId} className="error-message" role="alert">{error}</span>}
              </div>
            );
          }
        }
        return (
          <div key={field.key} className="field">
            <label htmlFor={fieldId}>
              {bilingualText(field.label, field.label_hi, field.label_pa)}
              {field.required && <span className="required">*</span>}
            </label>
            {(field.type === "text" || field.type === "textarea") ? (
              <textarea
                {...ariaProps}
                value={value || ""}
                onChange={(e) => updateField(field.key, e.target.value)}
                onBlur={blurHandler}
                placeholder={field.placeholder}
                disabled={!editable}
                className={error ? "error" : ""}
              />
            ) : (
              <input
                {...ariaProps}
                type="text"
                value={value || ""}
                onChange={(e) => updateField(field.key, e.target.value)}
                onBlur={blurHandler}
                placeholder={field.placeholder || (field.ui?.widget === "upn-picker" ? "e.g. PB-140-001-003-002301" : undefined)}
                disabled={!editable}
                className={error ? "error" : ""}
              />
            )}
            {error && <span id={errorId} className="error-message" role="alert">{error}</span>}
          </div>
        );

      case "number":
        return (
          <div key={field.key} className="field">
            <label htmlFor={fieldId}>
              {bilingualText(field.label, field.label_hi, field.label_pa)}
              {field.required && <span className="required">*</span>}
            </label>
            <input
              {...ariaProps}
              type="number"
              inputMode="decimal"
              value={value ?? ""}
              onChange={(e) => {
                if (e.target.value === "") {
                  updateField(field.key, undefined);
                } else {
                  updateField(field.key, parseFloat(e.target.value));
                }
              }}
              onBlur={blurHandler}
              placeholder={field.placeholder}
              disabled={!editable}
              className={error ? "error" : ""}
            />
            {error && <span id={errorId} className="error-message" role="alert">{error}</span>}
          </div>
        );

      case "date":
        return (
          <div key={field.key} className="field">
            <label htmlFor={fieldId}>
              {bilingualText(field.label, field.label_hi, field.label_pa)}
              {field.required && <span className="required">*</span>}
            </label>
            <input
              {...ariaProps}
              type="date"
              value={value || ""}
              onChange={(e) => updateField(field.key, e.target.value)}
              onBlur={blurHandler}
              placeholder={field.placeholder}
              disabled={!editable}
              className={error ? "error" : ""}
            />
            {error && <span id={errorId} className="error-message" role="alert">{error}</span>}
          </div>
        );

      case "email":
        return (
          <div key={field.key} className="field">
            <label htmlFor={fieldId}>
              {bilingualText(field.label, field.label_hi, field.label_pa)}
              {field.required && <span className="required">*</span>}
            </label>
            <input
              {...ariaProps}
              type="email"
              value={value || ""}
              onChange={(e) => updateField(field.key, e.target.value)}
              onBlur={blurHandler}
              placeholder={field.placeholder}
              disabled={!editable}
              className={error ? "error" : ""}
            />
            {error && <span id={errorId} className="error-message" role="alert">{error}</span>}
          </div>
        );

      case "phone":
        return (
          <div key={field.key} className="field">
            <label htmlFor={fieldId}>
              {bilingualText(field.label, field.label_hi, field.label_pa)}
              {field.required && <span className="required">*</span>}
            </label>
            <div className="phone-input-row">
              <span className="phone-prefix" aria-hidden="true">+91</span>
              <input
                {...ariaProps}
                type="tel"
                inputMode="numeric"
                value={value || ""}
                onChange={(e) => updateField(field.key, e.target.value.replace(/\D/g, "").slice(0, 10))}
                onBlur={blurHandler}
                placeholder={field.placeholder || "10-digit mobile"}
                disabled={!editable}
                className={error ? "error" : ""}
                maxLength={10}
              />
            </div>
            {error && <span id={errorId} className="error-message" role="alert">{error}</span>}
          </div>
        );

      case "aadhaar":
        return (
          <div key={field.key} className="field">
            <label htmlFor={fieldId}>
              {bilingualText(field.label, field.label_hi, field.label_pa)}
              {field.required && <span className="required">*</span>}
            </label>
            <input
              {...ariaProps}
              type="text"
              inputMode="numeric"
              pattern="\\d{12}"
              value={value || ""}
              onChange={(e) => updateField(field.key, e.target.value)}
              onBlur={blurHandler}
              placeholder={field.placeholder}
              disabled={!editable}
              className={error ? "error" : ""}
            />
            {error && <span id={errorId} className="error-message" role="alert">{error}</span>}
          </div>
        );

      case "boolean":
        return (
          <div key={field.key} className="field">
            <label>
              <input
                type="checkbox"
                checked={value || false}
                onChange={(e) => updateField(field.key, e.target.checked)}
                onBlur={blurHandler}
                disabled={!editable}
                {...ariaProps}
              />
              {bilingualText(field.label, field.label_hi, field.label_pa)}
              {field.required && <span className="required">*</span>}
            </label>
            {error && <span id={errorId} className="error-message" role="alert">{error}</span>}
          </div>
        );

      case "enum":
        return (
          <div key={field.key} className="field">
            <label htmlFor={fieldId}>
              {bilingualText(field.label, field.label_hi, field.label_pa)}
              {field.required && <span className="required">*</span>}
            </label>
            <select
              {...ariaProps}
              value={value || ""}
              onChange={(e) => updateField(field.key, e.target.value)}
              onBlur={blurHandler}
              disabled={!editable}
              className={error ? "error" : ""}
            >
              <option value="">Select...</option>
              {field.ui?.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {error && <span id={errorId} className="error-message" role="alert">{error}</span>}
          </div>
        );

      default:
        return null;
    }
  };

  const currentPageConfig = config.pages[currentPage];
  const isLastPage = currentPage === config.pages.length - 1;
  const currentPageAction = pageActions.find((action) => action.pageId === currentPageConfig.pageId);

  const totalPages = config.pages.length + appendSteps.length;

  return (
    <div className="form-renderer">
      {totalPages > 1 && (
        <div className="form-progress" role="progressbar" aria-valuenow={currentPage + 1} aria-valuemin={1} aria-valuemax={totalPages} aria-label={`Step ${currentPage + 1} of ${totalPages}`}>
          <div className="form-progress__label">Step {currentPage + 1} of {totalPages}</div>
          <div className="form-progress__track">
            <div className="form-progress__fill" style={{ width: `${((currentPage + 1) / totalPages) * 100}%` }} />
          </div>
        </div>
      )}
      <div className="form-pages">
        {config.pages.map((page, idx) => (
          <button
            key={page.pageId}
            type="button"
            onClick={() => setCurrentPage(idx)}
            className={idx === currentPage ? "active" : idx < currentPage ? "completed" : ""}
            aria-current={idx === currentPage ? "step" : undefined}
          >
            {idx < currentPage && <span aria-hidden="true">&#10003; </span>}
            {bilingualText(page.title, page.title_hi, page.title_pa)}
          </button>
        ))}
        {appendSteps.map((step) => (
          <button
            key={step.id}
            type="button"
            onClick={step.onClick}
            className=""
          >
            {bilingualText(step.title, step.title_hi, step.title_pa)}
          </button>
        ))}
      </div>

      {Object.keys(errors).filter((k) => errors[k]).length > 0 && (
        <div role="alert" aria-live="assertive" className="form-validation-summary">
          Please fix {Object.keys(errors).filter((k) => errors[k]).length} error{Object.keys(errors).filter((k) => errors[k]).length > 1 ? "s" : ""} before continuing.
        </div>
      )}

      <div className="form-page">
        <h2 ref={pageHeadingRef} tabIndex={-1}>{bilingualText(currentPageConfig.title, currentPageConfig.title_hi, currentPageConfig.title_pa)}</h2>
        {currentPageConfig.sections.map((section) => (
          <div key={section.sectionId} className="form-section">
            <h3>{bilingualText(section.title, section.title_hi, section.title_pa)}</h3>
            {section.fields.map((field) => renderField(field))}
          </div>
        ))}
        {pageSupplements[currentPageConfig.pageId] ? (
          <div className="form-page-supplement">{pageSupplements[currentPageConfig.pageId]}</div>
        ) : null}
      </div>

      <div className="form-actions">
        <div className="form-actions__left">
          {currentPage > 0 && (
            <button type="button" onClick={() => setCurrentPage(currentPage - 1)} className="form-action-btn">
              Previous
            </button>
          )}
        </div>
        <div className="form-actions__right">
          {currentPageAction ? (
            <button
              type="button"
              onClick={currentPageAction.onClick}
              disabled={currentPageAction.disabled}
              className={`form-action-btn form-action-btn--secondary ${currentPageAction.className || ""}`.trim()}
            >
              {currentPageAction.label}
            </button>
          ) : null}
          {!isLastPage ? (
            <button
              type="button"
              className="form-action-btn form-action-btn--primary"
              onClick={() => {
                if (validatePage()) {
                  setCurrentPage(currentPage + 1);
                }
              }}
            >
              Next
            </button>
          ) : submitOverride != null ? (
            <>{submitOverride}</>
          ) : (
            <button
              type="button"
              className="form-action-btn form-action-btn--primary"
              disabled={submitDisabled}
              onClick={() => {
                if (!submitDisabled && validatePage()) {
                  onSubmit?.(data);
                }
              }}
            >
              {submitLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
