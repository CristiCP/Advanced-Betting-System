# Documentație

[Ansamblul proiectului](../README.md) explică pornirea, threadurile și fluxul general.

| Folder | Conținut |
| --- | --- |
| `architecture/` | Componentele comune, comunicarea și comportamentul la recuperare. |
| `providers/<site>/` | Contractul extern și proiecțiile fiecărui sport pentru acel site. |
| `mapping/` | Echivalențele verificate între siteuri și condițiile de comparație. |
| `reports/` | Rezultate istorice ale măsurătorilor, cu configurația și limitele lor. |

## Arhitectură

- [Network](architecture/NETWORK.md): HTTP/2, HTTP/1.1, SSE, WebSocket și controlul fluxului.
- [Providers](architecture/PROVIDERS.md): discovery, store vendor, proiecții și API.
- [Aggregator](architecture/AGGREGATOR.md): infrastructura comună și matchingul de fotbal.
- [Flux tenis](architecture/TENNIS.md): motorul separat, contextul, protocolul și oportunitățile.

## Superbet

- [Contract](providers/superbet/CONTRACT.md): REST, SSE, versiuni și patchuri.
- [Fotbal](providers/superbet/FOOTBALL.md): catalogul și proiecția binară.
- [Tenis](providers/superbet/TENNIS.md): totaluri, handicapuri, Da/Nu, scor și coordonate set/game.

## Betano

- [Contract](providers/betano/CONTRACT.md): REST, SignalR, LZ4 și actualizări.
- [Fotbal](providers/betano/FOOTBALL.md): catalogul și proiecția binară.
- [Tenis](providers/betano/TENNIS.md): praguri prematch/live, handicapuri, Da/Nu, scor și actualizări.

## Mapări și rapoarte

- [Corespondențe fotbal](mapping/FOOTBALL.md): tipurile asociate între Superbet și Betano.
- [Corespondențe tenis](mapping/TENNIS.md): 26 de rânduri, 25 active, perioade și excluderi.
- [Test de latență — 25 octombrie 2026](reports/LATENCY-TEST-2026-10-25.md): măsurarea locală de un minut.
- [Stabilitate Betano — 25 octombrie 2026](reports/BETANO-STREAM-STABILITY-2026-10-25.md): diagnostic `1005`/429, flux fără incidente, versiuni și recuperare.
- [Izolare evenimente Betano — 25 octombrie 2026](reports/BETANO-EVENT-ISOLATION-2026-10-25.md): abonament individual care închide grupul, partiționare adaptivă și retry separat.

**Fotbalul și tenisul au filtrare, matching și oportunități.** Providerii activi colectează numai live; suportul de proiectare prematch este separat. Baschetul este colectat brut, fără proiecții filtrate sau agregare.
