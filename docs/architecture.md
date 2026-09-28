# STEP 0 architecture

This refactor preserves LV1 rules, content, timing, randomness, controls and LCARS presentation. It adds no gameplay or model integration.

## Authority and identities

The Electron main process owns `SimulationEngine`. Renderer pages consume copied snapshots and submit typed commands through the existing preload IPC. Validation, movement, combat, mission settlement and resources remain in the engine. Canvas interpolation remains presentation-only.

Commander and Operator identities are separate from Ship entities. Each LV1 operator has one ship assignment, stored only in `Operator.shipId`; saved v2 worlds require one operator per ship and distinct actor IDs. A ship stores physical state, effective attributes, orders and stable `classId`/`factionId` references. Changing controller assignments is not a player feature.

`getObservation(operatorId)` resolves the operator before its ship and returns a detached observation. `controllerPort(operatorId)` binds the same observation/command methods to one operator identity without exposing engine state. Adapters must be given this port rather than the engine. Existing commander commands and rules automation retain their scheduling and authorization; no new agent loop runs.

## UI boundaries

App retains navigation, selected ship/mission, route, mission filter and reset-dialog state so extracting pages does not reset user choices when navigating. The six pages and shared inspectors receive snapshots and callbacks. The LCARS shell provides page, inspector and overlay slots without adding DOM wrappers.

`useFrontier` manages IPC subscription and command feedback. `useHelmControls` owns keyboard/pointer input and the original 80ms input cadence. These hooks live at App level, so changing pages does not duplicate subscriptions or timers. Simulation results never come from renderer-local state.

## Definitions and mutable worlds

`src/engine/definitions` contains recursively frozen TypeScript records for the existing factions, ship classes, locations and resources, plus the initial fleet roster. Definition modules have no runtime dependency on Electron or React.

World creation copies defaults into independent mutable entities. Ship names/registries belong to fleet instances, while science, cargo capacity, power, speed and shield defaults belong to classes. Faction-specific contact stats and responses are read from faction definitions; all formulas and random-call ordering remain unchanged. Resource definitions supply starting balances and the existing resupply amounts/caps.

Effective ship attributes and location state remain serialized. Loading never recomputes them from current defaults. New content or balance changes require a separate gameplay change; adding a persisted shape requires an explicit schema/migration change rather than silently changing existing worlds.

## Save evolution

The frozen v1 validator lives in `save-v1.ts`. `save-schema.ts` validates the v2 runtime shape; `saves.ts` dispatches versions and performs pure v1 migration. Migration maps the three known legacy ship IDs to their class/faction definitions, removes the redundant ship-side operator ID and preserves all other effective state. Unrecognized legacy ship identities are rejected rather than assigned invented classes.

The v2 schema validates unique IDs, definition references, one-to-one operator assignments and existing simulation/mission invariants. It does not hardcode the LV1 counts of three ships, six missions and eight locations. This is schema preparation, not support for arbitrary new gameplay entities.

Read precedence is v2 primary → v2 backup if either v2 file exists; otherwise v1 primary → v1 backup. A recognized future/unsupported version blocks recovery from an older generation and cannot be overwritten. Invalid current-format data retains the original corruption-recovery behavior.

Writes validate the current schema, rotate a valid v2 primary to backup, archive a corrupt v2 primary and replace the file through a temporary write. Legacy files are untouched during migration and ordinary saving. Explicit reset archives both generations and their backups. Startup still pauses and clears helm input; migration itself does neither, allowing deterministic continuation tests.

## Regression evidence

`tests/fixtures/lv1` holds snapshots captured from the original engine, with a documented seed and command sequence. Tests compare complete migrated states at initial, underway, manual-control and continued checkpoints, not just two executions of the refactored engine.

Run `npm test`, `npm run test:e2e` and `npm run build`. Electron tests use isolated temporary user-data directories and exercise existing layouts/controls plus legacy migration, v2 restart and cross-page selection/filter preservation.
