# Ticket 020: Adopt the wellmanifest/docs placement gate

- **ID**: ticket-020
- **Owner**: codex
- **Status**: IN_PROGRESS
- **Workflow state**: EDIT
- **Created**: 2026-09-15

## Goal and scope

Adopt the existing immutable `wellmanifest/docs` placement contract in
Taskand, so durable plans and reports cannot remain only in `.local`, `/tmp`,
agent sessions or ticket directories. Keep the separate `wellmanifest/report`
repository as a composing, not competing, standard; this ticket only binds
the released Docs policy and does not move private evidence.

## Acceptance criteria

- [x] AC-01: The intent binds only governance-owned adoption paths and records the exact Docs source revision and policy digest.
- [x] AC-02: `.governance/docs.json` pins `wellmanifest/docs` by full source SHA and policy SHA-256.
- [ ] AC-03: Pinned Docs and managed governance checks pass on the exact ticket diff; protected publication remains a separate lifecycle state.

## Validation evidence

- `./project/governance-check.sh`: `GOV-PASS` on the adoption files.
- The pinned Docs checker recognizes the adoption file without a
  `DOCS_ADOPTION` finding. It reports four pre-existing metadata/placeholder
  findings and cannot check the new plan until ticket-019 is integrated.
- The dependent deliverable check must be rerun against the exact post-merge
  base and plan SHA; this ticket does not convert those findings to PASS.

## Tracking boundary

This directory contains the minimal reviewed intent. Optional participant prose
and raw command logs are not required delivery output. The ticket remains
IN_PROGRESS through exact-head review and protected publication; adoption data
does not grant merge, deployment or secret authority.
