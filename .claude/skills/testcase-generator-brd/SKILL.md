---
name: testcase-generator
description: "Generate comprehensive functional test cases from a Business Requirements Document (BRD). Use this skill whenever a user uploads a BRD, PRD, requirements document, functional specification, or software spec and asks to create test cases, test plan, test scenarios, QA test suite, acceptance tests, or says things like 'generate tests from this BRD', 'create test cases for these requirements', 'write QA tests', 'build a test plan from this spec', 'what tests should I run for this app', or 'create functional tests from this document'. Also trigger when someone shares a requirements document and asks about testing, validation, or quality assurance. The output is a professionally formatted .docx file containing traceable, executable test cases covering every functional requirement, its acceptance criteria, boundary conditions, and edge cases."
---

# Test Case Generator Skill

## Purpose

Transform a Business Requirements Document (BRD) into a comprehensive set of functional test cases delivered as a professionally formatted .docx file. Every test case must be traceable to a specific requirement in the BRD, and the complete set must cover all happy paths, error paths, boundary conditions, and edge cases — so that a QA team (or an AI tester) could execute them without referring back to the BRD.

## Why Traceability and Completeness Matter

A test suite is only useful if it covers every requirement and every test can be traced back to why it exists. If a test fails, the team needs to know which requirement is affected. If a requirement has no tests, it's effectively unverified. This skill ensures zero-gap coverage: every FR in the BRD gets at least one happy-path test, one error/negative test, and boundary tests where applicable.

## Process

### Step 1: Extract the BRD Content

Read the uploaded BRD file. If it's a .docx file, extract its text content using pandoc or python-docx. Parse the document to identify:

- **Functional Requirements (FRs)**: Every numbered requirement (FR-001, FR-002, etc.)
- **Acceptance Criteria**: The testable conditions listed under each FR
- **Business Rules**: Specific logic rules (thresholds, calculations, conditions)
- **Workflow State Transitions**: Every state change and its triggers from state diagrams
- **Data Validation Rules**: Field types, formats, min/max values, required fields from the data model
- **Permissions/Authorization Rules**: What each role can and cannot do from the permissions matrix
- **Notification Triggers**: Every event that should fire a notification
- **Error Messages**: Specific error text mentioned in the BRD

Build a mental inventory: count the FRs, count the acceptance criteria, count the state transitions, count the permission rules. This inventory is your coverage target.

### Step 2: Generate Test Cases

For each FR in the BRD, generate test cases in the following categories:

#### Category 1: Happy Path Tests
For each FR, create at least one test that verifies the primary success scenario — the user does the right thing and gets the expected result. Base these directly on the acceptance criteria.

**Minimum coverage rule**: Every FR must have at least 2 test cases — one happy path and one negative, boundary, or edge case. No exceptions, including read-only features like dashboards, reports, and list views. Read-only features have their own edge cases: empty state (no data), filter returns zero results, large dataset pagination, drill-down on a metric shows correct detail.

#### Category 2: Negative / Error Tests
For each FR that involves user input, form submission, or state change, create tests that verify the system handles invalid input correctly:
- Required fields left blank
- Values exceeding maximum limits
- Values below minimum limits
- Invalid formats (wrong email format, wrong date format)
- Unauthorized actions (wrong role attempting an action)
- Actions in wrong states (trying to edit a submitted claim, trying to delete a non-draft item)

For read-only / dashboard FRs, negative tests include:
- Dashboard with zero data (new system, no records yet)
- Filter that matches no records (verify "no results" state, not a crash)
- Drill-down on an aggregated metric to verify the detail matches the summary
- Large dataset behavior (does pagination work correctly with 500+ records?)

#### Category 3: Boundary Tests
For every numeric threshold, limit, or range in the BRD, create tests at:
- Exactly at the boundary value
- One unit below the boundary
- One unit above the boundary

For example, if the BRD says "claims above 5000 INR require L2 approval", generate tests for 4999, 5000, and 5001.

#### Category 4: Workflow State Tests
For every state transition in the BRD's workflow/state diagrams, create a test that:
- Starts in the "from" state
- Performs the triggering action
- Verifies the entity moves to the correct "to" state
- Verifies all side effects fire (notifications sent, related records updated, etc.)

Also create tests for invalid transitions — actions that should NOT be possible in a given state.

#### Category 5: Permission / Authorization Tests
For each row in the permissions matrix, create:
- A positive test (authorized role performs the action successfully)
- A negative test (unauthorized role is blocked from the action)

#### Category 6: Cross-Feature Integration Tests
Create tests that span multiple FRs — verifying that features work together end-to-end. These typically follow a user journey: create → submit → approve → process → complete.

### Step 3: Structure Each Test Case

Every test case MUST contain ALL of the following fields. Do not skip any field.

| Field | Description | Example |
|-------|-------------|---------|
| **Test ID** | Unique identifier: TC-[FR]-[Seq] | TC-FR001-01 |
| **Test Name** | Short descriptive name | Verify employee can create expense claim with valid data |
| **Category** | One of: Happy Path, Negative, Boundary, Workflow, Permission, Integration | Happy Path |
| **Linked FR** | The FR number(s) this test verifies | FR-001 |
| **Priority** | Critical, High, Medium, Low | Critical |
| **Preconditions** | What must be true before the test starts | Employee is logged in. No draft claims exist. |
| **Test Steps** | Numbered step-by-step actions to perform | 1. Navigate to "New Claim" page. 2. Enter title "Mumbai trip". 3. Select date range... |
| **Test Data** | Specific input values to use | Title: "Mumbai client visit", Amount: 8500.00, Category: Travel |
| **Expected Result** | What should happen — specific and verifiable | Claim is created with status "draft". Claim number format is EXP-YYYYMM-NNNNN. Total amount shows 8500.00. |
| **Postconditions** | System state after the test | One draft claim exists in the employee's "My Claims" list. |

**Test step quality matters**: Steps must be specific enough that someone unfamiliar with the system can follow them. "Fill in the form" is bad. "Enter 'Mumbai client visit' in the Title field. Select 'Travel' from the Category dropdown. Enter 8500.00 in the Amount field." is good.

**Expected results must be verifiable**: "System works correctly" is bad. "Claim status changes to 'pending_l1'. Manager receives in-app notification with text containing the claim number and amount." is good.

### Step 4: Organize and Number

Organize test cases grouped by FR (or feature module). Within each group, order by: Happy Path first, then Negative, then Boundary, then Workflow, then Permission.

Number test cases as: TC-FR[NNN]-[SEQ]. Example: TC-FR004-03 is the 3rd test case for FR-004.

### Step 5: Generate Summary Metrics

At the top of the document, include a Test Coverage Summary table:

| Metric | Value |
|--------|-------|
| Total Test Cases | [count] |
| FRs Covered | [count] / [total FRs in BRD] |
| Happy Path Tests | [count] |
| Negative/Error Tests | [count] |
| Boundary Tests | [count] |
| Workflow State Tests | [count] |
| Permission Tests | [count] |
| Integration Tests | [count] |
| Critical Priority | [count] |
| High Priority | [count] |
| Medium Priority | [count] |
| Low Priority | [count] |

Also include a **Traceability Matrix**: a table mapping every FR to its test case IDs, confirming zero-gap coverage.

### Step 6: Create the .docx File

Read the docx skill at `/mnt/skills/public/docx/SKILL.md` and follow its instructions to create a professionally formatted Word document with:

- Title page with document name, project name, version, and date
- Table of contents
- Test Coverage Summary section
- Traceability Matrix section  
- Test cases organized by feature module with proper heading hierarchy
- Each test case as a formatted table (one table per test case is clearest)
- Consistent formatting: Arial font, professional color scheme, shaded table headers
- Page numbers in footer, document title in header

## Quality Checklist

Before finalizing, verify against these criteria:

1. **Zero-gap coverage**: Does every FR in the BRD have at least one test case? Check the traceability matrix — no FR should have zero tests.
2. **Minimum 2 tests per FR**: Every FR must have at least 2 test cases. If any FR has only 1, add a negative, boundary, or edge case test. For dashboard/list FRs, add an empty-state or zero-results test.
3. **Acceptance criteria coverage**: For each FR, does every acceptance criterion have at least one test that directly verifies it?
3. **Boundary tests exist**: For every numeric threshold in the BRD (approval limits, file sizes, character limits, date ranges), are there boundary tests at the exact boundary, one below, and one above?
4. **Negative tests exist**: For every form/input in the BRD, are there tests for blank required fields, invalid formats, and values exceeding limits?
5. **Permission tests exist**: For each critical action in the permissions matrix, is there at least one positive and one negative permission test?
6. **Workflow coverage**: For every state transition in the BRD's state diagrams, is there a test verifying the transition and its side effects?
7. **Invalid state transitions**: Are there tests attempting actions that should be blocked in certain states?
8. **Test data is specific**: Does every test case have concrete test data values (not "enter valid data" but "enter 'Rahul Verma' in the Name field")?
9. **Expected results are verifiable**: Does every expected result describe something concrete that can be checked (status value, message text, UI element state)?
10. **Integration tests span the full journey**: Is there at least one end-to-end test that follows the complete workflow from creation to final state?

## Common Pitfalls to Avoid

- **Generic test data**: Never write "enter valid email" — write "enter rahul.verma@company.com". Specific test data catches format assumptions that vague data misses.
- **Vague expected results**: Never write "system handles the error" — write "error message appears: 'File size must be under 5MB.' Claim is not submitted. Status remains 'draft.'"
- **Missing negative tests**: For every form field with validation rules, there must be a test that enters invalid data and verifies the correct error message.
- **Forgetting side effects**: Approval tests must verify not just the status change but also: notifications sent, related records updated, timestamps set, and any blocking/unblocking behavior.
- **Skipping edge cases at boundaries**: If the limit is 5000, testing only 100 and 10000 misses the boundary. Always test at 4999, 5000, and 5001.
- **No unauthorized access tests**: Every action restricted by role should have a test where the wrong role attempts it and is denied.
