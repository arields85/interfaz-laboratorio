# PROD-TREND Capture Renewal

This guide is the controlled procedure for adding a genuine, reviewable PROD-TREND capture from either the Activity-Series response or `/api/hmi-data/history`. It keeps the HMI read-only, preserves the existing real-data contract, and makes missing history explicit instead of inventing a dataset.

## Current status

One genuine capture is packaged now:

| Identity | Source | Asset |
|---|---|---|
| Machine `11`, range `24h` | `/api/hmi-data/history`, `Total kW` | `hmi-app/src/assets/prod-trend-captures/capture-11-24h.json` |

`manifest.json` lists that identity as available and retains `no-genuine-capture` for identities not covered by a genuine asset.

## Authoritative identity and source

The production real-data source remains the existing **Activity-Series** request and response. Packaged capture identity is exactly:

| History kind | Identity |
|---|---|
| Standard range | `machineId + range` |
| Custom range | `machineId + range=custom + start + end` |

`variableKey` is **not** part of runtime capture identity, cache keys, or filenames. A history response must still declare `variableKey: "Total kW"`; the canonical asset preserves it inside signed endpoint provenance, not as a substitute identity.

The production path remains:

`useProdTrendDataSource → useActivitySeries → fetchActivitySeries → adaptActivitySeries`

Renewal does not change that path, its endpoint, query key, adapter, or snapshot builder. The importer reads a previously captured JSON response and writes only the fixed local capture destination.

## Quick path

Run from `D:\interfaz-laboratorio\hmi-app` (or the equivalent `hmi-app` directory) with the raw response file:

```text
npm run renew:prod-trend-capture -- <history-or-activity-series-response.json>
```

The response itself supplies `machineId`, `range`, and, for `custom`, the exact `window.start` and `window.end`. The input path must be a regular, non-symlink file whose extension is `.json`.

The importer writes to `hmi-app/src/assets/prod-trend-captures/` using an identity-derived name:

```text
capture-<machineId>-<range>.json
capture-<machineId>-custom-<compact-start>-<compact-end>.json
```

## Input contracts and validation

The input must be a raw response, not a pre-enriched capture envelope, hand-authored trend, or transformed export.

| Contract | Required discriminator | Additional rules |
|---|---|---|
| Activity-Series | `purpose: "activity-analytics"` | Complete bucket coverage after existing Activity-Series validation |
| History | No `purpose`; `variableKey: "Total kW"` | Every point must be valid and strictly chronological; no filtering or reordering |

Both contracts require a non-empty `contractVersion`, valid `machineId` and `range`, a valid window, and timestamped finite numeric or `null` values. `unit` is preserved when present. Imported source summaries are ignored and recomputed from the adapted series.

The importer derives the capture identity from the response. It adds the current capture schema version and an import-time `capturedAt`, preserves the response contract version and source provenance, computes the SHA-256 checksum, and then writes the canonical capture. `capturedAt` records when renewal imported the response; it is not a fabricated plant measurement timestamp. An invalid purpose, identity, contract, window, or JSON aborts import before output is produced.

Activity-Series keeps its original validation:

1. Filter invalid point objects, timestamps, non-finite numbers, and unsupported values.
2. Discard points outside the half-open capture window `[start, end)`.
3. Discard points whose timestamp is not aligned to `bucketMs` from the window start.
4. Sort accepted points by ascending offset from the original window start.
5. Require complete bucket coverage: every expected offset must occur exactly once, including buckets whose original value is `null`.

Invalid points are therefore filtered, not individually fatal. Import fails only when the resulting source contract or coverage is invalid. The importer preserves every accepted original value, including `null`; it does not interpolate, scale, smooth, round, or replace values. Incomplete coverage is rejected rather than filled.

History responses use stricter preservation rules:

1. Reject the whole import if any point, timestamp, value, ordering, or duplicate timestamp is invalid.
2. Preserve every point and its sequence exactly; do not sort, deduplicate, filter, fill, or align points to buckets.
3. Convert timestamps only to offsets from the original `window.start`. A point exactly at `window.end` remains valid.
4. Require the history variable to be exactly `Total kW` and record `/api/hmi-data/history` in provenance.

## Canonical output, provenance, and checksum

The generated capture is the canonical trusted asset. It contains:

```text
schemaVersion
provenance: { purpose, contractVersion, capturedAt, endpoint?, variableKey? }
identity: { machineId, range, start?, end? }
window: { start, end, bucket, bucketMs, timezone? }
unit
points: [{ offsetMs, value }]
checksum
```

Canonical `points` use offsets from the original window start, so timestamp adaptation can move a capture to the selected window without changing values or order. The importer recomputes the output checksum as SHA-256 over canonical content and excludes `checksum` and any obsolete top-level `variableKey` from digest material. History provenance includes its validated `variableKey`, which is covered by the checksum.

When a packaged capture is later rehydrated, timestamps and the selected window may be adapted, but values and order remain unchanged. Imported summaries are not trusted; analytics and summaries are recomputed from the one selected source. Real, last-known-good, and packaged points must never be mixed.

The packaged-capture loader validates this same nested canonical object before rehydration. It does not accept either raw response envelope as an on-disk capture: raw envelopes are importer input only, while `provenance`, `identity`, and offset-based `points` are the single packaged contract.

## Review and manifest renewal procedure

Repeat these steps independently for every supported machine and standard range that should have a packaged fallback, and for each approved custom window:

1. Obtain a genuine current response from an approved read-only history path. Preserve the response bytes; do not manually edit its series.
2. Confirm the machine, range, and custom `window.start`/`window.end`. For history responses, also confirm `/api/hmi-data/history` and `variableKey: "Total kW"`.
3. Review the response for the applicable validation rules above: complete bucket coverage for Activity-Series, or exact point/order preservation for history.
4. Run the exact package command from `hmi-app` with the reviewed fixture.
5. Inspect the generated canonical JSON, checksum, identity-derived filename, and `points` ordering. Run the focused importer tests and the full verification suite before review.
6. Add one `available: true` entry to `manifest.json` with the exact `id`, `machineId`, `range`, custom `start`/`end` when applicable, and generated `file` path. Keep the manifest schema version unchanged unless the contract itself changes.
7. Do not remove an `unavailable` entry for one identity: the current manifest stores `unavailable` as global reason records, not identity-specific declarations. Keep the global reason record for uncovered identities; availability is represented by the identity-specific `captures` entry.
8. Review the complete diff: the capture must be a real source artifact, its checksum must validate, and no unrelated production file may change.

The manifest is an availability index, not a place to manufacture coverage. A missing identity remains unavailable with an explicit reason such as `no-genuine-capture` or `capture-missing`; the UI must continue to expose that state.

## Security and path rules

- Accept only a regular, non-symlink `.json` input file.
- Reject directories, symlinks, missing files, malformed JSON, and unrelated paths such as dependency/build files or executable documentation.
- Use the fixed importer destination under `src/assets/prod-trend-captures`; never derive an output directory from untrusted input.
- Do not overwrite or mutate the source fixture as part of renewal.
- Do not copy secrets, credentials, control endpoints, or personal data into a capture.
- Renewal is read-only with respect to the plant: it performs no `POST`, `PUT`, or `DELETE`, and sends no process-control command.
- Never use random, synthetic, placeholder, interpolated, or fabricated values. If genuine data is unavailable, leave the identity unavailable.

## Missing captures

An unsupported or not-yet-captured identity must remain explicitly unavailable in `manifest.json`. Do not create an empty capture, a generated curve, a random series, or a fake checksum to make Simulated or fallback mode appear available. The correct result is an explicit missing-source state and no packaged dataset for that identity.

## Rollback or removal

If a capture is found to be wrong, stale, misidentified, or unverifiable:

1. Stop using it and do not regenerate derived data from it.
2. Remove only its generated `capture-*.json` file.
3. Remove its `available: true` manifest entry.
4. Ensure the global explicit unavailable reason remains present while no genuine replacement covers the missing source.
5. Re-run importer tests, manifest/repository tests, `git diff --check`, and the relevant build checks.

This rollback removes only the affected capture and availability declaration. It does not revert the Activity-Series service, adapter, query, snapshot builder, or unrelated work.

## Verification checklist

- [ ] Source response is genuine approved history for the exact machine/range identity.
- [ ] Custom captures use exact `start` and `end`; `variableKey` never replaces runtime identity.
- [ ] Provenance, checksum, applicable coverage/order rules, offsets, and original values pass review.
- [ ] Manifest entry and generated filename identify the same capture.
- [ ] Missing identities remain explicitly unavailable.
- [ ] No random, synthetic, fabricated, or control-plant behavior was introduced.
- [ ] The focused importer test, full test, lint, build, lockfile dry-run, and diff checks pass or have documented pre-existing failures.
