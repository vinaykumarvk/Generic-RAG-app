import type { WikiSelectorFilters } from "./wiki-selector";
import type { JudgmentSearchFilters } from "./judgment-filters";

export type JudgmentQueryProfile =
  | "case_specific"
  | "district_analytics"
  | "doctrine"
  | "pattern_analysis"
  | "officer_lesson"
  | "precedent_trace"
  | "comparison";

export type JudgmentQueryRoute = "triad_retrieval" | "district_analytics";

export interface JudgmentQueryPlan {
  profile: JudgmentQueryProfile;
  route: JudgmentQueryRoute;
  confidence: number;
  reasons: string[];
  wikiFilters: WikiSelectorFilters;
  searchFilters: JudgmentSearchFilters;
  analyticsIntent?: "coverage" | "volume" | "outcomes" | "source_performance";
}

export function planJudgmentQuery(
  question: string,
  filters: JudgmentSearchFilters | undefined,
): JudgmentQueryPlan {
  const lower = question.toLowerCase();
  const reasons: string[] = [];
  let profile: JudgmentQueryProfile = "case_specific";
  let route: JudgmentQueryRoute = "triad_retrieval";
  let analyticsIntent: JudgmentQueryPlan["analyticsIntent"];
  let confidence = 0.55;

  if (isDistrictAnalyticsQuestion(lower, filters)) {
    profile = "district_analytics";
    route = "district_analytics";
    analyticsIntent = inferAnalyticsIntent(lower);
    confidence = 0.86;
    reasons.push("district analytics wording");
  } else if (/(compare|versus|vs\.?|difference|between supreme court and|high court and)/i.test(question)) {
    profile = "comparison";
    confidence = 0.8;
    reasons.push("comparison wording");
  } else if (/(most common|trend|pattern|how often|success rate|failure rate|why .* cases|how many)/i.test(question)) {
    profile = "pattern_analysis";
    confidence = 0.8;
    reasons.push("pattern-analysis wording");
  } else if (/(officer|police should|checklist|lesson|best practice|investigating officer|improve)/i.test(question)) {
    profile = "officer_lesson";
    confidence = 0.8;
    reasons.push("officer-learning wording");
  } else if (/(precedent|followed|distinguished|overruled|binding|persuasive|later treatment)/i.test(question)) {
    profile = "precedent_trace";
    confidence = 0.78;
    reasons.push("precedent-trace wording");
  } else if (/(doctrine|principle|what is the law|section 50|legal test|requirement|applies to)/i.test(question)) {
    profile = "doctrine";
    confidence = 0.72;
    reasons.push("doctrine wording");
  }

  if (filters?.documentIds?.length || filters?.judgmentId || filters?.canonical_judgment_id || filters?.case_reference) {
    profile = "case_specific";
    route = "triad_retrieval";
    analyticsIntent = undefined;
    confidence = 0.85;
    reasons.push("explicit source judgment or case filter");
  }

  const inferredStatute = inferStatute(lower);
  const inferredSection = inferSection(lower);
  const inferredIssueTags = inferIssueTags(lower);

  const searchFilters: JudgmentSearchFilters = {
    ...(filters || {}),
    statute: filters?.statute || inferredStatute,
    section: filters?.section || inferredSection,
    court_level: filters?.court_level || inferCourtLevel(lower),
    source_name: filters?.source_name || inferSourceName(lower),
  };

  const wikiFilters: WikiSelectorFilters = {
    court_code: filters?.court_code,
    court_codes: filters?.court_codes,
    statute: filters?.statute || inferredStatute,
    statutes: filters?.statutes,
    section: filters?.section || inferredSection,
    sections: filters?.sections,
    issue_tags: inferredIssueTags,
    outcome: filters?.outcome,
    outcomes: filters?.outcomes,
    court_level: filters?.court_level || inferCourtLevel(lower),
    review_status: profile === "officer_lesson" ? "approved" : undefined,
  };

  return {
    profile,
    route,
    confidence,
    reasons,
    wikiFilters,
    searchFilters,
    analyticsIntent,
  };
}

function isDistrictAnalyticsQuestion(lowerQuestion: string, filters?: JudgmentSearchFilters): boolean {
  const hasDistrictFilter = Boolean(
    filters?.state_code || filters?.district_code || filters?.state || filters?.district ||
    filters?.court_level || filters?.source_name,
  );
  const districtHint = /district court|district-court|trial court|sessions court|magistrate|cnr|ecourts|e-courts|ddl|hldc|indian kanoon|metadata|district metadata|text coverage|translation coverage|ocr coverage|redaction coverage|source performance|case volume/i.test(lowerQuestion);
  const analyticsHint = /how many|count|counts|volume|trend|dashboard|coverage|rate|percentage|distribution|by district|by state|by court|hit rate|miss rate|queue|quota|pending|disposed|disposition|delay|analytics|cnr list/i.test(lowerQuestion);
  const sourceTextHint = /cite|sample judgment|sample translated|find cases|which cases|source text|what did courts|why did|explain/i.test(lowerQuestion);
  const pureAggregateHint = /which sources|which districts|which court levels|which source|which district|which court level/i.test(lowerQuestion);
  if (sourceTextHint && !pureAggregateHint) return false;
  return analyticsHint && (districtHint || hasDistrictFilter);
}

function inferAnalyticsIntent(lowerQuestion: string): JudgmentQueryPlan["analyticsIntent"] {
  if (/source|hit rate|miss rate|queue|quota|indian kanoon|ecourts|e-courts|hldc|ddl/.test(lowerQuestion)) {
    return "source_performance";
  }
  if (/outcome|disposition|conviction|acquittal|bail|disposed|pending/.test(lowerQuestion)) {
    return "outcomes";
  }
  if (/volume|trend|year|month|filing|registration|decision|delay/.test(lowerQuestion)) {
    return "volume";
  }
  return "coverage";
}

function inferStatute(lowerQuestion: string): string | undefined {
  if (lowerQuestion.includes("ndps")) return "NDPS";
  if (lowerQuestion.includes("pocso")) return "POCSO";
  if (lowerQuestion.includes("ipc")) return "IPC";
  if (lowerQuestion.includes("bns")) return "BNS";
  if (lowerQuestion.includes("crpc")) return "CrPC";
  if (lowerQuestion.includes("bnss")) return "BNSS";
  return undefined;
}

function inferSection(lowerQuestion: string): string | undefined {
  const sectionMatch = lowerQuestion.match(/section\s+([0-9]{1,4}[a-z]?)/i);
  return sectionMatch?.[1];
}

function inferCourtLevel(lowerQuestion: string): string | undefined {
  if (lowerQuestion.includes("sessions court")) return "sessions";
  if (lowerQuestion.includes("magistrate")) return "magistrate";
  if (lowerQuestion.includes("trial court") || lowerQuestion.includes("district court")) return "district";
  return undefined;
}

function inferSourceName(lowerQuestion: string): string | undefined {
  if (lowerQuestion.includes("indian kanoon")) return "indian_kanoon";
  if (lowerQuestion.includes("ecourts") || lowerQuestion.includes("e-courts")) return "ecourts";
  if (lowerQuestion.includes("hldc")) return "hldc";
  if (lowerQuestion.includes("ddl")) return "ddl";
  return undefined;
}

function inferIssueTags(lowerQuestion: string): string[] {
  const tags = new Set<string>();
  if (lowerQuestion.includes("section 50")) tags.add("section_50_ndps");
  if (lowerQuestion.includes("search")) tags.add("search_and_seizure");
  if (lowerQuestion.includes("seizure")) tags.add("search_and_seizure");
  if (lowerQuestion.includes("chain of custody") || lowerQuestion.includes("seal")) tags.add("chain_of_custody");
  if (lowerQuestion.includes("independent witness")) tags.add("independent_witness");
  if (lowerQuestion.includes("fsl") || lowerQuestion.includes("forensic")) tags.add("forensic_evidence");
  if (lowerQuestion.includes("hostile witness")) tags.add("hostile_witness");
  return Array.from(tags);
}
