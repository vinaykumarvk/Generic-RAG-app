/**
 * Document lifecycle workflow using @puda/workflow-engine.
 * States: UPLOADED → VALIDATING → NORMALIZING → CHUNKING → EMBEDDING → SEARCHABLE → KG_EXTRACTING → ACTIVE
 * FAILED from any processing state. SKIP_KG shortcut from SEARCHABLE → ACTIVE.
 */

import type { WfDefinition } from "@puda/workflow-engine";

export const DOCUMENT_WORKFLOW: WfDefinition = {
  workflowId: "document-lifecycle",
  version: "1.0.0",
  states: [
    { stateId: "UPLOADED", type: "initial", taskRequired: false, metadata: { label: "Uploaded" } },
    { stateId: "VALIDATING", type: "intermediate", taskRequired: false, metadata: { label: "Validating" } },
    { stateId: "NORMALIZING", type: "intermediate", taskRequired: false, metadata: { label: "Normalizing" } },
    { stateId: "CHUNKING", type: "intermediate", taskRequired: false, metadata: { label: "Chunking" } },
    { stateId: "EMBEDDING", type: "intermediate", taskRequired: false, metadata: { label: "Embedding" } },
    { stateId: "SEARCHABLE", type: "intermediate", taskRequired: false, metadata: { label: "Searchable" } },
    { stateId: "KG_EXTRACTING", type: "intermediate", taskRequired: false, metadata: { label: "Extracting KG" } },
    { stateId: "ACTIVE", type: "terminal", taskRequired: false, metadata: { label: "Active" } },
    { stateId: "FAILED", type: "terminal", taskRequired: false, metadata: { label: "Failed" } },
    { stateId: "DELETED", type: "terminal", taskRequired: false, metadata: { label: "Deleted" } },
  ],
  transitions: [
    { transitionId: "start-validation", fromStateId: "UPLOADED", toStateId: "VALIDATING", trigger: "system", guards: [], actions: [] },
    { transitionId: "start-normalization", fromStateId: "VALIDATING", toStateId: "NORMALIZING", trigger: "system", guards: [], actions: [] },
    { transitionId: "start-chunking", fromStateId: "NORMALIZING", toStateId: "CHUNKING", trigger: "system", guards: [], actions: [] },
    { transitionId: "start-embedding", fromStateId: "CHUNKING", toStateId: "EMBEDDING", trigger: "system", guards: [], actions: [] },
    { transitionId: "embedding-complete", fromStateId: "EMBEDDING", toStateId: "SEARCHABLE", trigger: "system", guards: [], actions: [] },
    { transitionId: "start-kg", fromStateId: "SEARCHABLE", toStateId: "KG_EXTRACTING", trigger: "system", guards: [], actions: [] },
    { transitionId: "skip-kg", fromStateId: "SEARCHABLE", toStateId: "ACTIVE", trigger: "system", guards: [], actions: [] },
    { transitionId: "kg-complete", fromStateId: "KG_EXTRACTING", toStateId: "ACTIVE", trigger: "system", guards: [], actions: [] },
    // Failure transitions
    { transitionId: "validation-failed", fromStateId: "VALIDATING", toStateId: "FAILED", trigger: "system", guards: [], actions: [] },
    { transitionId: "normalization-failed", fromStateId: "NORMALIZING", toStateId: "FAILED", trigger: "system", guards: [], actions: [] },
    { transitionId: "chunking-failed", fromStateId: "CHUNKING", toStateId: "FAILED", trigger: "system", guards: [], actions: [] },
    { transitionId: "embedding-failed", fromStateId: "EMBEDDING", toStateId: "FAILED", trigger: "system", guards: [], actions: [] },
    { transitionId: "kg-failed", fromStateId: "KG_EXTRACTING", toStateId: "FAILED", trigger: "system", guards: [], actions: [] },
    // Soft delete from any non-processing state
    { transitionId: "delete-uploaded", fromStateId: "UPLOADED", toStateId: "DELETED", trigger: "manual", guards: [], actions: [] },
    { transitionId: "delete-searchable", fromStateId: "SEARCHABLE", toStateId: "DELETED", trigger: "manual", guards: [], actions: [] },
    { transitionId: "delete-active", fromStateId: "ACTIVE", toStateId: "DELETED", trigger: "manual", guards: [], actions: [] },
    { transitionId: "delete-failed", fromStateId: "FAILED", toStateId: "DELETED", trigger: "manual", guards: [], actions: [] },
  ],
};
