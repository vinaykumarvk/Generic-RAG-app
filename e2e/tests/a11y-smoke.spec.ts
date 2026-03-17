import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

function formatViolations(violations: { id: string; impact?: string | null; nodes: { target: string[] }[] }[]): string {
  if (violations.length === 0) return "No serious/critical axe violations found.";
  return violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact || "unknown"}) on ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`
    )
    .join("\n");
}

test.describe("Accessibility smoke", () => {
  test("entry screen has no serious or critical WCAG A/AA violations", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();

    const axeScan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blockingViolations = axeScan.violations.filter((v) => v.impact === "serious" || v.impact === "critical");

    expect(blockingViolations, formatViolations(blockingViolations)).toEqual([]);
  });

  test("entry screen supports keyboard focus progression", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");

    const activeElement = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        tagName: active?.tagName || null,
        id: active?.id || null,
      };
    });

    expect(activeElement.tagName).not.toBe("BODY");
  });
});
