# Ticket 058: Fix conformance genome and shell-build contract

- **ID**: ticket-058
- **Owner**: agent:antigravity
- **Status**: IN_PROGRESS
- **Workflow state**: EDIT
- **Created**: 2026-09-26

## Goal and scope

Fix two conformance and contract defects discovered in automated test suites:
1. `genome.yaml` lacks declared processes for `proc://taskand.dev/subactor/ticket-lifecycle/v1` and `proc://taskand.dev/twin/account/v1`, failing node conformance (3/4).
2. `proc://taskand.dev/mcp/shell-build/v1` threw `SHELL_OPERATION_DENIED` on empty input `{}` in `contract_tests.mjs`, failing the process contract. Default to `plan` when operation is omitted.
3. Bump CDP send timeout in `cdp.mjs` from 12000ms to 30000ms to avoid cold-start browser test timeouts under system load.

## Acceptance criteria

- [ ] AC-01: `node tests/conformance.mjs` passes 4/4.
- [ ] AC-02: `node tests/contract_tests.mjs` passes 34/34.
- [ ] AC-03: `node tests/negative_tests.mjs` passes 17/17.
- [ ] AC-04: `./project/governance-check.sh` passes 0 errors, 0 warnings.
