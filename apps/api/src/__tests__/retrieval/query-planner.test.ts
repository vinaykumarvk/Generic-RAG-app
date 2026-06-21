import { describe, expect, it } from "vitest";
import { planJudgmentQuery } from "../../retrieval/query-planner";

describe("planJudgmentQuery", () => {
  it("classifies doctrine queries and infers NDPS Section 50 filters", () => {
    const plan = planJudgmentQuery("What is the doctrine on NDPS Section 50 personal search?", undefined);

    expect(plan.profile).toBe("doctrine");
    expect(plan.route).toBe("triad_retrieval");
    expect(plan.searchFilters.statute).toBe("NDPS");
    expect(plan.searchFilters.section).toBe("50");
    expect(plan.wikiFilters.issue_tags).toContain("section_50_ndps");
  });

  it("keeps explicit source judgment filters case-specific", () => {
    const plan = planJudgmentQuery("Why did the appeal fail?", {
      judgmentId: "sci:2024:ndps",
    });

    expect(plan.profile).toBe("case_specific");
    expect(plan.route).toBe("triad_retrieval");
    expect(plan.confidence).toBeGreaterThan(0.8);
  });

  it("routes district metadata aggregate questions to district analytics", () => {
    const plan = planJudgmentQuery("How many district court POCSO cases have text coverage by district?", {
      state_code: 9,
    });

    expect(plan.profile).toBe("district_analytics");
    expect(plan.route).toBe("district_analytics");
    expect(plan.analyticsIntent).toBe("coverage");
    expect(plan.searchFilters.statute).toBe("POCSO");
    expect(plan.searchFilters.state_code).toBe(9);
  });
});
