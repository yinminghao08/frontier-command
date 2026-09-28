# STEP 1 architecture

The strategic world uses a persistent accelerated calendar and explicit critical-event pauses. Existing rule automation and controller ownership remain; no model integration or Agent AI is added.

## Simulation time and critical boundaries

All engine durations, rates, deadlines, cooldowns and timestamps use game minutes. Integer ticks are authoritative: one step is 0.1 game minute. The host calls advanceFrame every nominal 100ms; 1x/4x/16x execute 1/4/16 fixed steps. Host delays never produce offline catch-up. Rendering, input sampling, notifications and filesystem timestamps may use host clocks without affecting gameplay calculations.

step and advanceFrame return typed events. dayBoundary contains the entered day, tick and simulation time and is emitted exactly once at each multiple of 14,400 ticks. It is independent of the bounded log and is not replayed on loading. Daily autosave integration is intentionally deferred; existing save triggers remain.

Explicit transition sites collect investigation, first detection, hostility, hull below 30%, disablement and mission failure reasons. A command or fixed step completes atomically, then pauses and clears helm input. The host batch stops before another step. Reasons persist in snapshots/saves until explicit resume, and continued conditions do not retrigger. Logs alone never trigger a pause.

## Geography

The map is 1600x800: Federation x<1040, Neutral Zone 1040<=x<1280, Romulan x>=1280. New Dawn is at (880,430); migrated worlds retain their saved base. Docking, return routing and towing resolve the base from the world instance. Mines, M-class planets and additional border/colony landmarks have region IDs but no new economic or AI mechanics. Manual fleet movement remains capped at x=1040.

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

Frozen v1 and v2 validators read legacy files; the runtime schema validates v3. Pure migration preserves integer ticks, numerical timers, effective stats, positions, routes, resources and PRNG state, adds region metadata and missing landmarks, translates old timer labels, and maps 2x to 1x. Existing locations are not moved.

Read precedence selects the newest generation present (v3, then v2, then v1) and tries its primary then backup. Corruption never causes rollback to an earlier generation; unsupported versions block loading/writing. Normal saves write world-v3.json and preserve all legacy files. Explicit reset archives all three generations and backups. Startup pauses and clears helm inputs without advancing simulation time.

## Regression evidence

The original LV1 fixtures remain unchanged. Historical replay tests start from migrated geography and explicitly acknowledge new critical pauses while retaining the original fixed-step checkpoints. Dedicated tests cover clock progression, all pause transitions, frame-batch stopping, midnight delivery, geography, versioned migration and recovery. Electron tests verify the rendered controls, strategic map, pause reasons and saved-world restart.

Run npm test and npm run test:e2e (which includes the production build). Electron tests use isolated temporary user-data directories.
