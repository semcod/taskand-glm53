# Dokumentacja taskand

## Co pozostało do zrobienia

- [Podsumowanie pozostałych prac](refactoring/remaining-work.md) — stan po PR #17,
  kolejność, kryteria odbioru i zależności; scalenie nie oznacza wdrożenia.

## Zwięzłe plany ewolucji

Pilotaż kompaktowego formatu wellmanifest/docs: jeden temat na plik,
`docs/REFACTORING/UPPER_SNAKE_CASE.md`, priorytet w metadanych. To projekty,
nie potwierdzenie wdrożenia. Dawna ścieżka pozostaje mapą odnośników.

Nowe odwołania kierować do całego pliku tematycznego. Dawne nagłówki służą
zgodności istniejących linków. Publikacja dokumentów nie instaluje walidatora
standardu w CI i nie stanowi odbioru opisywanej funkcjonalności.

- [Wydajność i warunki wejścia](REFACTORING/PERFORMANCE_EVOLUTION.md) — pomiary, etapy E-01–E-09 i granice planu.
- [Kontrakt runtime i pakietu](REFACTORING/RUNTIME_PACKAGE_CONTRACT.md) — repo, paczka, proces, instancja i manifest.
- [Aktualizacje węzłów offline](REFACTORING/OFFLINE_NODE_UPDATES.md) — mirror, migracja, drain i rollback.
- [Onboarding repozytorium](REFACTORING/REPOSITORY_ONBOARDING.md) — inwentaryzacja i adaptery bez przejmowania obcej pracy.
- [Lokalne CI i dostawa](REFACTORING/LOCAL_CI_DELIVERY.md) — receipt, zewnętrzna walidacja i publikacja.
- [Intencja z historii](REFACTORING/HISTORY_INTENT_ANALYSIS.md) — dowody, hipotezy i brak automatycznej zgody.
- [Polityka priorytetów SDLC](REFACTORING/SDLC_PRIORITY_POLICY.md) — klasyfikacja, koszty i właściciele standardów.
- [Dawny plan ewolucji](refactoring/continuous-evolution-plan.md) — zachowane wejścia i nagłówki.
- [Plan optymalizacji developmentu z LLM](refactoring/llm-development-optimization-plan.md) — propozycje redukcji narzutu operacyjnego, poprawy jakości i bezpiecznej automatyzacji.

## Pozostała dokumentacja

- [Odbiór po wdrożeniu](information/post-deployment-validation-questions.md) — pytania V i wymagane dowody.
- [Plan naprawczy](refactoring/functional-recovery-plan.md) — warunki wejścia przed ewolucją.
- [Zewnętrzne zależności](refactoring/external-dependencies-handoff.md) — przekazania do właścicieli standardów.

- [Przenośny, przypięty runtime lease](information/portable-lease-runtime.md) — izolowane testy bez zależności od katalogu developera.

- [Krótsza diagnostyka, elastyczne budżety i rzeczywisty stan dostawy](analysis/diagnostic-recovery.md) — F-02, pomiary i pozostała blokada lokalnego CI.

- [Aktualny stan instancji, dashboard, obserwatory i decyzja po teście bliźniaka](information/instance-network.md) — lokalna implementacja/projekt; nie oznacza wdrożenia na 8090.

- [Kontekst, diagram żądania i projekt operacyjnego nadzorcy dostawy](information/complementary-runtime.md).

- [Cyfrowy bliźniak: adresacja sieci, projekt modeli urządzeń i działający replay stron/API](analysis/digital-twin.md).
- [Rejestr organizmów i pakietów URI](registry-standard.md).
- [Architektura](ARCHITECTURE.md).
- [Standard v2.2](standard-v2.2.md).
- [Federacja](federation.md).
- [Sekrety](SECRETS.md).

- [Sterowanie MCP przez URI Taskand](information/mcp-process-control.md) — profile serwerów, dopuszczenia narzędzi, trwałe wyniki i izolowany pilot.
