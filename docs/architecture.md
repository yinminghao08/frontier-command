# LV1 v4 architecture

## Step 1 retained

The Electron main process owns SimulationEngine. Commander and Operator identities remain separate from Ship. The 1600×800 strategic geography, fixed 0.1 game-minute step, integer tick calendar, 1/4/16 step batching, critical-event pauses and midnight events remain. No offline catch-up and no wall-clock gameplay decisions.

Renderer state is selection, camera, navigation and draft input only. It submits validated commands through the existing limited preload API. There is no LLM runtime or per-frame AI helm input.

## Rules and data flow

- Frozen definitions contain geography, factions, ship classes, weapons and global timing rules.
- navigation.ts handles bounded movement and routes scored against charted anomalies and player-known contacts; hidden enemies never enter route scoring.
- sensors.ts builds faction intelligence separately from true enemy entities. Snapshot and Observation are explicit projections; new private WorldState fields cannot accidentally leak through a spread.
- combat.ts handles ROE eligibility, retreat conditions, resource recovery, weapon cooldown, energy, ammo and hit rolls.
- threats.ts performs periodic deterministic decisions using enemy sensor observations and publicly charted colonies. No target is an allowed outcome.
- engine.ts retains the command/step/snapshot/controllerPort entrypoints and coordinates Order lifecycle, actual inventory transfer, docking, service, events and subsystem order.

Each tick advances time, refreshes sensors on its cadence, processes scheduled logistics/incursions, advances friendly ships, advances enemy ships, advances orders, then applies critical pauses atomically. Each loop uses stable entity order and the saved PRNG. All timing uses game minutes.

## Public interfaces

OperationOrder replaces the six fixed mission cards. OrderSpec contains a typed objective, shipIds, priority, ROE, territory authorization, retreat thresholds, and transport/exploration parameters.

Commands: createOrder, updateOrder, cancelOrder, holdOrder, resumeOrder, investigate, scan, recall, repair, rearm, acknowledge, pause and speed. Create/modify validate before mutation. Update cannot silently change loaded cargo or reset an investigation already underway.

snapshot() returns own ships, own orders, public locations, filtered intelligence, observable effects, resources and communications. It does not return enemy entities, their intent, sensor memory, PRNG or spawn schedule. Romulan location economic/defense values are withheld. getObservation(operatorId) gives detached observations and legal actions for the assigned ship; controllerPort binds command authority.

## Intelligence and combat authority

IntelRecord is not an Enemy object. CONTACT omits identity; CLASSIFIED provides faction; IDENTIFIED and TRACKED can provide ship identity. Last known coordinates and observation time are stored, not synthesized from the live enemy. Expiration hides map markers while retaining history and observed resolution evidence.

Only sensed, identified contacts satisfy fire eligibility. Physics checks range/cooldown/energy/ammo and cloak state. Weapons spend resources even on a miss. Attacks against our ships or facilities produce observable reports/effects. A target disappearing is not proof of a successful intercept.

High-level defense may temporarily chase a threat; when the threat leaves, the ship returns to its protected objective. Normal return paths terminate at distinct physical base berths so docked markers stay selectable.

## Orders and inventory

Transport reserves source stock at acceptance, deducts it only at loading, and transfers actual remaining cargo at unloading. Cancellation releases reservations; returned cargo is recovered at base. Pirate theft reduces actual cargo; partial delivery cannot receive full success. Settlement is guarded and occurs once. Returning ships stay allocated until docking.

Exploration rewards a location revision once or an unrecorded coordinate region; near sampling costs time/hull for greater initial science. Defense measures a protected window and checks known hostile presence. Deadlines, lost-contact search, retreat and disablement all end in settlement and return/recovery.

## Save v4

New worlds only: v1–v3 remain on disk but are not selected or migrated. Strict schema validates resources, references, clock consistency, class bounds and reservation totals. v4 persists orders, current energy/ammo, inventory, AI state, cloak, intelligence, communications, cooldowns and PRNG.

SaveStore keeps atomic replacement, a valid same-generation backup, corrupt-primary archival, unsupported-version protection and explicit v4 reset archival. Loading does not advance time; Electron resumes paused. Test user-data directories are isolated from player saves.

## UI and verification

The map stays mounted across six work panels. Right-side selection and order drafts are distinct; pan/zoom survive navigation. Map layers consume only Snapshot. CSS Grid constrains frame dimensions, with independent panel scrolling.

Unit scenarios cover real-world threat interaction, three concurrent loops, conservation, combat, intelligence, permission checks, determinism and save continuation. Real Electron tests drive the UI, map input, resolutions, restart and corruption recovery. Packaged and extracted-ZIP smoke tests exercise the actual Windows binary offline.
