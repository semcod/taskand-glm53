SHELL := /bin/bash
# taskand v2.0 Makefile — Minimalny, auto-mnożący się system
.PHONY: all up down status test conformance test-contracts test-negative test-twin test-web-twin test-cli twin-example web-twin-example integration catalog gateway bootstrap clean

all: test

up:
	docker compose up -d

down:
	docker compose down

status:
	docker compose ps
	@./bin/taskand status

test: conformance test-contracts test-negative test-twin test-web-twin test-cli

test-cli:
	@node --test tests/cli_routing.test.mjs

test-web-twin:
	@node --test tests/web_twin.test.mjs

web-twin-example:
	@node examples/web-twin-task.mjs

test-twin:
	@node --test tests/digital_twin.test.mjs

twin-example:
	@node examples/network-scan-task.mjs

conformance:
	@node tests/conformance.mjs

test-contracts:
	@node tests/contract_tests.mjs

test-negative:
	@node tests/negative_tests.mjs

integration:
	@node tests/integration_test.mjs

# Po ręcznej zmianie pakietu wbudowanego (origin: builtin) — przelicza bindingHash w rejestrach organizmów
catalog:
	@node generated/registry/core/taskand.dev/v1/bin.mjs <<< '{"action":"refresh"}'

bootstrap:
	docker compose run --rm bootstrap

gateway:
	python3 gateway.py

clean:
	rm -rf log/events.jsonl
