---
{
  "schema": "wellmanifest.docs/document/v1",
  "id": "mcp-process-control",
  "kind": "information",
  "version": 3,
  "title": "Sterowanie serwerami MCP przez proces URI Taskand",
  "status": "proposed",
  "owner": "semcod/taskand-glm53",
  "created": "2026-09-19",
  "updated": "2026-09-19",
  "review_after": "2026-09-26",
  "source_revision": "903c806f0ae1af30eac6050584fd7d44923851a0",
  "affected_repositories": ["semcod/taskand-glm53"],
  "evidence": ["repo://semcod/taskand-glm53/project/ticket-029/intent.json", "repo://semcod/taskand-glm53/packages/taskand-mcp-control/control.py", "repo://semcod/taskand-glm53/gateway/handlers/mcp_control.py", "repo://semcod/taskand-glm53/tests/mcp_control_test.py", "repo://semcod/taskand-glm53/index.html"]
}
---

# Sterowanie MCP w Taskand

<!-- docs:section purpose -->
## Cel

Taskand jest punktem sterowania narzędziami pracownika i agenta: panel i klient
programowy wywołują ten sam proces `proc://taskand.dev/mcp/control/v1`.
Wdrożona przez operatora implementacja MCP pozostaje wykonawcą, a Taskand
przechowuje konfigurację instancji, dopuszczenia narzędzi i wyniki wykonań.
Nie jest to dowód, że dowolne polecenie językowe zostanie poprawnie wykonane.

<!-- docs:section scope -->
## Zakres i gotowe zależności

Oficjalny Python SDK `mcp==2.2.0` obsługuje stdio i Streamable HTTP;
`jsonschema==4.26.0` sprawdza argumenty i deklarowany wynik strukturalny.
Zależności są przypięte w `packages/taskand-mcp-control/uv.lock`.

Lokalny pilot używa serwera Filesystem
`@modelcontextprotocol/server-filesystem@2026.8.31` dla wydzielonego katalogu
oraz `@bytebase/dbhub@1.3.0` dla testowej bazy SQLite z narzędziem SQL tylko do
odczytu. DBHub wymaga Node >=22.5; pilot ma osobny Node 22.23.2.
Instalacje serwerów i ich lockfile należą do konfiguracji hosta, nie kodu
Taskand. Dowolną kolejną instancję można zarejestrować z zatwierdzonego profilu,
ale to nie oznacza nieograniczonej przepustowości ani instalowania dowolnego
programu z polecenia LLM.

To kierunek **Taskand → MCP**. Lokalny ticket-028 implementuje niezależny
kierunek **klient MCP → Taskand**; ten ticket go nie scala ani nie zastępuje.

<!-- docs:section content -->
## API i panel

Wszystkie operacje używają `POST /api/proc/call`, istniejącego tokenu Taskand
oraz struktury:

```json
{
  "uri": "proc://taskand.dev/mcp/control/v1",
  "data": {
    "action": "list",
    "data": {}
  }
}
```

| Action | Dane | Skutek |
| --- | --- | --- |
| `list` | `{}` | Profile dostępne kontu i jego instancje |
| `register` | `server`, `profile` | Nowa instancja, przypięcie konfiguracji profilu |
| `configure` | `server`, `enabled`, `revision`, opcjonalnie `profile` | CAS konfiguracji; zastosowanie profilu usuwa dopuszczenia narzędzi |
| `discover` | `server` | Rzeczywisty katalog MCP i `schemaPin` każdego narzędzia |
| `admit` | `server`, `tool`, `schemaPin` | Dopuszczenie dokładnej wersji narzędzia |
| `call` | `server`, `tool`, `schemaPin`, `arguments`, `runId` | Wykonanie z trwałym identyfikatorem |
| `runs` | opcjonalnie `runId` | Jeden wynik lub ostatnich 50 wykonań konta |

Sekcja MCP istniejącego dashboardu udostępnia te operacje. Pole tokenu pozostaje
w pamięci strony. Interfejs gateway jest także dostępny pod `/`, więc panel
pilota nie potrzebuje osobnego proxy. Dawny panel na 8090 zachowuje API 8077.

Sesja developerska na loopback może otrzymać token przez GET:
`http://localhost:8082/?taskand_dev=1&taskand_dev_token=<TOKEN_LOKALNY>`.
Wstaw lokalny token dostępu Taskand. Panel usuwa oba parametry z adresu, zachowuje
token tylko w pamięci strony i automatycznie odczytuje sieć oraz instancje MCP.
Wywołania API używają nagłówka Authorization. Odświeżenie oczyszczonego adresu
rozpoczyna sesję bez tokenu; aby ponownie wejść w tryb developerski, użyj pełnego
linku. Parametr bez flagi developerskiej albo poza loopback jest odrzucany.
Odpowiedź HTML ma no-store/no-referrer, a log gateway nie zapisuje query.

Gateway wymaga grantu `call` oraz `mcp:<action>` dla URI. Przypina aktora z
uwierzytelnionego konta i podpisuje jednorazowe, krótkotrwałe żądanie. Sam proces
odrzuca wywołanie bez podpisu i replay. Podpis nie jest tokenem dla serwera MCP.
Stan instancji, dopuszczenia oraz wyniki są odseparowane według konta Taskand.

Profile są plikiem operatora, przykładowo:

```json
{
  "reports": {
    "actors": ["admin"],
    "transport": "stdio",
    "command": "/opt/mcp/node",
    "args": ["/opt/mcp/dbhub/dist/index.js", "--config", "/opt/mcp/dbhub.toml"],
    "files": {
      "/opt/mcp/node": "SHA256_EXECUTABLE",
      "/opt/mcp/dbhub/dist/index.js": "SHA256_ENTRYPOINT",
      "/opt/mcp/dbhub.toml": "SHA256_CONFIG"
    }
  }
}
```

To przykład kontraktu, nie gotowy profil. Operator instaluje przypięte pakiety,
wpisuje rzeczywiste ścieżki i SHA-256. Profil HTTP ma `transport: "http"`,
`url` oraz `actors`; adres ustala operator. Nie ma obsługi przekazywania OAuth.
Po zmianie profilu należy zastosować go do instancji i dopuścić narzędzia ponownie.
Dla DBHub `readonly = true` należy do konfiguracji `[[tools]]`, nie `[[sources]]`.

## Rozmowa i nawigacja

Menu nagłówka przełącza widoki Rozmowa, Usługi, Wykonania, Telemetria i
Diagnostyka. Domyślnie otwiera się rozmowa. Jej historia pozostaje w pamięci
strony; zmiana konta, wylogowanie, nowa rozmowa lub przeładowanie usuwa ją.
Do modelu trafia najwyżej 24 wiadomości / 48 tys. znaków, a pojedyncza
wiadomość ma limit 12 tys. znaków. Starsze pary są pomijane w kontekście.

`POST /api/conversation` przyjmuje wiadomości user/assistant. Wymaga grantu
`call` do `proc://taskand.dev/dev/llm/v1`. Używa wyłącznie tego procesu, bez
klasyfikatora intencji i narzędzi. Przycisk „Przenieś do planowania” kopiuje
zadanie do formularza planu; samo przełączenie widoku niczego nie wykonuje.

Opcjonalny profil hosta `TASKAND_CONVERSATION_GATEWAY=http://127.0.0.1:8077`
łączy pilot z istniejącym gatewayem modelu. Adres ustala operator, dozwolony
jest wyłącznie HTTP loopback, bez przekierowań. Przekazywany jest token konta
Taskand z bieżącego żądania; oba gatewaye sprawdzają swoje granty, a nazwa
aktora w odpowiedzi musi się zgadzać. Klucz dostawcy pozostaje w istniejącym
8077. Bez profilu rozmowa używa lokalnego procesu modelu. Pole llm_configured
w healthz opisuje lokalny model i nie potwierdza połączenia z drugim gatewayem.

Monag wymaga kompletnego zainstalowanego runtime, obejmującego procache.
Pilot wybiera istniejący wersjonowany runtime przez PATH i MONAG_SRC w
prywatnym pliku usługi; nie instaluje zależności w cudzym checkoutcie.
Widok sumuje unfinished_checkouts i planfile.remaining z projektów, wskazując
pokrycie niepełnych danych. Powiadomienia są domyślnie wyłączone, a włączenie
powiadomień web wymaga uprawnienia przeglądarki.

## Wykonania i ograniczenia zasobów

SQLite zachowuje `RUNNING`, `SUCCEEDED`, `FAILED`, `REJECTED` lub
`OUTCOME_UNKNOWN`. Ponowne użycie identycznego `runId` i danych odczytuje
istniejący wynik. Zmienione dane z tym samym ID są odrzucane. Po zerwaniu
połączenia podczas efektu wynik pozostaje nieznany; Taskand nie powtarza go
samodzielnie. Po utracie procesu odczyt porzuconego RUNNING zmienia go na
OUTCOME_UNKNOWN. Nie jest to gwarancja exactly-once po stronie zewnętrznej.

Sesja MCP jest otwierana na czas operacji i zamykana po niej. Limit wynosi
cztery sesje na host oraz jedną operację na instancję; nadmiar dostaje BUSY,
bez ukrytej kolejki. Timeout MCP to 25 s, opakowania procesu 35 s, gateway 40 s.
Katalog do 500 narzędzi / 256 KiB, wynik do 256 KiB. Historia listuje ostatnie
50 wpisów, starsze pozostają dostępne przez ID. Rejestr instancji nie ma jeszcze
stronicowania ani automatycznej retencji danych.

<!-- docs:section evidence -->
## Weryfikacja i uruchomienie

```sh
uv sync --project packages/taskand-mcp-control --frozen
PYTHONPATH=. uv run --project packages/taskand-mcp-control python -m unittest discover -s tests -p '*_test.py'
make test
./project/governance-check.sh
```

Testy uruchamiają prawdziwe serwery MCP stdio/HTTP, sprawdzają granicę podpisu,
granty, izolację kont, CAS konfiguracji, zmianę schematu, niedopuszczone narzędzie,
walidację argumentów i odczyt tego samego wyniku bez ponowienia efektu.
Fixture celowo zrywa proces po zapisie, żeby sprawdzić nieznany wynik.

Pilot działa na osobnym katalogu wydania i stanie poza checkoutem. Wymaga:

- `TASKAND_MCP_PYTHON`: bezwzględna ścieżka Python z powyższego izolowanego venv;
- `TASKAND_MCP_STATE`: prywatny katalog SQLite i blokad;
- `TASKAND_MCP_PROFILES`: bezwzględna ścieżka pliku profili;
- `TASKAND_MCP_KEY`: losowy klucz podpisu >=32 znaki, tylko w prywatnym env gateway;
- `TASKAND_BIND=127.0.0.1`, `TASKAND_PORT=8082` dla izolowanego pilota.

Rejestr źródłowy dodaje proces jako `candidate`. Operator wdrożenia dopuszcza
jego dokładny hash poleceniem `./bin/taskand approve URI` w katalogu
wydania. Opakowanie procesu dodatkowo sprawdza SHA-256 `control.py`.
Następnie uruchamia `python3 gateway.py` z katalogu wydania i powyższym env,
np. przez dedykowaną usługę użytkownika `taskand-mcp-pilot.service`.
Nie modyfikuje produkcyjnego genome ani istniejącego gateway.

Odbiór pilota: odczyt CSV przez Filesystem, zapytanie SUM w DBHub oraz zapis
raportu przez fixture dają sumę 830 dla 350+480. Wynik raportu należy sprawdzić
niezależnie w pliku, następnie przeładować panel i odczytać historię. Potwierdzenie
wdrożenia, konkretnego SHA i tych obserwacji należy do zewnętrznego receipt.

<!-- docs:section limitations -->
## Granice

`SUCCEEDED` oznacza poprawny wynik narzędzia. `acceptance: NOT_EVALUATED`
przypomina, że cel użytkownika wymaga osobnej asercji. Nie ma tu uniwersalnego
planera, automatycznego supervisora GLM ani pełnego procesu programowania.
Natywny DAG bez podpisanego wejścia gateway nie może wywołać tego procesu;
autoryzowany executor DAG jest kolejnym odrębnym etapem.

Profile i kod serwerów są zaufane. Hash entrypointu nie izoluje całego drzewa
zależności; operator musi kontrolować katalog instalacji. Procesy stdio nie są
sandboxem systemowym; nie należy dopuszczać niezaufanych programów. Filtr env
nie zastępuje izolacji systemu plików czy sieci. Profile sesyjne nie utrzymują
okna przeglądarki pomiędzy wywołaniami. Nie ma instalatora serwerów, sekretów
per-serwer, limitów dysku, retencji ani zarządzania zdalnymi daemonami.

<!-- docs:section next_actions -->
## Dalszy rozwój

Następny slice może dodać executor planów z dokładnymi grantami kroków,
niezależnymi asercjami i wznowieniem po receipt. Dopiero potem przydatne są
profile GitHub, Playwright, poczty i kalendarza, sesje trwałe, kolejka oraz
izolowane kontenery. Supervisora LLM należy oceniać na wykonanych zadaniach
z oracle; nie przyznawać mu uprawnień do instalacji czy dopuszczania własnych
narzędzi. Premesh może użyć tego samego API po zakończeniu równoległej pracy.
