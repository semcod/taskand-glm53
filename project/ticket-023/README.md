# Ticket 023: Ignore local Planfile and Koru tool state

- **ID**: ticket-023
- **Owner**: unresolved:human
- **Status**: IN_PROGRESS
- **Workflow state**: EDIT
- **Created**: 2026-09-15

## Goal and scope

The Planfile project store (`.planfile/`), its analysis output
(`.planfile_analysis/`) and the Koru event store (`.koru/`) are machine-local
runtime state: locks, event logs, sync indexes and cached sprint projections.
They are not source. Left untracked in the primary checkout, they fail the
managed governance gate (`GOV-TICKET-001` / `GOV-TICKET-005`) because they are
not bound to any ticket. Root-ignore exactly these three directories. The
local stores stay on disk unchanged.

## Acceptance criteria

- [ ] AC-01: `.gitignore` root-ignores `/.planfile/`, `/.planfile_analysis/` and
  `/.koru/` and nothing broader.
- [ ] AC-02: The existing local stores remain on disk unchanged; nothing is deleted
  or committed from them.
- [ ] AC-03: The managed governance check on a primary checkout that holds these
  stores no longer reports them as unbound implementation paths.

## Authorization

`SESSION_EXECUTION_AUTHORIZATION`: on 2026-09-15 the repository owner asked in
the agent session to add these directories to `.gitignore` ("dodać je do
.gitignore"). Publication uses the protected OneDev and Validator route only.

## Tracking boundary

This directory contains the minimal reviewed intent. Optional participant prose
and raw command logs are not required delivery output.
