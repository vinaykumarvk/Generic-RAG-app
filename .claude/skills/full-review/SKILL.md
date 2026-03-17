---
name: full-review
description: Run vibe-coding-guardrails, four domain review skills (UI, quality, security, infra), then sanity-check, then fix all issues found until every finding is resolved. Produces a consolidated report with an aggregate verdict.
argument-hint: "[target] [options]"
user_invocable: true
---

# Full Review Playbook

Run a comprehensive review cycle: fast guardrails pre-check, four domain reviews, cross-domain sanity-check, remediation, and re-verification.

## Scoping

If the user specifies a target (example: `/full-review social-media-api`), pass that scope to each review skill. Otherwise review the entire project.

Generate a safe output slug from the target: replace `/` with `-`, remove spaces. Example: `apps/dopams-ui` becomes `apps-dopams-ui`. If no target, use `full-repo`.

Options the user may append:
- `critical-only` -- only fix CRITICAL findings
- `high+` -- fix HIGH and CRITICAL findings (default)
- `all` -- fix all findings including LOW and MEDIUM
- `no-fix` -- produce reports only, skip remediation
- `no-commit` -- fix but do not commit

## Conditional Skip Logic

Before launching reviews, inspect the target to determine which reviews apply:

- If the target is a backend API app (no `src/*.tsx` files), skip `/ui-review`. Check with: `ls {target}/src/*.tsx 2>/dev/null | head -1`.
- If the target is a frontend-only app (no database migrations, no API routes), skip `/infra-review` database and migration phases.
- All four reviews run by default for full-repo scope.

### Skip Logic Details

| Review | Skip Condition | Check Command |
|--------|---------------|---------------|
| Vibe-coding guardrails | No uncommitted changes in target | `git diff --name-only HEAD -- {target} \| head -1` |
| UI review | No .tsx/.jsx files in target | `ls {target}/src/**/*.tsx 2>/dev/null \| head -1` |
| Infra review | No Dockerfile and no CI config | `ls {target}/Dockerfile docker-compose*.yml .github/workflows/*.yml 2>/dev/null \| head -1` |
| Quality review | Never skip -- always applicable | -- |
| Security review | Never skip -- always applicable | -- |

## Severity Mapping

Sub-reviews use P0-P3 severity. The full review maps these to consolidated labels:

| Full Review Label | Sub-Review Level | Definition |
|---|---|---|
| CRITICAL | P0 | Data loss, security breach, system failure |
| HIGH | P1 | Fix this sprint |
| MEDIUM | P2 | Fix next sprint |
| LOW | P3 | Hardening/cleanup |

When aggregating findings across reviews, always use the full-review labels (CRITICAL/HIGH/MEDIUM/LOW) in the consolidated report.

## Verdict Aggregation

Each sub-review produces its own verdict. The full review aggregates them:

| Sub-Review | Verdict Options |
|---|---|
| Guardrails | CLEAN / WARN / BLOCKED |
| UI | GO / NO-GO |
| Quality | SOLID / NEEDS-WORK / AT-RISK |
| Security | SECURE / AT-RISK / CRITICAL |
| Infra | READY / CONDITIONAL / NOT-READY |
| Sanity | CLEAN / CONDITIONAL / BLOCKED |

Final verdict rules:

- **PASS**: All sub-verdicts are positive (CLEAN, GO, SOLID, SECURE, READY) OR have only non-blocking conditions.
- **CONDITIONAL**: Any sub-verdict has conditions but no blockers (e.g., Guardrails is WARN, Quality is NEEDS-WORK, Infra is CONDITIONAL, Sanity is CONDITIONAL).
- **FAIL**: Any sub-verdict is BLOCKED (guardrails), NO-GO, AT-RISK (quality or security), CRITICAL, NOT-READY, or BLOCKED (sanity).

## Conflict Resolution Priority

When sub-reviews recommend contradictory fixes (e.g., security wants to remove a feature, UI wants to enhance it), resolve conflicts in this priority order:

```
Security > Data Integrity > Build Health > Accessibility > UI/UX > Performance
```

Higher-priority domains override lower-priority domains. Log the conflict and resolution in the report.

## Deduplication

If findings from multiple reviews reference the same `file:line`, merge them into a single finding with:
- The **highest** severity across the duplicates.
- Combined impact statements from each domain.
- A single unified fix that addresses all concerns.

Tag the merged finding with its source domains (e.g., `[Security + Quality]`).

---

## Phase 1: Guardrails Pre-Check

Run `/vibe-coding-guardrails {target}` first. This is a fast (< 60 seconds) pattern-matching scan that catches convention violations (wrong i18n patterns, CSS issues, missing button types, hardcoded spacing, `any` types, etc.) before the heavier domain reviews begin.

- Skip if there are no uncommitted changes in the target directory.
- If guardrails returns **BLOCKED** (P0 findings), fix all P0s immediately before proceeding to domain reviews. This prevents domain reviews from wasting time on issues guardrails already caught.
- If guardrails returns **WARN** (P1 findings only), note them and continue -- they will be fixed during Phase 4 remediation alongside domain review findings.
- If guardrails returns **CLEAN**, proceed directly to domain reviews.

Guardrails findings use the same P0-P3 severity scale and are included in the consolidated finding table alongside domain review findings. Apply the same severity mapping (P0→CRITICAL, P1→HIGH, etc.) and deduplication rules -- if a guardrails finding overlaps with a domain review finding at the same `file:line`, merge them and tag as `[Guardrails + {Domain}]`.

## Phase 2: Domain Reviews

Execute each sub-review by invoking the corresponding skill (`/ui-review {target}`, `/quality-review {target}`, etc.). Run them sequentially -- each review must complete before starting the next. Collect all output reports before proceeding to Phase 3.

1. `/ui-review {target}` (skip if target has no `.tsx` files -- see Conditional Skip Logic)
2. `/quality-review {target}`
3. `/security-review {target}`
4. `/infra-review {target}`

After all reviews complete, collect findings from each report. Apply the severity mapping to normalize P0/P1/P2/P3 labels to CRITICAL/HIGH/MEDIUM/LOW.

## Phase 3: Sanity Check

Run `/sanity-check {target}` to cross-validate findings across all domains and check for:
- Regressions or conflicts between recommendations.
- Build and test health before remediation begins.
- Merge conflicts from overlapping fixes.

## Phase 4: Remediation (skip if `no-fix`)

Work through findings by severity: CRITICAL first, then HIGH, then MEDIUM, then LOW -- stopping at the user's chosen floor (default: HIGH and above).

For each finding:
1. Log the finding in the report with its source review, severity, file, and line.
2. Implement the fix.
3. After each fix: (a) run `npm run build` to verify no build regression, (b) run the specific diagnostic command from the sub-review's verification section, (c) mark the finding as resolved in the consolidated report.

Apply deduplication: if multiple reviews flagged the same `file:line`, fix it once and mark all related findings as resolved.

Apply conflict resolution: if fixes from different reviews contradict, follow the priority order (Security > Data Integrity > Build Health > Accessibility > UI/UX > Performance).

Create one commit per severity tier (e.g., all CRITICAL fixes in one commit, all HIGH fixes in another). Use descriptive commit messages: `fix(review): resolve N CRITICAL findings from full-review of {target}`. Skip commits if `no-commit` is set.

### Unified Fix Examples

When multiple reviews flag the same file, apply a single unified fix that addresses all concerns at once.

**Same file flagged by security (SQL injection) + quality (missing error handling):**
Fix both in one change -- parameterize the query AND wrap in try/catch:
```typescript
// Before (security + quality violation)
const result = db.query("SELECT * FROM users WHERE id = " + id);

// After (unified fix)
try {
  const result = await db.query("SELECT * FROM users WHERE id = $1", [id]);
} catch (err) {
  logger.error({ err, userId: id }, "user lookup failed");
  throw new AppError("USER_NOT_FOUND", 404);
}
```

**Same component flagged by UI (missing aria-label) + quality (missing i18n):**
Fix both: add aria-label with i18n key:
```tsx
// Before
<button onClick={handleDelete}>🗑</button>

// After
<button onClick={handleDelete} aria-label={t("common.delete")}>{t("common.delete_icon")}</button>
```

## Phase 5: Re-verification

Run `/sanity-check {target}` again after all fixes to confirm:
- All targeted findings are resolved.
- No new regressions were introduced.
- Builds and tests still pass.

If new issues are found, loop back to Phase 4 (max 3 iterations to avoid infinite loops).

### Failure Exit Path

If all 3 iterations fail to resolve CRITICAL (P0) findings, stop the remediation loop and:
1. Produce the report with final verdict **FAIL**.
2. List every unresolved CRITICAL finding with file:line, source review, and reason it could not be resolved.
3. Include recommended manual steps for each unresolved blocker.

---

## Diagnostic Commands

Run these when issues arise during the review cycle:

### Build Failure After Fix
```bash
# Identify the failing module
npm run build 2>&1 | grep -i "error" | head -10

# Check if workspace packages are stale
for pkg in shared workflow-engine api-core api-integrations; do
  if [ -d "packages/$pkg/src" ]; then
    SRC=$(find "packages/$pkg/src" -name '*.ts' -newer "packages/$pkg/dist/index.js" 2>/dev/null | head -1)
    [ -n "$SRC" ] && echo "STALE: $pkg"
  fi
done

# Type check specific app
npx tsc --noEmit -p {target}/tsconfig.json 2>&1 | head -20
```

### Regression Detection
```bash
# Compare finding counts before/after fix iteration
# Count remaining findings in the consolidated report
rg -c 'P0|CRITICAL' docs/reviews/full-review-*.md
rg -c 'P1|HIGH' docs/reviews/full-review-*.md
```

### Fix Conflict Detection
```bash
# Check if multiple fixes touched the same file
git diff --name-only HEAD~N | sort | uniq -d
# If conflicts: review the file holistically, apply the higher-priority fix
```

---

## Output

### Report Path

Save the consolidated report to: `docs/reviews/full-review-{targetSlug}-{YYYY-MM-DD}.md`

If `docs/reviews/` does not exist, create it before writing the report.

### Aggregate Gate Scorecard

Combine gate results from all four domain reviews into a single scorecard:

```text
=== AGGREGATE GATE SCORECARD ===

Guardrails Pre-Check:
  Findings:           N P0, M P1, X P2, Y P3
  Verdict:            [CLEAN | WARN | BLOCKED | SKIPPED]

UI Review:
  Blocking Gates:     X/11 PASS, Y/11 PARTIAL, Z/11 FAIL
  Verdict:            [GO | NO-GO | SKIPPED]

Quality Review:
  Blocking Gates:     X/7 PASS, Y/7 PARTIAL, Z/7 FAIL
  Verdict:            [SOLID | NEEDS-WORK | AT-RISK]

Security Review:
  Blocking Gates:     X/8 PASS, Y/8 PARTIAL, Z/8 FAIL
  Verdict:            [SECURE | AT-RISK | CRITICAL]

Infra Review:
  Blocking Gates:     X/7 PASS, Y/7 PARTIAL, Z/7 FAIL
  Verdict:            [READY | CONDITIONAL | NOT-READY]

Sanity Check:
  Verdict:            [CLEAN | CONDITIONAL | BLOCKED]

=== CONSOLIDATED ===

Total Findings:       N CRITICAL, M HIGH, X MEDIUM, Y LOW
Findings Fixed:       A / B targeted
Findings Remaining:   C (list if > 0)
Remediation Passes:   1-3
Commits Created:      [list SHAs]
Final Verdict:        [PASS | CONDITIONAL | FAIL]
```

### Report Sections

The final report must contain these sections in order:

1. **Scope and Options** -- target, selected severity floor, skip decisions
2. **Sub-Review Summaries** -- one paragraph per domain with verdict and top findings
3. **Severity-Mapped Finding Table** -- all findings normalized to CRITICAL/HIGH/MEDIUM/LOW, deduplicated, with source domain tags
4. **Conflict Log** -- any contradictory recommendations and their resolution
5. **Remediation Log** -- each fix applied, files changed, verification result
6. **Aggregate Gate Scorecard** -- combined gates from all domains
7. **Unresolved Findings** -- anything not fixed, with severity and reason
8. **Final Verdict** -- PASS / CONDITIONAL / FAIL with blocking items listed
