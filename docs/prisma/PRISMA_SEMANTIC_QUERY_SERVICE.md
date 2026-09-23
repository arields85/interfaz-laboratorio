# Prisma semantic query service

**Status — agreed design direction, not an implemented service.** The initial bounded proof is
pending and unauthorized. Current work records this design and backs up the accepted stable state;
it does not change runtime behavior, choose a provider, or enable autonomous Channel B.

This is the focused design authority under the [Prisma master](PRISMA_DOCUMENTO_MAESTRO.md).
Execution status and authorization live in the [single ODD tracker](../../odd/tasks/prisma-semantic-query-service.md);
[PW-003](../PENDING_WORK.md) remains the broader assistant umbrella.

## 1. Outcome and boundaries

Prisma should answer typed, on-demand **current-data** queries about published, assigned HMI
definitions accessible to a normal user, even outside the active view. The authoritative answer
is the HMI's interpreted result under its published configuration, not a raw sensor value that
merely resembles it. Industrial access remains strictly read-only.

- Channel A retains its session context and voice. Future navigation affects only the originating
  session and is separate from obtaining a result; queries do not navigate or render a real screen.
- Future Channel B consumes the same semantic foundation without an end-user browser, audio, or
  HMI navigation. Its implementation remains deferred; a core proof is not autonomous B delivery.
- Shared calculations do not mean shared conversations, unrestricted permissions, or global audio.
  Existing runtime safeguards and accepted CL behavior remain intact.
- Node-RED is the current actual source reported by the user. The service remains a consumer of
  the [source-neutral HMI contract](../DATA_CONTRACT.md), not a Node-RED-specific query architecture.

## 2. Proposed query boundary

```text
published + assigned + accessible definitions
  -> derived semantic catalog / versioned configuration
  -> discover candidate -> typed target validation + authorization
  -> demand execution using shared interpretation, data, clock and retained state
  -> typed current result with genuine freshness / availability
  -> channel-specific ordinary answer
```

This is a proposed flow, not a new endpoint or an existing server deployment.
Discovery may help identify candidates; deterministic execution only accepts a validated target.
The trusted scope is installation + `dashboardId` + `viewId` + `widgetId`, with a field identifier
only where the widget supports fields. Installation authority is not supplied by an arbitrary label.

Labels such as `Producción` normally repeat. Even `view-default` is dashboard-scoped. Unknown,
multiple, unpublished, unassigned, or unauthorized matches must clarify or fail explicitly;
never select the first match, borrow another dashboard's default, or invent a fallback target.
The catalog describes supported semantics, not an assumption that every widget supports every query.

Initial typed results distinguish presentation text from current activity. Text comes from the
published presentation definition; activity comes from the shared stateful interpretation.
Availability, definition revision, observation time and freshness must remain truthful. A fresh
response timestamp alone does not prove fresh industrial data. Exact wire types are future work.

Real and demo modes produce equivalent ordinary answers when the HMI shows equivalent results.
Do not require source origin in model context or append automatic simulation disclaimers. Internal
source management, freshness and error handling remain necessary: a real-data failure must never
silently activate demo data or present an unavailable value as current.

## 3. Configuration and semantic ownership

Today, publication, catalog and shift settings are browser-local; there is no implemented server
configuration distribution. An editor working copy is not the published definition visible to users.
The proposed manifest is **automatically derived and versioned**, without credentials, manual
duplicate configuration, or a second set of formulas maintained on the server.

Distribution and acknowledged revision activation must be designed before production claims:
which publisher is authoritative, which revision is active, and how changes invalidate results and
state must be explicit. A stale or unacknowledged revision cannot silently masquerade as current.
Transport, activation protocol and deployment ownership are not selected by this document.

HMI and query must reuse one interpretation and correct result/state ownership under the same
configuration. Reusing a pure function while running independent histories is not sufficient.
Cache/reuse boundaries need installation, authorization, target and revision scope, without
leaking session context. The exact ownership and retention mechanism remains to be implemented.

The current frame/snapshot remains useful as optional Channel A visual context. The exporter is
active-view-only, pauses when hidden/offline, and does not contain all final renderer analytics.
It is therefore not the universal data source for this foundation.

## 4. Stateful activity without a hidden UI

Demand activation, reuse and expiry are the default direction, not a promise of stateless work.
Stateful targets may need continued observation or retained state between requests. No timeout,
idle lease, universal retention duration, or measured capacity limit has been chosen.

Extract reusable TypeScript state transitions and clock/data inputs from `useMachineActivity`;
do not manually port the formulas into Python. Preserve smoothing, hysteresis, confirmation,
source/configuration changes and invalid-data semantics. An instantaneous snapshot helper or one
cold sample cannot reproduce an observer's prior state. Rendering and React lifecycle are not
required semantic inputs and should not be simulated by mounting hidden widgets.

The user accepts a cold query waiting for usable state, then returning temporary unavailable
within an eventual deadline. Never invent a stopped state while warming up or when data is invalid.
The human-facing answer stays simple; internal samples and confirmation state are not a new
history-storage feature, historical report, or explanation the user must consume.

## 5. How the direction evolved

| Considered approach | Useful part and practical limit |
|---|---|
| Improve visible snapshots | Useful A context, but misses off-view targets and some final calculations. |
| Query the raw industrial source | Supplies data, but cannot replace HMI interpretation/configuration. |
| Always-on server HMI | Evaluated possibility compatible with no end-user B browser; still needs lifecycle/visibility handling, off-view coverage and configuration synchronization. |
| Sequential ghost traversal | Visits targets, but can lose observer state and leave uneven result ages. |
| Hidden browser widgets | Retain UI machinery and mounting/rendering costs; hiding is not nonvisual execution. |
| Continuous truly nonvisual processing | Avoids rendering, but observation/calculation costs remain unmeasured and depend on dependencies, cadence and state, not dashboard count alone. |
| Typed demand execution with scoped reuse | Selected direction limits unnecessary work while allowing stateful exceptions and honest cold unavailability. |

No experiment established universal exhaustion at 100 dashboards, nor that demand is always cheaper.
The cost/latency proof must measure the relevant workload rather than convert an intuition into a limit.

## 6. Exactly four bounded proof goals

All four are **NOT AUTHORIZED / NOT STARTED** until a fresh explicit user instruction.
A core proof may inject configuration, samples and a clock; that proves only the exercised core,
not configuration distribution, live industrial connectivity, a deployed service or autonomous B.

| Tracker ID | Required proof |
|---|---|
| QRY-1 | Simple assigned lot query: resolve the published accessible text target by IDs and return exactly its displayed text without OCR/rendering, including off-view resolution. |
| QRY-2 | Current MachineActivity: shared state/clock fidelity and HMI parity, including cold waiting/unavailability instead of invented stopped state. |
| QRY-3 | Publication changes and HMI parity: revision/configuration activation, assignment and access changes remain consistent without manual duplication. |
| QRY-4 | Cost/latency: measure demand activation, reuse, retained-state requirements and expiry under representative dependencies; report limits honestly. |

The first lot example comes from user editor screenshots: dashboard `Comprimidora Fette 2000`,
initial view `Producción`, text-title `Lote: BT-2407`. It is provisional until a real live lot exists.
It is **not** an InfoCard or an established Node-RED lot variable. Order is not lot: no order alias,
substitution or fallback. The first result uses published text-title `widget.title`/presentation text.

Actual stable IDs and exact `publishedSnapshot` text still need verification; an editor screenshot
is not runtime proof. Do not hardcode these names or sample values, or assume all text-title widgets
represent lots. A future live binding may change while the user's lot-query intent stays the same.
No historical reporting, STT, navigation, full B implementation or production rollout is added here.

## 7. Discovery and language tooling

Typed read-only tools are the baseline: tool selection does not authorize a target or compute its
meaning. RAG may assist document retrieval/discovery, not replace deterministic HMI calculations.
No new dependency, model, provider or source decision follows from these recommendations.

Jev is an optional later selector benchmark against the baseline, not a selected dependency.
Constrained output shape is not semantic correctness; Choice supports at most 255 choices per
question. Early-access status and vendor speed claims are not measured production evidence here.
The following previously researched sources are reference material, not new network verification:

- [Typed function calling](https://developers.openai.com/api/docs/guides/function-calling).
- [RAG overview](https://learn.microsoft.com/en-us/azure/search/retrieval-augmented-generation-overview).
- [Jev introduction](https://typesafe.ai/blog/introducing-system-one-models-and-jev) and
  [Choice primitive](https://docs.typesafe.ai/primitives/choice).

## 8. Recovery and implementation entry points

Existing paths, not files introduced by this proposal:

- [Published definitions and widget types](../../hmi-app/src/domain/admin.types.ts).
- [Dashboard/view normalization](../../hmi-app/src/utils/dashboardViews.ts).
- [Stateful activity hook](../../hmi-app/src/hooks/useMachineActivity.ts).
- [Current runtime/parser](../../services/prisma-runtime/src/prisma_runtime/local_presentation.py).

Implementation file placement and transport are still proposed, not created. Resume through the
[ODD tracker](../../odd/tasks/prisma-semantic-query-service.md) and master §3.4/§11.1 after explicit
authorization. Current delivery is documentation plus parent-owned stable backup from `19adf7d`;
CL/Telegram/HMI voice/orb and normal Ctrl+C remain accepted within their recorded limits.
