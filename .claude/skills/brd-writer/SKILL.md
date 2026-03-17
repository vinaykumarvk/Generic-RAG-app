---
name: brd-writer
description: "Generate a comprehensive, AI-buildable Business Requirements Document (BRD) from a single paragraph of input. Use this skill whenever a user asks to create a BRD, business requirements document, product requirements, PRD, software spec, functional specification, app requirements, or says anything like 'write requirements for an app', 'spec out this idea', 'document the requirements', 'create a requirements doc for this project', or 'I have an app idea and need a BRD'. Also trigger when someone provides a short description of a business/app idea and asks for it to be fleshed out into a full document. The output is a professional .docx file detailed enough for an AI coding agent to build the entire application without further clarification."
---

# BRD Writer Skill

## Purpose

Transform a short (1-paragraph) business idea description into a comprehensive Business Requirements Document (BRD) delivered as a professionally formatted .docx file. The BRD must be detailed enough that an AI platform (Claude, GPT, Copilot, etc.) could build the complete application from it without asking follow-up questions.

## Why This Level of Detail Matters

A BRD that says "the system should manage users" is useless to an AI builder. An AI builder needs: what fields does a user have? What are the validation rules? What roles exist? What can each role do? What happens on failed login? This skill produces that level of specificity — every section contains concrete fields, rules, constraints, and behaviors, not vague descriptions.

## Process

### Step 1: Analyze the Input Paragraph

Read the user's paragraph carefully and extract:
- **Core domain**: What business problem does this solve?
- **Primary users**: Who will use this? (Infer roles even if not stated)
- **Key entities**: What are the main data objects? (e.g., Orders, Products, Users)
- **Core workflows**: What are the 3-5 main things users will do?
- **Implied requirements**: What's not said but obviously needed? (Authentication, notifications, dashboards, etc.)

Think expansively. A user who says "I want a restaurant ordering app" implicitly needs: a menu management system, an order workflow, payment processing, delivery tracking, customer accounts, restaurant admin panel, notification system, and reporting. Spell all of this out.

### Step 2: Generate the BRD Content

The BRD must contain ALL of the following sections. Do not skip any section. Each section should be substantive (not a placeholder).

#### Section 1: Executive Summary
- Project name (invent a professional one if not given)
- One-paragraph project description
- Business objectives (3-5 bullet points)
- Target users and their pain points
- Success metrics (KPIs with specific measurable targets)

#### Section 2: Scope & Boundaries
- **In Scope**: Explicitly list every feature that will be built
- **Out of Scope**: Explicitly list what will NOT be built (this prevents scope creep and tells the AI builder where to stop)
- **Assumptions**: List what you're assuming about the environment, users, data
- **Constraints**: Technical, budget, timeline, regulatory constraints

#### Section 3: User Roles & Permissions
For each role, specify:
- Role name and description
- What they can see (read permissions)
- What they can do (write/edit/delete permissions)
- What they cannot do (explicit denials)

Present as a permissions matrix table.

#### Section 4: Data Model
For every entity in the system, specify:
- Entity name
- All fields with: field name, data type, required/optional, validation rules, default value
- Relationships to other entities (one-to-many, many-to-many, etc.)
- Sample data (2-3 rows showing realistic values)

Present each entity as a detailed table. This is the most critical section for AI builders — be exhaustive. Include fields that are commonly forgotten: created_at, updated_at, created_by, status, soft-delete flags.

**Consistency rule**: Before finalizing the data model, cross-reference every feature in Section 5 (Functional Requirements). If a feature references an entity (e.g., "wishlist", "comments", "ratings"), that entity MUST exist in this section with a full field table. An AI builder cannot implement a feature whose data model is undefined. After writing both sections, do one final pass to verify: every entity mentioned in any FR has a corresponding data model definition.

**Sample data is mandatory for every entity** — not just the main ones. An AI builder uses sample data to understand field formats, realistic value ranges, and edge cases (e.g., is a phone field stored as "9876543210" or "+91-9876543210"?). Provide 2-3 rows per entity, no exceptions.

#### Section 5: Functional Requirements
Organize by feature module. For each feature:
- Feature ID (e.g., FR-001)
- Feature name
- Description (2-3 sentences minimum)
- User story: "As a [role], I want to [action] so that [benefit]" — **mandatory for every FR, no exceptions, including admin features**
- Acceptance criteria (3-5 testable conditions per feature)
- Business rules (specific logic: "If order total > $100, apply 10% discount")
- UI behavior notes (what happens on click, on submit, on error)
- Edge cases and error handling

Number every requirement for traceability.

#### Section 6: User Interface Requirements
For each major screen/page:
- Screen name and purpose
- Layout description (what sections exist and where)
- Key UI components (tables, forms, charts, cards)
- Navigation flow (where does this screen lead to/come from)
- Responsive behavior notes

Do NOT create mockups — describe layouts in enough detail that an AI builder can create them.

#### Section 7: API & Integration Requirements
- List all external APIs or services needed (payment gateways, email services, maps, etc.)
- For each internal API endpoint, specify: method, path, request body, response body, error codes
- Authentication method (JWT, OAuth, API keys, etc.)
- Rate limiting requirements

**Standardized error response format**: Define the error response shape that all endpoints use (e.g., `{ "error": { "code": "VALIDATION_ERROR", "message": "Email is required", "field": "email" } }`). Specify this once and reference it throughout. AI builders need a single, consistent error contract.

**Request/response body examples**: For the 3-5 most complex endpoints (typically: create entity, update entity, list with filters), provide a concrete JSON example of the request body and the expected success response body. Without these, an AI builder has to guess field names and nesting.

#### Section 8: Non-Functional Requirements
- **Performance**: Response time targets, concurrent user capacity
- **Security**: Authentication method, data encryption, OWASP compliance notes
- **Scalability**: Expected growth, horizontal/vertical scaling approach
- **Availability**: Uptime target (e.g., 99.9%)
- **Data Backup & Recovery**: Backup frequency, RPO, RTO
- **Accessibility**: WCAG compliance level
- **Browser/Device Support**: Which browsers, mobile vs desktop

#### Section 9: Workflow & State Diagrams
For each major workflow (order processing, user registration, approval chains, etc.):
- List each state an entity can be in
- List all transitions between states
- Specify who/what triggers each transition
- Describe what happens at each transition (side effects: emails sent, status updates, etc.)

Present as a state table: Current State → Action → Next State → Side Effects.

#### Section 10: Notification & Communication Requirements
- List every event that triggers a notification
- For each notification: channel (email/SMS/in-app/push), recipient, trigger condition, message content template
- Notification preferences (can users opt out?)

#### Section 11: Reporting & Analytics
- List all reports/dashboards needed
- For each report: name, audience, data sources, filters, refresh frequency
- Key metrics and how they're calculated

#### Section 12: Migration & Launch Plan
- Data migration needs (if replacing an existing system)
- Phased rollout plan (what ships in v1 vs v2)
- Go-live checklist

#### Section 13: Glossary
- Define all domain-specific terms used in the document

#### Section 14: Appendices
- Any additional reference material, sample data formats, or regulatory requirements

### Step 3: Create the .docx File

Read the docx skill at `/mnt/skills/public/docx/SKILL.md` and follow its instructions to create a professionally formatted Word document. Apply these formatting standards:

- Use Heading 1 for section titles, Heading 2 for subsections, Heading 3 for sub-subsections
- Use properly formatted tables (with header rows shaded) for data models, permissions matrices, and state diagrams
- Use numbered lists for requirements (FR-001, FR-002, etc.)
- Include a table of contents
- Use consistent fonts: Arial 12pt body, with appropriate heading sizes
- Page numbers in footer
- Document title and "Confidential" in header
- Professional color scheme (dark blue headings, light blue table headers)

### Quality Checklist

Before finalizing, verify the BRD against these criteria:
1. Could an AI builder create the database schema from Section 4 alone? (Fields, types, relationships all specified)
2. Could an AI builder implement every feature from Section 5 alone? (Acceptance criteria are testable, business rules are unambiguous)
3. Could an AI builder build every screen from Section 6 alone? (Layout, components, and navigation specified)
4. Are there any vague phrases like "the system should handle errors appropriately"? (Replace with specific error handling behavior)
5. Is every feature numbered for traceability?
6. Does every user story have acceptance criteria?
7. Are all entity relationships explicitly stated?
8. Are notification triggers and templates defined?
9. **Cross-reference consistency**: Does every entity mentioned in any functional requirement exist in the data model? Does every screen reference entities that exist? If FR-017 mentions "wishlist", is there a Wishlists entity in Section 4?
10. **Sample data completeness**: Does every entity in Section 4 have 2-3 rows of sample data?
11. **API completeness**: Do the 3-5 most complex endpoints have request/response body JSON examples?
12. **User story completeness**: Does every FR (including admin features) have a "As a [role]..." user story?
13. **Glossary relevance**: Does every term in the glossary appear somewhere in the document? Are there no irrelevant entries?

If any check fails, fix it before generating the document.

## Common Pitfalls to Avoid

- **Vagueness**: Never write "appropriate", "as needed", "etc.", or "and so on" in a requirement. Be specific.
- **Missing error states**: Every form needs validation rules. Every API needs error responses. Every workflow needs a "what if it fails" path.
- **Forgotten audit trail**: Most business apps need created_by, created_at, updated_by, updated_at on every entity. Include them.
- **No sample data**: Data model tables without sample values are ambiguous. Always include 2-3 sample rows for EVERY entity.
- **Skipping permissions**: Don't just list roles — specify exactly what each role can and cannot do in a permissions matrix.
- **Cross-section inconsistency**: This is the most common and most damaging pitfall. If a functional requirement mentions a "wishlist" or "favorites" feature, the data model MUST have a corresponding entity with full field specs. An AI builder will halt when it encounters a feature whose underlying data structure is undefined. After writing all sections, do a final consistency pass.
- **API without body examples**: An endpoint table showing "POST /api/books" is insufficient for an AI builder. Include at least one JSON request body example and one response body example for the key creation/update endpoints.
- **Irrelevant glossary entries**: Every term in the glossary must appear in the document. Remove any entries that were carried over from templates but don't apply to this project.