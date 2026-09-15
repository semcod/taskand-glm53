# Ticket 024: Universal CLI routing, diacritics-safe intents and GitHub project discovery

- **ID**: ticket-024
- **Owner**: unresolved:human
- **Status**: IN_PROGRESS
- **Workflow state**: PUBLICATION
- **Created**: 2026-09-15

## Goal and scope

Land the uncommitted network-discovery session work from the primary checkout as
one reviewed change, and fix the defects found while reviewing it:

- `taskand "<zadanie>"` routes through `dev/chat` without naming an organism;
  `taskand <organizm> "<zadanie>"` still reaches built-in and later spawned
  organisms (registry lookup). `--format json|yaml|csv|txt|table` renders output.
- Intent keywords match with or without Polish diacritics; regex captures keep
  the original text; short keywords use word boundaries (`lan` ≠ `plan`,
  `git` ≠ `digital`).
- `admin/github-projects-discovery/v2` (builtin) replaces the evolved v1 that
  scanned from `/`: bounded `searchRoots`/`maxDepth`, linked-worktree support,
  credential-free URLs, fail-closed validation.
- `dev/act`, `dev/chat`, `admin/chat` flush stdout before exiting so structured
  results larger than the 128 KiB pipe buffer are not truncated.

The twin topology filter for ephemeral container interfaces is a dependent
slice (ticket-025) because the combined diff exceeds the 15-file delivery limit.

Out of scope (left untouched in the primary checkout): monag panel/routes,
capsule packaging standard and `hw/monitor` capsule files, Planfile sync
workflow, Gitea infra, local tool state (`.koru/`, `.planfile*`, see ticket-023).

## Acceptance criteria

- [x] AC-01: Accented and unaccented prompts resolve to the same intent; spawn
  descriptions keep diacritics; `plan`/`digital` no longer trigger `query`.
- [x] AC-02: GitHub discovery returns origins for plain repos and linked
  worktrees, respects `maxDepth`, never emits credentials and rejects invalid input.
- [x] AC-03: `taskand lista projektow github --format json|csv` returns the full
  structured list for a result above 128 KiB without LLM access.
- [x] AC-04: `taskand verify` reports all active packages matching bindingHash.
- [x] AC-05: `make test`, `tests/integration_test.mjs` and the gateway Python
  tests pass; `./project/governance-check.sh` passes.

## Authorization

SESSION_EXECUTION_AUTHORIZATION: the requester's task list asked to fix the
orphaned GitHub discovery package, add diacritics normalization, allocate a
ticket through `./project/new-ticket.sh` and commit the changes. Asked whether to
publish through the local OneDev/Validator flow, the requester answered
"kontynuuj": the outcome includes pushing the ticket branch, opening the pull
request and invoking the protected Validator request. Merge happens only
through the Validator after exact-head trusted checks; no direct merge.

## Tracking boundary

This directory contains the minimal reviewed intent. Optional participant prose
and raw command logs are not required delivery output.
