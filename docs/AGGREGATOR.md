# Aggregation — asocierea meciurilor și oportunitățile

[Ansamblul proiectului](../README.md) · [Network](NETWORK.md) · [Providers](PROVIDERS.md) · [Corespondențe fotbal](FOOTBALL-MARKET-MAPPING.md)

> **Stare: implementat.** Toate cele cinci etape rulează cu ambii provideri: transportul, adaptoarele, asocierea meciurilor, detectorul și fallback-ul observat. Marcajele P, A, H și I rămân dezactivate până la confirmarea regulilor de decontare; perechile fără ID Betradar sunt doar raportate. Rezultatele rulărilor live sunt în [Observații live](#15-observații-live).

Agregatorul primește de la Superbet și Betano liniile de fotbal deja filtrate de proiecțiile existente, recunoaște același meci la ambele case, asociază liniile echivalente și calculează oportunitățile de arbitraj. Nu plasează pariuri: oportunitățile sunt raportate și înregistrate, iar decizia rămâne manuală.

Responsabilitățile rămân separate:

| Strat                       | Răspunde de                                                                 | Există |
| --------------------------- | --------------------------------------------------------------------------- | ------ |
| Store vendor                | Versiuni, patch-uri, recuperare, `stale`.                                   | Da     |
| Proiecția de fotbal         | Catalog fix, linii cu exact două selecții, roluri, handicap orientat.       | Da     |
| Adaptorul de agregare       | Traducerea în chei canonice, internarea liniilor, coada coalescentă.        | Da     |
| Agregatorul                 | Asocierea meciurilor, asocierea liniilor, detectorul, înregistrarea.        | Da     |

## 1. Domeniu

Prima versiune acoperă exact ce produc proiecțiile:

- **Fotbal live.** Ambii provideri descoperă numai meciuri live; proiecțiile sunt doar pentru fotbal. Baschetul și tenisul rămân în afara agregatorului până au propriile cataloage.
- **Piețe cu două rezultate:** Peste/Sub, handicap cu două rezultate, Da/Nu. Fără 1X2, handicap european, jucători sau combinații, pentru că proiecțiile nu le emit.
- **Numai perechile din [corespondențe](FOOTBALL-MARKET-MAPPING.md#3-perechile-identificate)**, filtrate după marcaj (vezi [Liniile comparabile](#5-liniile-comparabile)).

O piață cu două rezultate face detectorul **O(1) per linie**: există doar două combinații încrucișate de comparat.

## 2. Principii

1. **Nimic nu trece o graniță nevalidat.** Proiecțiile validează datele siteului. Adaptorul validează traducerea canonică. Agregatorul validează din nou fiecare mesaj și fiecare înregistrare binară.
2. **Dacă nu e sigur, nu se folosește.** O asociere sau o linie îndoielnică este marcată și numărată, nu ghicită. Necunoscut înseamnă exclus.
3. **Aceeași formă ca restul codului.** Controller pe main, worker separat, `model/`, `config.ts`, `logging.ts`, separare procesare/protocol, lifecycle partajat (`??=`), verificări de identitate după `await`, ACK în `finally`, timere eliberate în `stop()`.
4. **Agregatorul nu poate opri colectarea.** Un agregator lent sau căzut nu blochează și nu umflă memoria providerilor.
5. **Calea fierbinte nu alocă.** O schimbare de preț nu creează obiecte, stringuri sau closures nici în provider, nici în agregator.

## 3. Arhitectura

```mermaid
flowchart LR
    subgraph SB["Processing worker Superbet"]
        SBS["Store"] --> SBP["FootballProjection"] --> SBA["AggregationAdapter<br/>chei canonice + coadă"]
    end
    subgraph BE["Processing worker Betano"]
        BES["Store"] --> BEP["FootballProjection"] --> BEA["AggregationAdapter<br/>chei canonice + coadă"]
    end

    subgraph AGG["Aggregation worker"]
        DEC["Decodare + validare"] --> BOOK["QuoteBook<br/>struct-of-arrays"]
        DEC --> EV["EventRegistry"]
        EV --> MATCH["EventMatcher"]
        MATCH --> LINK["LineLinker"]
        BOOK --> DET["Detector incremental"]
        LINK --> DET
        DET --> REC["Recorder JSONL"]
    end

    MAIN["Main thread<br/>AggregationController"]

    SBA -->|"MessageChannel direct<br/>batch + ACK"| DEC
    BEA -->|"MessageChannel direct<br/>batch + ACK"| DEC
    AGG <-->|"comenzi / oportunități"| MAIN
```

Adaptorul rulează în processing workerul existent, după proiecție. Pe canal trec numai liniile care au o corespondență activă, deci aproximativ jumătate din catalogul Superbet nu părăsește niciodată threadul providerului.

### Fișierele

```
src/aggregation/
  config.ts  controller.ts  logging.ts
  mapping.config.ts       cele 80 de corespondențe, generate din FOOTBALL-MARKET-MAPPING.md
  mapping.ts              validarea încrucișată cu ambele cataloage și indexul rândurilor active
  model/                  adapter / config / controller / mapping / matching / opportunity / outbox / session / wire / worker
  adapter/outbox.ts       coada coalescentă, în processing workerul fiecărui provider
  adapter/football.ts     adaptorul generic: proiecție → identitate, stare live, chei canonice
  protocol/wire.ts        formatul binar al batch-urilor, comun ambelor părți
  protocol/validation.ts  gărzile mesajelor de control și ale limitelor
  workers/worker.ts       sesiunile, timerele (sweep, rapoarte, statistici), oprirea ordonată
  processing/session.ts   AggregationSession: generație, secvență, ciclul de viață al handle-urilor, ACK
  processing/engine.ts    AggregationEngine: leagă starea validată de asociere, linkare și detecție
  processing/events.ts    EventRegistry: meciuri per provider, nume normalizate, starea live
  processing/quotes.ts    QuoteBook: liniile unui provider în tablouri tipizate
  processing/detector.ts  calculul incremental și ciclul de viață al oportunităților
  processing/recorder.ts  JSONL cu coadă limitată
  matching/names.ts       normalizarea numelor, marcajele, similaritatea
  matching/matcher.ts     EventMatcher: perechi după Betradar și verificările continue
  matching/lines.ts       LineLinker: legăturile dintre liniile perechilor confirmate
  matching/learning.ts    aliasuri și competiții învățate, salvate atomic
src/providers/superbet/processing/aggregation.ts   codecul Superbet: status, ceas, roluri, chei
src/providers/betano/processing/aggregation.ts     codecul Betano: suspendări, ceas, roluri, chei
test/aggregation-*.test.mjs, test/helpers/aggregation.mjs
```

Providerii importă din agregare doar outboxul, adaptorul generic, maparea și formatul binar. Codecul fiecărui provider este singurul loc care cunoaște semantica siteului: statusuri, suspendări, ceas.

### Ciclul de viață

1. `src/index.ts` creează `AggregationController`, iar `createPort(provider)` creează câte un `MessageChannel` înainte de pornire. `port1` rămâne agregatorului, `port2` este al treilea argument al controllerului providerului.
2. Controllerul providerului transmite portul processing workerului prin `workerData` și `transferList`, exact ca `networkPort`. Fără port, outboxul nu este creat și providerul funcționează ca înainte.
3. La pornire, sesiunea agregatorului trimite `attach` cu generația și limitele. Outboxul nu înregistrează nimic înainte de `attach`: tablourile lui sunt dimensionate după aceste limite, deci ambele părți validează aceleași valori.
4. Un eșec la pornirea agregatorului este logat, dar nu oprește providerii.
5. La oprire: providerii se opresc întâi și își închid porturile, apoi agregatorul primește `stop` și se închide (timeout de 15 s, apoi `terminate()`, ca la provideri).

Dacă agregatorul cade, adaptorul vede portul închis, își eliberează coada și încetează să mai producă. Reatașarea (`attach-aggregation` prin main, urmată de o generație nouă) vine într-o etapă ulterioară.

## 4. Identitatea canonică a meciului

Proiecțiile păstrează tot ce trebuie, inclusiv ID-ul Betradar (`betradarId`), adăugat în `SuperbetFootballEvent` și `BetanoFootballEvent` pentru agregare.

| Câmp            | Superbet                                         | Betano                                      | Regulă                                                                                  |
| --------------- | ------------------------------------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| ID Betradar     | `fixture.betradar_id` (**string**)               | `event.betradarMatchId` (**number**)        | Superbet: șir `/^[1-9]\d{0,15}$/`, convertit la număr sigur. Betano: întreg sigur pozitiv. Altfel `null`. |
| Gazde / oaspeți | `home.name`, `away.name` din `event_name`        | `home.name`, `away.name` din `participants` | Deja validate de proiecții: exact două, nume nevide și diferite.                        |
| Start           | `startsAt` din `utc_date`                        | `startsAt` din `startTime`                  | Milisecunde epoch. La Superbet, dacă `unix_date_millis` contrazice `utc_date`, startul devine necunoscut. |
| Scor            | `homeScore` / `awayScore` (string)               | `homeScore` / `awayScore` (string)          | `/^\d+$/` → întreg; altfel necunoscut.                                                  |
| Ceas            | `minute` în `1H`/`2H` (curge), `HT` (oprit la 45:00) | `clockSeconds`; `clockStopped` lipsă = curge | Secunde de joc plus bitul `running`; vezi [Ceasul](#ceasul).                   |
| Suspendare      | `offerStatus` ≠ 1                                | `isSuspended`                               | Flag canonic `suspended`.                                                               |
| Competiție      | `competitionId`, `categoryId`                    | `competitionId`, `categoryId`               | Spații de ID diferite; folosite doar prin corespondențe învățate.                       |

ID-urile echipelor și ale competițiilor nu se compară între case: sunt spații diferite.

Adaptorul trimite identitatea doar când se schimbă (proiecțiile publică deja `event` numai la schimbare). Normalizarea numelor și marcajele se calculează **o singură dată** pe schimbare de identitate, în agregator, și se păstrează în cache.

## 5. Liniile comparabile

### Codul canonic al pieței

[mapping.config.ts](../src/aggregation/mapping.config.ts) transformă tabelul de [corespondențe](FOOTBALL-MARKET-MAPPING.md#3-perechile-identificate) în date:

```ts
{ code: 1, betano: 13, superbet: 200734, conditions: ["D"], concept: "Total goluri" }
{ code: 14, betano: 51, superbet: 233942, conditions: ["T"], threshold: 0.5, concept: "Total cartonașe roșii <HOME_TEAM>" }
```

- Fișierul este **generat** din tabelul documentului de corespondențe, ca cele două să nu poată diverge. Codurile se adaugă, nu se renumerotează.
- `code` este un întreg mic și stabil (1–4095). Este cheia canonică a tipului de piață.
- Fiecare adaptor construiește un `Map<vendorId, rânduri[]>` din rândurile active (Superbet `231045` are două rânduri, pentru pragurile 0,5 și 1,5).
- `AggregationController` refuză să pornească dacă un rând contrazice cataloagele. [validateMapping](../src/aggregation/mapping.ts) verifică: coduri și perechi unice, tipuri existente în ambele cataloage, aceeași statistică, perioadă, subiect și durată de interval, câte un rol A și unul B, tipuri compatibile, parametrii Superbet potriviți tipului, prag prezent exact la `T`.
- La `T`, Superbet poate fi un total sau un Da/Nu cu parametru `total` (`231045`); validarea a găsit acest caz la prima rulare.

### Ce marcaje sunt active

| Marcaj | Activ în prima versiune | Motiv                                                                                  |
| ------ | ----------------------- | -------------------------------------------------------------------------------------- |
| D      | Da                      | Același concept, fără conversie.                                                       |
| T(x)   | Da                      | Conversie exactă Da→Peste, Nu→Sub, numai la pragul declarat. `T` cu `P` rămâne oprit. |
| P      | Nu                      | Regulile de numărare (cartonașe, cornere, șuturi) nu sunt confirmate.                  |
| A      | Nu                      | Regulile de push pe sferturi de linie nu sunt confirmate.                              |
| H      | Nu                      | Betano include scorul curent în handicapul asiatic; baza de decontare nu e confirmată. |
| I      | Nu                      | Limitele intervalelor diferă (`:59` față de `45:00`/`90:00`).                          |

Activarea se face per marcaj în configurație (`enabledConditions`, implicit `["D", "T"]`): 27 din cele 80 de rânduri. Un rând este activ doar dacă **toate** marcajele lui sunt active. Lista ajunge la provideri în `attach`, deci adaptorul **nu trimite** liniile rândurilor oprite.

### Cheia canonică a unei linii

Fiecare linie se reduce la un singur număr întreg, sigur în JavaScript:

```
lineKey = code × 2^20 + (param + 2^15) × 2^4 + variant

code     : 12 biți    codul canonic al pieței
param    : 16 biți    pragul sau handicapul în sferturi de unitate (2.5 → 10, −0.75 → −3), deplasat cu 2^15
variant  : 4 biți     slotul intervalului (început / durată), folosit doar de rândurile I
```

- Sferturile de unitate elimină erorile de virgulă mobilă: `2.5`, `2.50` și `2.4999999` din parsare nu pot produce chei diferite, iar o valoare care nu este multiplu exact de 0,25 este respinsă.
- Handicapul este deja **orientat spre gazde** în ambele proiecții, deci aceeași valoare înseamnă aceeași linie.
- La `T(x)`, linia Betano Da/Nu primește `param = x`; linia Superbet intră doar dacă pragul ei este exact `x`.
- Codecul Betano exclude liniile cu `scoreContext` (handicap pe scorul curent) și intervalele terminate la `45:00`/`90:00`; codecul Superbet exclude liniile „primele X minute”.
- Două linii vendor care produc aceeași cheie în același meci sunt **amândouă** retrase până la următoarea bază: compararea oricăreia ar fi o presupunere.
- O cheie numerică face căutările `Map<number, …>` mai ieftine decât cheile string și nu alocă.

### Rolurile

Fiecare linie are exact două roluri canonice, `A` și `B`:

| Tip       | A      | B      |
| --------- | ------ | ------ |
| Peste/Sub | Peste  | Sub    |
| Handicap  | Gazde  | Oaspeți |
| Da/Nu     | Da     | Nu     |

Asocierea se face prin rol, niciodată prin poziția în array (Superbet publică Sub înaintea lui Peste, Betano invers).

### Când este o cotă utilizabilă

| Provider | Condiții                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| Superbet | `price` finit > 1, `display: true`, `status === 1`. În 44 de snapshoturi live, `1` domină, iar `2` apare pe selecții blocate; orice altă valoare este indisponibilă. |
| Betano   | `price` finit > 1 (proiecția pune `null` altfel), selecție și linie nesuspendate.                               |

Codecul reduce aceste condiții la un bit `usable` per selecție; prețul este trimis oricum, pentru referință. Suspendarea **meciului** circulă în starea live și blochează perechea, fără retrimiterea liniilor. Agregatorul nu cunoaște semantica vendorului.

## 6. Protocolul pe canal

Ordinea este garantată doar în interiorul unui canal, deci **toate** mesajele unui provider pleacă pe același port, în batch-uri. Un singur batch este în zbor; următorul pleacă numai după ACK. Este același model de credit ca `StreamDelivery`, simplificat la o fereastră de un batch.

### Internarea liniilor

Pentru fiecare linie trimisă, adaptorul alocă un **handle** întreg mic (`Uint32`), refolosit printr-o listă de handle-uri libere:

- `line-define` asociază handle-ul cu `(eventHandle, lineKey)` o singură dată.
- Actualizările de preț conțin doar handle-ul și valorile numerice.
- `line-release` eliberează handle-ul; reutilizarea este sigură, pentru că eliberarea și redefinirea trec prin același canal, în ordine.

Meciurile primesc la fel un `eventHandle`. Agregatorul indexează direct în array-uri după handle, fără hash.

### Formatul unui batch

Un batch este un `ArrayBuffer` **transferat** (zero-copy, ca payloadurile din networking), cu două secțiuni:

Formatul este în [protocol/wire.ts](../src/aggregation/protocol/wire.ts), little-endian:

```
Header (32 B)   magic "AGB1" · versiune · provider · generation · sequence · sentAt (f64) · byteLength · segments
Segment         opCount (u32) · valueCount (u32) · operații · valori
  reset            1 B    șterge toată starea providerului; numai ca primă operație a unui batch
  event-identity  45 B + două nume (u16 lungime + UTF-8)   eventHandle, eventId, betradarId, startsAt, competiție, categorie
  event-live      14 B    eventHandle, flags (live, suspended, scor, ceas), scor gazde/oaspeți (u16), ceas (u32)
  event-release    5 B    eventHandle; liniile meciului trebuie eliberate înainte
  line-define     13 B    lineHandle, eventHandle, lineKey (u32)
  line-release     5 B    lineHandle
  valoare         21 B    lineHandle (u32) · priceA (f64) · priceB (f64) · flags (u8: usableA, usableB)
```

- **Valorile conțin ultima stare** a fiecărei linii modificate, nu istoricul. Un preț schimbat de zece ori între două batch-uri trece o singură dată.
- Într-un segment, operațiile preced valorile. O operație scrisă după valori deschide automat un segment nou, deci ordinea nu poate fi încălcată de cel care scrie.
- Prețul lipsă sau inutilizabil este `NaN`, cu bitul `usable` șters. Startul necunoscut este `NaN`; ID-urile absente sunt `0`.
- `sentAt` este momentul trimiterii batch-ului. Pentru că valorile sunt coalescente, este și momentul la care ele erau curente.

Mesajele de control (`attach`, `ack`, `resync`) sunt obiecte simple, validate cu gărzi în [protocol/validation.ts](../src/aggregation/protocol/validation.ts).

### Coada coalescentă din adaptor

```
dirty        Uint8Array indexat după lineHandle
dirtyList    Uint32Array cu handle-urile marcate (fără duplicate)
priceA/B     Float64Array indexat după lineHandle — ultima valoare
structural   lista ordonată a operațiilor structurale
```

| Eveniment în provider                 | Efect în coadă                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Schimbare de preț sau de `usable`     | Scrie în `priceA/B`, marchează `dirty` dacă nu era. O(1), fără alocare.                          |
| Linie nouă                            | `line-define` în `structural` + `dirty`.                                                         |
| Linie eliminată                       | Șterge `dirty`, adaugă `line-release`.                                                           |
| Scor, fază sau suspendare a meciului  | **Închide segmentul curent**: valorile dinainte pleacă înaintea schimbării de scor (vezi mai jos). |
| Doar ceasul s-a schimbat              | Operație `event-live` în segmentul curent, fără închidere: nu rupe coalescența.                   |
| Starea live nu s-a schimbat           | Nimic; la fel pentru o linie cu aceleași valori.                                                 |
| `invalidate`                          | Eliberează liniile (`line-release`), apoi meciul (`event-release`); trimis imediat.               |

Închiderea segmentului la schimbarea de scor împiedică o cotă de **dinaintea** golului să ajungă după scorul nou și să pară o cotă de după gol. Un batch poate conține mai multe segmente.

Batch-ul pleacă la `batchWindowMs` după prima modificare, sau la sfârșitul ciclului curent (`setImmediate`) la o schimbare de scor sau o invalidare, dacă nu este deja unul în zbor. Cât timp agregatorul nu a confirmat, outboxul continuă să suprascrie aceleași sloturi. **Valorile în așteptare sunt limitate de numărul de linii, nu de numărul de actualizări.**

Operațiile structurale se pot totuși aduna cât timp agregatorul nu răspunde. Dacă batch-ul în așteptare depășește `maxBatchBytes`, outboxul renunță la el, scrie `reset` și cere adaptorului retrimiterea stării din proiecții. Limita este validată să încapă de **două ori** starea completă ([fullStateBytes](../src/aggregation/protocol/wire.ts)), deci o retrimitere nu poate depăși din nou limita.

### Generații, secvențe și resincronizare

- `generation` vine de la agregator în `attach` și este verificată în plic și în header. Reatașarea, cu generație nouă, este o etapă ulterioară.
- `sequence` crește cu fiecare batch. Agregatorul confirmă cu `ack`, care întoarce și bufferul transferat, pentru refolosire.
- Un batch respins (secvență lipsă, header nepotrivit, operație invalidă, încălcarea ciclului de viață) produce `resync` în locul `ack`. Agregatorul șterge **toată** starea providerului; outboxul eliberează handle-urile, scrie `reset` și cere retrimiterea. Până la un batch care începe cu `reset`, sesiunea respinge orice altceva.
- Un plic invalid (fără `sequence` sau buffer) nu poate primi `resync`, pentru că nu se știe ce batch a eșuat: sesiunea închide legătura, iar outboxul se dezactivează.

### Validarea la primire

Decodorul și sesiunea verifică:

- headerul: magic, versiune, provider, generație și secvență egale cu plicul, `sentAt` întreg, lungime care se încadrează în buffer și în `maxBatchBytes`, fără bytes rămași;
- identitatea: ID-uri întregi pozitive sau `0`, start întreg sau `NaN`, nume UTF-8 valide (`fatal`), nevide, de cel mult 128 de caractere și diferite;
- starea live: numai flagurile cunoscute; scorul și ceasul sunt zero când flagul lor lipsește;
- valorile: prețuri `NaN` sau finite în `(1, 10 000]`, preț valid obligatoriu pentru bitul `usable`, numai flagurile cunoscute;
- handle-urile: în limite, meci definit înaintea liniilor, linie nedefinită de două ori, meci eliberat numai fără linii;
- `lineKey` cu codul de piață ≥ 1; o cheie repetată în același meci este eroare de protocol.

Sesiunea aplică batch-ul pe măsură ce îl decodează, fără o a doua trecere. O eroare oriunde șterge **toată** starea providerului și cere `resync`, deci o aplicare parțială nu supraviețuiește. Motorul primește operațiile numai după validare, iar detectorul lucrează doar la sfârșitul unui batch acceptat.

Outboxul aplică aceleași reguli înainte de scriere: o identitate invalidă, un meci necunoscut sau o cheie invalidă sunt numărate în `rejected` și nu ajung pe canal; un preț inutilizabil devine `NaN`.

## 7. Structurile de date din agregator

Structurile fierbinți sunt **struct-of-arrays** indexate după handle: valori contigue în memorie, fără obiecte per linie și fără presiune pe garbage collector. Toate tablourile sunt alocate o singură dată, la dimensiunea din `attach`.

### QuoteBook

[processing/quotes.ts](../src/aggregation/processing/quotes.ts), câte unul per provider:

| Array                | Tip            | Conținut                                                |
| -------------------- | -------------- | ------------------------------------------------------- |
| `lineEvent`          | `Int32Array`   | handle-ul meciului, sau −1 pentru o linie liberă        |
| `lineKey`            | `Uint32Array`  | cheia canonică                                          |
| `priceA`, `priceB`   | `Float64Array` | ultima valoare                                          |
| `flags`              | `Uint8Array`   | `usableA`, `usableB`                                    |
| `updatedAt`          | `Float64Array` | momentul aplicării ultimei schimbări de preț            |
| `peer`               | `Int32Array`   | linia echivalentă la cealaltă casă, sau −1              |

### EventRegistry

[processing/events.ts](../src/aggregation/processing/events.ts): per provider, un array de obiecte meci indexat după handle. Meciurile sunt puține (zeci–sute) și se schimbă rar, deci aici obiectele sunt acceptabile. Fiecare meci păstrează:

- identitatea canonică și numele normalizate, recalculate doar când numele se schimbă;
- starea live: scor, ceas (valoare, `running`, momentul ultimei schimbări), `suspended`, momentul ultimei schimbări de scor;
- `lines: Map<lineKey, lineHandle>`, folosit la linkarea liniilor; o cheie duplicată în același meci este eroare de protocol;
- `pair` și `conflict`.

### Indexurile de asociere

| Index                     | Structură                                         | Folosire                                                      |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| După Betradar             | `Map<number, AggregationEvent[]>` per provider    | Candidatul exact în O(1); lista detectează duplicatele.       |
| După timp (fallback)      | `Map<bucket, AggregationEvent[]>`, 15 min, refăcut la fiecare scanare | Candidați fără ID: bucketul propriu și vecinii din toleranță. |
| Aliasuri învățate         | `Map<string, Set<string>>`, în ambele sensuri     | Nume normalizat → nume normalizate echivalente.               |
| Competiții învățate       | `Map<number, number>`                             | `competitionId` Superbet → Betano; o contradicție o elimină.  |

Cheile absente (ID `0`, start necunoscut) nu sunt introduse niciodată într-un index.

### LineLinker

[matching/lines.ts](../src/aggregation/matching/lines.ts): când o pereche devine `confirmat`, linkerul parcurge `lines` al meciului cu mai puține linii și caută cheia în celălalt: O(min(n, m)). Pentru fiecare potrivire scrie `peer` în ambele cărți. La `line-define` într-un meci deja confirmat face o singură căutare. La `line-release`, retrogradare sau eliberarea meciului, linkurile sunt șterse în ambele sensuri, iar oportunitatea liniei se închide.

### Coada de lucru a detectorului

```
pending      Uint8Array, indexat după linia Superbet a unui link
pendingList  Uint32Array
```

Aplicarea unui batch doar marchează liniile atinse. La sfârșitul batch-ului acceptat, detectorul parcurge `pendingList` o singură dată. Zece schimbări ale aceleiași linii în același batch produc un singur calcul.

## 8. Asocierea meciurilor

[matching/matcher.ts](../src/aggregation/matching/matcher.ts) formează o pereche numai când un ID Betradar apare la **exact un** meci din fiecare casă. Mai multe meciuri cu același ID, la oricare casă, marchează ID-ul ca **conflict**: niciunul nu este asociat până când duplicatul dispare.

```mermaid
stateDiagram-v2
    [*] --> suspect: ID unic la ambele case
    suspect --> confirmat: toate verificările trec
    confirmat --> suspect: o verificare eșuează
    confirmat --> [*]: meci eliberat, ID schimbat sau duplicat
    suspect --> [*]: meci eliberat, ID schimbat sau duplicat
```

| Stare       | Folosită de detector | Semnificație                                                       |
| ----------- | -------------------- | ------------------------------------------------------------------ |
| `confirmat` | Da                   | ID Betradar identic **și** nicio verificare nu eșuează.            |
| `suspect`   | Nu                   | Cel puțin un motiv, raportat la fiecare schimbare.                 |

Verificările se refac la fiecare `event-identity`, `event-live` și sweep, deci o pereche confirmată poate fi retrogradată oricând și revine singură când contradicția dispare.

| Motiv         | Când apare                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| `start`       | Ambele starturi sunt cunoscute și diferă cu mai mult de `startToleranceMs`.                                  |
| `markers`     | Marcajele de lot (U21, feminin, II, LDD...) diferă la gazde sau la oaspeți.                                  |
| `orientation` | Numele se potrivesc mult mai bine inversat: similaritatea inversată ≥ 0,5 și cu cel puțin 0,25 peste cea directă. |
| `clock`       | Ambele ceasuri sunt cunoscute și proaspete și diferă cu mai mult de `clockToleranceSeconds`.                 |
| `score`       | Scorurile diferă de cel puțin `scoreMismatchMs`.                                                             |
| `unverified`  | Numele nu ajung la 0,5 și nici startul și ceasul nu confirmă împreună ID-ul.                                  |

### Numele

[matching/names.ts](../src/aggregation/matching/names.ts) aplică NFKD, elimină semnele diacritice, înlocuiește `ð`, `đ`, `ß`, `æ`, `œ`, `ø`, `ł`, `ı`, `þ` și scoate formele juridice și conectorii (`fc`, `cf`, `sc`, `ad`, `ec`, `clube`, `esporte`, `de`, `la`...). Marcajele de lot sunt **extrase**, nu șterse. Un `II`/`B`/`III` contează ca marcaj doar la finalul numelui.

Similaritatea dintre două nume, între 0 și 1:

- cheie identică sau alias învățat: 1; acronim complet (`PSG`): 0,9;
- pe cuvinte: identic 1; prefix de minim 3 litere 0,9; o literă diferită (`Gabala`/`Qabala`) 0,8; abreviere ca subsecvență (`Utd`) sau prefix comun de 4 litere 0,7; inițiale ale unor cuvinte consecutive (`NY` = New York) 0,9;
- scorul se împarte la numărul de cuvinte al numelui mai scurt, plus **jumătate** din cuvintele rămase nefolosite din numele mai lung (`Alianza` față de `Alianza San Salvador` = 0,5);
- un cuvânt semnificativ fără corespondent plafonează scorul la 0,4 (`Rapid București` față de `Dinamo București`);
- un cod de două litere fără corespondent (`SP`, `GO`) nu contează nici pentru, nici contra.

Exonimele (`Munich`/`München`) nu sunt ghicite: rămân la 0,4 până când un alias este învățat.

### Ceasul

Ceasurile vin ca **ancoră**: valoarea, momentul primirii și bitul `running`.

- Superbet: în `1H`/`2H`, minutul × 60 și curge; la `HT`, 45:00 oprit; altfel necunoscut.
- Betano: `secondsSinceStart`; `clockStopped` lipsă înseamnă că ceasul curge. În datele live, `clockStopped: true` apare explicit la pauză, iar în timpul jocului câmpul lipsește (Betano omite valorile implicite).
- Un ceas care curge este extrapolat de la momentul primirii; o ancoră mai veche de 10 minute nu mai este folosită. Toleranța implicită de 300 s acoperă granularitatea de un minut a Superbet.

### Fallback și învățare

`scan()` rulează la fiecare raport de statistici, peste meciurile live neasociate și fără conflict. O pereche **observată** cere: start în toleranță, marcaje egale, similaritate de cel puțin 0,7 la ambele echipe, competiție compatibilă dacă este cunoscută, niciun ID diferit la cele două meciuri și unicitate în ambele sensuri. Este raportată o singură dată și nu ajunge niciodată la detector.

[matching/learning.ts](../src/aggregation/matching/learning.ts) învață aliasuri și competiții doar din perechi confirmate de cel puțin 5 minute, cu marcaje egale. Cu `learningPath`, tabelele sunt încărcate înaintea primei sesiuni, validate și salvate atomic (fișier temporar + `rename`) la fiecare raport și la oprire. Un fișier invalid este raportat și ignorat în întregime.

## 9. Scenarii care pot produce meciuri greșite

Fiecare scenariu are o protecție și un test. Cele marcate **real** au fost găsite în datele live. Testele sunt în [aggregation-engine](../test/aggregation-engine.test.mjs), [aggregation-names](../test/aggregation-names.test.mjs), [aggregation-adapter](../test/aggregation-adapter.test.mjs) și testele de proiecție.

### A. ID-uri

| #   | Scenariu                                                               | Protecție                                                                                   |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| A1  | **Real:** ID Betradar string la Superbet, number la Betano             | Validare strictă în proiecții. Un test a prins o expresie regulată stricată la implementare. |
| A2  | **Real:** ID lipsă (9 meciuri Superbet, 4 Betano în mostră)            | Doar fallback observat. Cheile absente nu se indexează.                                     |
| A3  | Același ID la două meciuri ale aceleiași case                          | Conflict: niciunul nu este asociat până dispare duplicatul.                                 |
| A4  | ID greșit introdus de casă                                             | ID-ul singur nu ajunge: numele sau startul și ceasul împreună trebuie să-l confirme; scorul și marcajele trebuie să concorde. |
| A5  | Meci șters și readăugat, alt ID de provider, același Betradar          | Eliberarea meciului desface perechea; asocierea se reface de la zero.                       |
| A6  | ID-ul Betradar apare sau se schimbă în timpul meciului                 | Reindexare la fiecare `event-identity`, cu desfacerea perechii vechi.                       |

### B. Participanți

| #   | Scenariu                                                                                       | Protecție                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | Gazde și oaspeți inversați între case                                                          | Motivul `orientation`: perechea nu este folosită. Inversarea ar cere și inversarea semnului handicapului.                             |
| B2  | **Real:** `Atenas U21` (Superbet) și `Atenas LDD` (Betano), fără ID, aceeași oră               | Marcajele trebuie să fie egale, atât la perechile cu ID, cât și la fallback. `LDD` nu este echivalat cu `U21`.                        |
| B3  | Același nume de club în țări diferite                                                          | Fallback-ul cere competiția compatibilă când corespondența ei a fost învățată.                                                        |
| B4  | **Real:** `ș` față de `ş`, `Garðabær`, `Asociación`                                            | Normalizarea de mai sus.                                                                                                             |
| B5  | **Real:** nume scurtate sau completate (`NY Cosmos`/`New York Cosmos`, `Novorizontino SP`/`Gremio Novorizontino`, `Alianza FC`/`Alianza San Salvador`) | Inițiale de cuvinte, coduri de două litere neutre, cuvinte în plus la jumătate de greutate. Toate cazurile reale sunt teste.         |
| B6  | Nume diferite ale aceluiași club (`Genesis Policia Nacional`/`Genesis Comayagua`)             | Sub 0,5: perechea are nevoie de start și ceas care să confirme ID-ul. Live a devenit confirmată când ambele ceasuri erau cunoscute.    |
| B7  | Același oraș, cluburi diferite (`Rapid`/`Dinamo București`)                                    | Cuvântul fără corespondent plafonează similaritatea la 0,4.                                                                           |
| B8  | Aceleași echipe de două ori la interval scurt (tur-retur, U21 și seniori în aceeași zi)        | Conflict la ID duplicat; la fallback, unicitate în ambele sensuri.                                                                    |

### C. Timp și ceas

| #   | Scenariu                                                     | Protecție                                                                                       |
| --- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| C1  | **Real:** start diferit între case (19:33 față de 19:40)     | Toleranță `startToleranceMs`.                                                                   |
| C2  | Fus orar: `event_date` local față de `utc_date`              | Doar `utc_date`; dacă `unix_date_millis` îl contrazice, startul devine necunoscut.               |
| C3  | Meci reprogramat care își păstrează ID-ul                    | Motivul `start`.                                                                                |
| C4  | Ceasuri de joc foarte diferite                               | Motivul `clock`, cu extrapolare și ancore proaspete.                                            |
| C5  | **Real:** Betano omite `clockStopped` cât timp ceasul curge  | Lipsa câmpului înseamnă „curge”. Înainte de corecție, ceasul Betano era necunoscut în 40 din 47 de meciuri. |

### D. Starea live

Scorul este semnalul cel mai puternic: prinde și perechea greșită, și casa rămasă în urmă după un gol. Al doilea caz este sursa principală de arbitraje false.

| #   | Scenariu                                                     | Protecție                                                                                                  |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| D1  | Scoruri diferite                                             | Poarta `score` blochează imediat; după `scoreMismatchMs`, perechea devine `suspect`.                       |
| D2  | O casă arată meciul suspendat, cealaltă activ                | Poarta `suspended`.                                                                                        |
| D3  | Imediat după o schimbare de scor                             | Poarta `settling` pentru `scoreSettleMs`; sweep-ul reevaluează liniile când liniștea expiră.               |
| D4  | Cotă de dinaintea golului sosită după scorul nou             | Închiderea segmentului în outbox.                                                                          |
| D5  | Meci invalidat sau eliminat                                  | Liniile, linkurile și oportunitățile sunt închise imediat.                                                 |

### E. Linii

| Capcană                                         | Protecție                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Reguli de numărare diferite (P)                 | Marcaj dezactivat.                                                                          |
| Handicap asiatic cu scor curent (H)             | Marcaj dezactivat; liniile Betano cu `scoreContext` sunt oricum excluse de codec.           |
| Intervale cu limite diferite (I)                | Marcaj dezactivat; intervalele Betano terminate la limita reprizei sunt excluse.            |
| Da/Nu convertit la alt prag decât cel declarat  | Linia Superbet intră numai la pragul exact al rândului.                                     |
| Două linii vendor pe aceeași cheie              | Amândouă retrase până la următoarea bază.                                                   |
| Semnul handicapului                             | Cheia folosește valoarea liniei, orientată spre gazde în ambele proiecții.                  |
| Erori de virgulă mobilă la prag                 | Prag în sferturi de unitate; valorile nealiniate sunt respinse.                             |

## 10. Detectorul

[processing/detector.ts](../src/aggregation/processing/detector.ts), pentru o linie Superbet `x` din coada de lucru, cu `y = peer[x]`:

```
dacă y = −1 → închide („unlinked”)
dacă o poartă este închisă → închide (motivul porții)
s1 = 1/priceA[x] + 1/priceB[y]     (doar dacă usableA[x] și usableB[y])
s2 = 1/priceA[y] + 1/priceB[x]     (doar dacă usableA[y] și usableB[x])
S  = min(s1, s2);  marjă = (1/S − 1) în puncte de bază
dacă marjă < minMarginBps → închide („margin”)
```

Cu două rezultate există doar două combinații încrucișate; combinația în aceeași casă poartă mereu marja casei. Calculul este O(1).

Porțile, în ordinea în care sunt verificate, dau și motivul închiderii: `pair` (perechea nu este confirmată), `not-live`, `suspended`, `score` (scor necunoscut sau diferit), `settling`, `lag` (ultimul batch al unui provider a întârziat peste `maxLagMs`).

**Vârsta unui preț nu blochează comparația.** Un preț neschimbat este valid cât timp meciul este sincronizat; providerii invalidează meciul la deconectare, gap sau inactivitate. Vârsta fiecărui preț este însă raportată (`ageMs`), pentru decizia manuală: un preț vechi față de unul proaspăt indică de obicei o casă rămasă în urmă.

| Rezultat      | Condiție                                     | Efect                                                 |
| ------------- | -------------------------------------------- | ----------------------------------------------------- |
| sub prag      | marjă < `minMarginBps`                       | Ignorat; o oportunitate deschisă se închide.          |
| oportunitate  | `minMarginBps` ≤ marjă ≤ `suspiciousMarginBps` | Deschisă sau actualizată.                           |
| suspectă      | marjă > `suspiciousMarginBps`                | Marcată `suspicious`: eroare de mapare sau casă în urmă. |

Fiecare picior raportează casa, rolul (`A`/`B` și eticheta: over, under, yes...), cota, partea din miza totală (`(1/cotă)/S`) și vârsta prețului.

### Ciclul de viață al oportunităților

- Oportunitățile deschise stau într-un `Map<linie Superbet, stare>`; sunt puține.
- Un singur timer (`sweepMs`) reevaluează matcherul, liniile perechilor a căror liniște tocmai a expirat și oportunitățile deschise. Nu există timere per linie.
- Se raportează deschiderea, schimbarea direcției, o schimbare de marjă de cel puțin `reportStepBps` și închiderea, cu durata și marja maximă.
- Rapoartele (perechi, candidați observați, oportunități) se adună și pleacă spre main la cel mult `reportIntervalMs`; coada lor este limitată, iar depășirile sunt numărate.

### Recorderul

Cu `recordPath`, fiecare raport este scris ca o linie JSON, printr-un `WriteStream` în modul append. Cât timp fișierul cere așteptare, liniile stau într-o coadă limitată (`recordBufferLimit`); peste limită, cele mai vechi sunt numărate ca pierdute. Detecția nu așteaptă niciodată după disc.

## 11. Performanță: unde se duce costul

| Cale                       | Frecvență        | Cost                                          | Cum                                                                                   |
| -------------------------- | ---------------- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| Preț schimbat în provider  | Foarte mare      | O(1), fără alocare                            | Două căutări în `Map`, scriere în `Float64Array`, bit `dirty`.                         |
| Linie nemapată             | Foarte mare      | O(1)                                          | Un `Map.get` pe tipul vendor; nu ajunge pe canal.                                     |
| Trimiterea unui batch      | ≤ 1 / `batchWindowMs` per provider | O(linii modificate)          | Scriere secvențială în bufferul curent; transfer, nu copiere.                         |
| Aplicarea unui batch       | Idem             | O(operații + valori)                          | `DataView`; indexare directă după handle.                                             |
| Detector                   | Per linie atinsă | O(1)                                          | Două sume de inverse.                                                                 |
| Schimbare de identitate    | Rară             | O(lungimea numelor)                           | Normalizare o dată, păstrată pe meci.                                                 |
| Confirmarea unei perechi   | Rară             | O(min(n, m))                                  | Parcurgerea liniilor meciului mai mic.                                                |
| Sweep                      | La `sweepMs`     | O(perechi + oportunități deschise)            | Nu parcurge liniile.                                                                  |
| Fallback                   | La `statsIntervalMs` | O(meciuri neasociate × candidați din buckete) | Doar meciurile live neasociate.                                                  |

- **Bufferele se refolosesc.** Agregatorul întoarce bufferul transferat în ACK; outboxul păstrează până la două în pool.
- **Fără string-uri pe calea fierbinte.** Cheile de linie sunt numere, handle-urile sunt indecși.
- **Măsurare.** Statisticile periodice includ, per provider, batch-urile, operațiile, valorile, bytes, întârzierea ultimului batch și maximele ferestrei pentru întârziere și timpul de aplicare. Detectorul raportează liniile linkate, liniile comparate în fereastră și cea mai bună marjă văzută, inclusiv negativă. Un benchmark de alocări nu există încă.

## 12. Configurare

Valorile sunt în [config.ts](../src/aggregation/config.ts). Numerele trebuie să fie întregi pozitivi siguri, ca la provideri; de aceea marjele sunt în puncte de bază.

| Opțiune                 | Implicit  | Semnificație                                                        |
| ----------------------- | --------- | ------------------------------------------------------------------- |
| `batchWindowMs`         | 25 ms     | Fereastra maximă de coalescență în outbox.                          |
| `maxEvents`             | 4 096     | Handle-uri de meci per provider.                                    |
| `maxLines`              | 65 536    | Handle-uri de linie per provider.                                   |
| `maxBatchBytes`         | 16 MiB    | Limita unui batch; cel puțin dublul stării complete.                |
| `enabledConditions`     | `D`, `T`  | Marcajele de corespondență active.                                  |
| `statsIntervalMs`       | 5 s       | Statistici, scanarea fallback, salvarea tabelelor învățate.         |
| `startToleranceMs`      | 30 min    | Diferența maximă de start.                                          |
| `clockToleranceSeconds` | 300 s     | Diferența maximă de ceas de joc.                                    |
| `scoreSettleMs`         | 5 s       | Liniștea după o schimbare de scor.                                  |
| `scoreMismatchMs`       | 60 s      | Diferența de scor după care perechea devine `suspect`.              |
| `maxLagMs`              | 2 s       | Întârzierea maximă a ultimului batch al unui provider.              |
| `minMarginBps`          | 50        | Marja minimă raportată (0,5%).                                      |
| `suspiciousMarginBps`   | 1 000     | Peste 10%, oportunitatea este `suspicious`.                         |
| `reportStepBps`         | 10        | Schimbarea minimă de marjă care produce o actualizare.              |
| `sweepMs`               | 250 ms    | Perioada sweep-ului.                                                |
| `reportIntervalMs`      | 250 ms    | Ritmul maxim al rapoartelor către main.                             |
| `recordBufferLimit`     | 10 000    | Linii JSONL ținute cât timp fișierul cere așteptare.                |
| `fallbackMode`          | `observe` | `off` sau `observe`. Un mod activ nu există.                        |
| `recordPath`            | `null`    | Fișierul JSONL; fără el nu se înregistrează nimic.                  |
| `learningPath`          | `null`    | Fișierul tabelelor învățate; fără el, învățarea ține doar în memorie. |

Constructorul mai verifică: marcaje din enum, `minMarginBps` sub `suspiciousMarginBps`, căi nevide, limitele de batch coerente și maparea validă față de ambele cataloage.

## 13. Etape

| Etapă | Conținut                                                                                                       | Teste                                                                                         |
| ----- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1 ✔   | Formatul binar, validarea, outboxul, sesiunea, workerul, controllerul, ACK, generații, `resync`.               | [wire](../test/aggregation-wire.test.mjs), [outbox](../test/aggregation-outbox.test.mjs), [session](../test/aggregation-session.test.mjs) |
| 2 ✔   | Betradar în proiecții, maparea validată, adaptorul generic și codecurile, `EventRegistry`, `QuoteBook`.        | [mapping](../test/aggregation-mapping.test.mjs), [adapter](../test/aggregation-adapter.test.mjs), testele de proiecție |
| 3 ✔   | `EventMatcher` cu verificările A–D și raportul live.                                                           | [engine](../test/aggregation-engine.test.mjs), [names](../test/aggregation-names.test.mjs)    |
| 4 ✔   | `LineLinker`, detectorul, porțile, ciclul de viață, recorderul.                                                | [engine](../test/aggregation-engine.test.mjs), [files](../test/aggregation-files.test.mjs)    |
| 5 ✔   | Fallback observat, aliasuri și competiții învățate, salvate atomic.                                            | [engine](../test/aggregation-engine.test.mjs), [files](../test/aggregation-files.test.mjs)    |

Rămân deschise: activarea marcajelor P/A/H/I după confirmarea regulilor, reatașarea agregatorului după o cădere și un benchmark de alocări.

## 14. Decizii aplicate

Implicit este aleasă varianta conservatoare:

1. **Gazde/oaspeți inversați:** perechea este `suspect` și nu este folosită.
2. **Fallback pe nume:** doar observat.
3. **Statusul Superbet:** numai `status === 1` este utilizabil.
4. **Marcaje active:** `D` și `T`, fără combinațiile lor cu `P`.

## 15. Observații live

Rulări de 1–2 minute pe ofertele live, după corecțiile de nume și ceas:

- 46 de meciuri Superbet și 48 Betano urmărite de agregator; **43 de perechi confirmate**, 0 suspecte, 0 conflicte, 2 candidați doar pe nume.
- 389 de linii linkate; cea mai bună marjă dintr-o fereastră obișnuită a fost −4,2%, adică nicio oportunitate, cum este normal.
- Întârzierea batch-urilor: 0–1 ms.
- Un episod pe un singur meci: cinci linii de goluri în prima repriză au deschis oportunități în aceeași direcție (1,9–11,5%) și s-au închis toate după 12 s, la scor egal. Tiparul indică o casă care a reacționat mai repede la o fază, nu o eroare de mapare; de aceea fiecare picior raportează acum vârsta prețului. Cea de 11,5% a fost marcată `suspicious`.
- Perechile Superbet se desfac și se refac la reparațiile de stream ale providerului (snapshot nou după invalidare). Este comportamentul dorit: o bază nouă nu se amestecă cu cea veche.
