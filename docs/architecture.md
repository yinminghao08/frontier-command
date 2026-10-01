# LV1 v5 architecture

## Authority and execution

Electron main owns the only SimulationEngine. Renderer holds readonly snapshots and UI state (selection, drafts, camera, drawers). IPC accepts strict commands; renderer cannot submit a world, set a tick, choose damage or inspect hidden enemies. The preload exposes getState, command, save, timeline and onState only.

World mutations use fixed 0.1 game-minute steps and the saved seeded PRNG. Speed 1/4/16 batches complete steps. Wall time schedules work but does not determine movement, cooldown, inventory, decisions or outcomes. Critical events pause at a completed step. COMMAND LOST prevents subsequent steps and gameplay commands.

| Module                          | Responsibility                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| engine.ts                       | Authority entrypoints, step orchestration, deterministic random source, reports/events               |
| command-system.ts / commands.ts | Strict validation, authority, transactional order and service commands, high-level intent validation |
| rules-controller.ts             | Restricted Observation → defend / engage / scan / transport / retreat / hold intent                  |
| order-system.ts                 | Reservations, mission phases, settlement, return and docking                                         |
| execution.ts / navigation.ts    | Validated execution, physical movement, route graph and whole-segment border authorization           |
| combat.ts / lifecycle.ts        | Range, cooldown, hit rolls, Core/ammo, damage, irreversible destruction and command loss             |
| threats.ts                      | Faction observations and memory, utility decisions, scout coverage and shared reports                |
| sensors.ts / projection.ts      | Player intelligence and explicit public snapshot projection                                          |
| services.ts                     | Paid repair, physical ammunition transfer, timed manifests and facility recovery                     |
| save-schema.ts / saves.ts       | Strict v5 domain validation and reference/inventory invariants                                       |
| electron/persistence.ts         | Branch index, atomic head replacement, midnight snapshots, terminal records and restore transactions |

Operator identities have availability and kind=rules. Independent assignments connect available operators to ships. Empty assignments and fleets are valid; defense is not capped to the initial fleet. controllerPort gives copied restricted observation, permitted commands and validated intents. Command authorization is revoked immediately after assignment changes or ship destruction. The rule decision layer never calculates position steps, hit rolls or damage.

`shipDestroyed` carries shipId, operatorIds and tick. The loss record additionally preserves position, class, cargo, ammo and order identity. This is the future personnel-death integration boundary; no current LLM or death/rescue fiction is implemented.

## Observation and intelligence

True enemy entities, intent, destinations, inventories, shared Romulan reports and RNG remain in main. Contacts only contain observed fields. Loss of coverage freezes last-known coordinates and state; visibility expires independently of evidence retained for old orders. Navigation uses public chart data and player-known contacts. Attack reports and effects are observable when own ships/facilities are involved. Own loss archives contain no hidden attacker state.

Enemy decisions build observations from their own sensor coverage. Shared Romulan reports carry observer, time, confidence, target value and defense. Scouts select stale coverage areas and assess risk; warbirds may act on fresh reports or continue observation. Local physics resolves only attacks within real sensor/weapon range. Pirate fallback chart knowledge estimates facilities, while actual cargo and defense values require observation. Retreat/departure differs from destruction.

## Mission and resource invariants

Cargo reserves source stock before dispatch, loads at source, and transfers only cargo actually carried at destination. Cancellation releases reservations; return transfers remaining cargo back to base. Loss records preserve destroyed cargo. Partial delivery fails without a success reward. Settlement is guarded once, and historical orders may reference archived ships.

Defense waits for a protected window or observed destroyed/withdrawn contact. An expired contact is failure after search, not success. Surviving assets can continue after another withdraws. Priority weights recently observed attackers of the objective and orders communications; it does not add combat stats.

Recon spends Core while working, requires real contact identification, and uses the common damage pipeline for close-survey hazards. Location revisions/region records suppress duplicate rewards. Surveyed hazard knowledge changes safe-route costs.

Armory stock and reserved rounds are independent of materials. Each service transfer decrements both reservation and physical base stock, incrementing ship ammo exactly once. Repairs pay for a bounded amount of missing hull; new damage during service is not repaired for free. External manifests are explicit timed inventory sources, separate from commands.

## Timeline transaction

Each branch directory has head.json, head.json.bak, branch.json, immutable day-N.json, and failure.json after loss. The index points to an active branch and records parent snapshot relationships. New worlds start with Day 1 00:00. The host's afterStep hook persists midnight at the exact tick before the next speed-batched step.

Restore loads yesterday's snapshot, reliably seals the failed world, writes a new branch, then atomically changes the index. In-memory engine replacement occurs only after success. A failed index write may leave a recoverable orphan directory but cannot activate it or overwrite the old branch. Existing day/failure files are never rewritten. A terminal record takes precedence over a living backup; damaged terminal evidence blocks loading instead of resurrecting the pre-failure world.

Day 3 restores Day 2 00:00. Day 1 offers only a new frontier. Previous snapshots can be found through parent branches without changing their bytes. Legacy formats are preserved and never migrated. Corrupt/unsupported files are protected. Schema checks clocks, references, assignments, active hull, class limits, cargo, ammunition reservations and stock reservations.

## LCARS UI and camera

App assembles LcarsShell, StrategicMap, Inspector, ManagementDrawer and OrderComposer. Six management sections are overlays; the map viewport stays mounted and unchanged. Shared LCARS styling covers native form controls as well as every button state. No unimplemented system is exposed as an actionable control.

The independent pure camera module maps the whole 1600×800 sector onto actual viewport pixels, independently by axis. Scale is 1–8, translation is clamped to projected bounds. Pointer zoom and time-based interpolation preserve the anchor; ResizeObserver preserves fit or world center. Symbols and labels use screen pixels. Label placement is priority-based with collision avoidance. Semantic detail changes at 1.65× and 3×. TacticalView is intentionally absent.

See acceptance and verification for reproducible behavior and actual Electron screenshots; build success alone is not visual acceptance.
