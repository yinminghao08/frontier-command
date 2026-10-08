# v15 responsive Agents and authoritative execution

Main-process Agent requests use a short JSON-object prompt and a task-oriented public projection. Task judgments return consent, rationale and a same-channel reply together. Initial receipt, compatibility, one repair and refreshed validation share a logical start time, with no application deadline. Streaming Chat Completions is the default, with cached non-streaming fallback on explicit unsupported errors. JSON and SSE responses are decoded before strict decision validation; reasoning alone cannot become an action. Fetch and body reads are cancellable even for an uncooperative provider. Runtime telemetry records request bytes, phase, first body byte, elapsed time, validation and failure/repair reason without credentials. Public reply lifecycle is indexed by message and Agent; player errors wait for an explicit retry.

`proposeDirective` persists the complete structured button task; no natural-language round trip reconstructs the action. `modifyCurrentTask` validates and delegates an immediate replacement through the same command executor. Fleet direct authority is preserved. HAUL replacements carry forward their real remaining manifest only when replacing, so queues and suspended orders cannot double-claim goods. Automatic loading is computed and reserved at the source against free hold, unreserved stock and destination space/remaining construction demand. Explicit autonomous fixed orders retain their atomic scarce-stock reservation.

`ATTACK_SET` persists ordered target progress and unconfirmed outcomes. A faction assault is a cancellable persistent Admiral task fed solely by fresh public Orion contacts and discovered facilities. Lost contacts approach the last observation, search or expire honestly; unseen destruction cannot count as a confirmed victory until real wreck observation. Actual fire, loss and obstruction feedback returns to the initiating conversation and deduplicates directive/cycle transitions.

`agent-state.ts` classifies physical work, confirmed combat including cooldowns, safe idle/docking and arrived REST. Rates are centralized in definitions and integrated with game time. Real shield/hull hits, engagement bands, state threshold hysteresis and feedback evidence persist; no model can set these values. Dynamic states influence willingness and risk observations. Continuous small changes do not create chat or per-tick model work.

Strict world/index version 15 uses `frontiers-v15` and `timeline-v15.json`. Frozen v14 validators run before migration. Heads, readable backups, terminal records and every daily snapshot are staged together; the new directory is published as a unit with a recovery marker, then the index. Original v14 files remain untouched. Historical Admiral input is sealed; retained orders, cargo, stable profiles and histories are preserved without replaying damage/emotion events. Older v9–v13 archives remain untouched. See [v15 verification](verification/v15/README.md).

## Retained v14 Orion ecology and authority

Electron main retains the only `SimulationEngine`, 0.1 game-minute fixed steps and seeded combat RNG. Orion uses deterministic game AI, with no model calls. Romulan political decisions remain in `threats.ts`; Orion is now isolated in `orion/`.

`generation.ts` uses coordinate RNG independent of combat to place a remote hidden headquarters and 1–2 hidden supply points, with ten dispersed real vessels. `definitions/orion.ts` defines production prices, tactical limits and distinct facility defense profiles. All initial reserves and equipped ammunition enter the private asset ledger.

`intelligence.ts` samples physical sensor contacts once per game minute. Reports contain observed positions, velocities, cargo estimates, defense and local escort evidence; they never contain player commands, paths or destinations. Range-limited, one-hop radio relay preserves the original observation time; scouts physically return toward a relay when isolated. Operations reserve a target and members, evaluate income, transit/service costs and risk every five minutes, and execute in stable ID order from shared observations. Lost signals use bounded velocity prediction and expire after twelve minutes.

`tactics.ts` coordinates assembly, interception, flanks, extortion, suppression, boarding, withdrawal and service. Every fixed step checks locally observed reinforcements and physical hull/engine/core conditions. Return navigation uses only Orion's received chart. Counter-tracking runs before return, unloading and repair: decoy movement and fifteen quiet minutes remain authoritative and private. Site confirmation still requires ten continuous minutes of actual observation.

`piracy.ts` owns physical cargo transactions and loss attribution. An eight-minute demand requests at most 25% of estimated cargo and actual receiver capacity. Unified ship policy defaults to preserving the ship; manual Admiral responses and new tactical orders override it. Boarding requires controlled shields, damaged engines, low speed, proximity and four uninterrupted minutes, and takes at most 50% of the first-contact load. Subsequent reports cannot reset that batch's theft limit. Smuggler transshipment requires real rendezvous and elapsed work. HAUL and trade orders retain real loss counters; completion and Agent XP use actual delivery.

`economy.ts` unloads stolen manifests at a live owned base, allocates 25% for export and exchanges goods and Credits with a finite black market. Export rights may accumulate fractions; physical ammunition always remains integral. Repairs/rearming use local stock and time. Paid ship/ammunition/construction jobs cannot complete twice; destroyed facilities/builders permanently lose their work. The fleet cap of 24 includes active jobs; expansion beyond ten ships requires realized sales and maintenance reserves. Surviving ships can supply and construct new facilities; with no vessels, bases or construction assets the faction has no respawn source.

Only experienced/received `PiracyIncident` data enters Snapshot/Observation: demand, deadline, response, boarding progress, loss and observable outcome. Hidden plans, destinations, base stock, black market, RNG and tracking evidence remain private. A deduplicated danger event supplies the assigned Logistics Agent with valid Battle reinforcement options. Existing voluntary `requestTask/reinforce` contracts govern acceptance, refusal and real ESCORT execution, while Admiral commands retain priority. LCARS Inspector, fleet, map, events and Priority Communications project these public facts.

The v14 increment introduced strict validation of observation times/references, operation membership/target exclusivity, manifests and cargo losses, physical capacities, paid job recipes, fleet reservations, sales and permanent losses. These validations remain in v15. See [historical v14 verification](verification/v14/README.md).

## Historical v13 autonomy and contract execution

The v13 increment preserves the v12 authority and physics pipeline: public observation → Chat Completions decision → complete local validation → engine commands. Agents never calculate cargo, damage, repair costs or execution results. Battle and Logistics remain independent careers with independent model overrides.

`chat.ts` routes ordinary engine outcomes to the engine-only `system-reports` channel. Stable directive/cycle/transition IDs deduplicate reports; reports do not parse mentions, wake peers or enter observer memories. Authentic directed Admiral messages, new versioned proposals, changed danger and meaningful choice context create one-use decision revisions. Clock advancement, coordinates, incremental mining and ordinary XP do not create model work. Accepted plans advance in the existing task executor.

`personality.ts` generates stable profiles from initial seed and Agent ID without using combat RNG. Motives, long-term goals, psychology, preferences and relationship evidence appear in observations. Real outcomes and authenticated social actions apply bounded, idempotent feedback. The model chooses actions; the engine owns their consequences.

Authentic Admiral tasks use a dedicated short LLM judgment with only task-relevant public facts and a three-field accept/reject response. The response maps to validated answerTask commands, and acceptance immediately advances the existing task executor even while simulation is paused; movement still waits for simulation time. New task judgments cannot propose conditions, and no pending-proposal chat placeholder is emitted. Generic conversation and peer collaboration retain the full decision protocol.

`contracts.ts` owns voluntary task consent, generic collaboration requests and commitments. Requests have a version, a single response turn and at most two counteroffers. Conditions use real repair, continuous REST, escort rendezvous and Admiral-approved reward escrow. Physical directives retain normal inventory, command and journey validation. Handoff transfers unladen remaining intent, while cargo stays on its original ship. Bilateral work and postconditions finish before a contract pays once. Cancellation, failure, interruption and direct takeover have separate effects. Map orders and authentic direct-control chat keep final Admiral authority.

The main-process `RequestTracker` is shared across services and saves and records HTTP attempts, repairs, cancellations, failures, provider-returned token usage and active concurrency. It imposes no per-minute quota or global concurrency limit and does not load or write the obsolete runtime quota ledger. Each Agent retains one valid logical decision; new directed Admiral input replaces stale work in the same host pump and bypasses transient failure backoff, while authentication failures still require manual retry or configuration. Initial decisions, compatibility fallback and one repair have no application time limit; explicit cancellation and revision invalidation release obsolete requests. Runtime IPC is read-only telemetry; credentials remain in the encrypted API configuration.

Strict save/index version 13 uses `frontiers-v13` and `timeline-v13.json`. Frozen v11/v12 validators run before migration; staged migration covers heads, backups, daily snapshots, terminal failures, ancestry and reserved IDs before publishing the index. Historical chat is sealed, existing cargo/directives survive, and old automatic delegation is not reclassified as voluntary consent. Corrupt or newer timelines prevent fallback overwrite.

Current acceptance is documented in [v13 verification](verification/v13/README.md). The version-specific sections below are historical context; v13 rules above supersede their scheduling, reporting, consent and migration behavior.

## Historical v12 scoped Admiral chat tasks and resilient decisions

Common imperative orders are compiled from an authentic addressed Admiral message and a public Observation. Questions/negative instructions do not grant attack or building authority. Unresolved references request clarification. The main-only admiralChatTask Command validates sender, recipient and a monotonic message cursor; renderer IPC rejects this internal command. Models cannot choose their command source or company permissions.

AdmiralTask persists original message/channel, scope, progress, route restrictions and an optional Logistics collaborator. Engine-internal dispatch context stamps actual Directives with source=admiral, actorId=commander, executorAgentId, sourceMessageId and taskId. Physical commands retain normal validation, movement, combat, reservations and construction. New direct Admiral orders cancel related chat execution, including delegated cargo work. Outcomes grant executor XP/memory, while engine receipts enter chat. Construction prefers an idle, enabled, rested, cooperative Logistics peer with sufficient free cargo; otherwise the assigned ship transports actual batches. Career never restricts Action types.

The provider JSON Schema is generated from the same Zod decision validators, including field and domain collection validation. Decision messages have no count cap; individual message lengths and transport response sizes remain bounded. Explicit unsupported errors negotiate and cache schema → JSON → text fallback per endpoint/model. NONE omits reasoning. At most one repair follows an invalid decision, without a shared deadline. Safe field paths and command validation reasons are fed back with refreshed public observation. No action or chat commits before the entire decision passes validation, and new revisions cancel old requests. Raw provider bodies and credentials are never recorded. ACK messages carry replyTo and do not wake peers.

Journey Planner accepts a persisted wormhole permission. Consecutive survey physically scans each specified sector and publicly revealed targets; task progression is deterministic engine work rather than per-tick model calls.

Save schema/index 12 uses independent paths. First startup copies v11 branches, backups and daily snapshots before publishing the new index. Original files remain untouched; historical message cursors are sealed so old chat never replays. Damaged saves retain normal protection/backup behavior. Tasks, reply chains and directive authority references are validated. The notes below describe their historical versions.

# Architecture

## Authority

Electron main owns the only authoritative `SimulationEngine`.

Renderer holds only UI state and readonly snapshots. Every world mutation enters the engine through validated structured commands. Hidden enemy state, faction intent, unrevealed world data and RNG state never enter the public snapshot.

Simulation rules use deterministic fixed steps and seeded randomness. Wall-clock time may schedule host work but never decides movement, combat, inventory or faction outcomes.

## World Model

The strategic world is persistent and expandable.

- Space is organized as generated Sector / Star System data, not a fixed rectangular board.
- Unknown sectors are materialized deterministically from the world seed when discovered.
- Discovered systems, planets, anomalies and resource sites become persistent save data.
- Stable internal IDs are separate from player-facing names so ships, colonies, facilities, planets and systems can be renamed safely.
- Navigation, sensors, factions and rendering operate on the same world model.

The map may reveal more space indefinitely without requiring a global `WORLD_WIDTH` / `WORLD_HEIGHT`.

## Command Model

A Starfleet ship is always an independently controllable world entity.

Each ship can hold:

- current directive
- queued directives
- standing orders

New commands use `REPLACE`, `QUEUE` or `INTERRUPT`.

Admiral commands have final authority. Standing Orders and ROE govern autonomous behavior only; they must not block an explicit validated Admiral command.

Directives describe intent such as move, patrol, escort, intercept, shadow, scan, attack, disable, retreat, dock or resupply. The engine resolves pathing, range, weapons, damage, cargo and timing.

No long-lived Mission/Operation may own or lock a ship.

## Shared Activity Systems

Combat, exploration, mining and logistics operate on the same persistent world rather than separate mission pipelines.

- Combat acts on real ships, facilities, positions, weapons and political consequences.
- Exploration reveals real persistent systems, resources and hazards.
- Mining extracts finite world deposits into mine storage.
- Transport moves real goods between actual inventories and routes.

One system's output can create another system's opportunities.

## Economy and Growth

Core resources have explicit meaning:

- `Credits`: strategic budget
- `Materials`: construction, repair and industry
- `Photon` / `Quantum`: physical ammunition
- `Special Finds`: rare capability unlocks

Fleet growth uses limited module slots and capability-changing upgrades.

Starbase growth modifies strategic systems such as Shipyard, Sensors, Armory, Logistics and Defense. Shipbuilding produces persistent new ships; permanent losses remain meaningful without creating an unrecoverable dead end.

## Faction Simulation

Faction actors are persistent entities with their own assets, information and constraints.

### Orion Syndicate

Orion ships, hideouts, cargo, ammunition and losses are real world state. They scout profitable routes, raid weak targets, carry stolen goods home and rebuild only when their economy permits.

### Romulan Border Command

Romulan scouts gather observations. Border Command acts on fresh reports, strategic value, tension and risk. Romulan vessels are not automatically hostile merely because of faction identity.

Faction actions must originate from world state and knowledge, not periodic enemy spawning.

## Agent Boundary

Agent and ship are separate entities.

Ships own physical state. Agents own personality, skills, memory, experience, career and relationships.

The v11 main-process LLM decision layer follows:

`observation → model decision → structured action → validation → engine command`

Models never edit `WorldState`, calculate frame-level physics or run every simulation step.

## Persistence

Save data is versioned and validates references, inventories, generated world data, directives, faction state and progression.

Timeline branching and recovery remain transactional: immutable historical snapshots are never rewritten, and engine replacement occurs only after persistence succeeds.

## UI Boundary

### Save manager

The existing `ARCHIVE` navigation identity now presents the LCARS save manager. Main-process `world:saves` returns only public catalogue metadata; `world:save-action` validates create/copy/load/rename/delete and manager open/close requests. Renderer receives neither raw worlds nor paths. Opening the manager pauses the authoritative engine and blocks resume until it closes. A successful world switch resets transient UI selection, camera following, composers and contact dialogs.

The timeline v11 index remains authoritative for branch IDs, names and parent links; optional names preserve compatibility with unnamed indices. `branch.json` is the original creation receipt, not the mutable catalogue. World schema version is 11; earlier timeline files are not migrated. Failure-first loading and same-generation backup fallback are shared by catalogue and activation. An unreadable branch is protected independently of the catalogue, allowing selection of another valid save; invalid indices prohibit mutations.

Creation reserves a non-reusable numeric ID, stages validated worlds and daily snapshots, writes a recovery journal, renames the directory, then atomically publishes the index. On failure it removes unpublished data while retaining the ID reservation. Activation validates the target and saves the outgoing world before publishing the active ID. Copying materializes all effective ancestor snapshots into an independent branch and preserves failure sealing.

Deletion first materializes inherited days in direct children and detaches their parent links in the new index. It moves the selected inactive directory to a tombstone before index publication. A failed commit restores the directory and removes newly added days. Startup restores a tombstone still referenced by the index or removes a committed deletion; creation journals likewise distinguish committed worlds from unpublished ones. Snapshot additions left by an interrupted deletion are harmless copies of effective history. Cleanup failures keep recoverable journals and never report a committed operation as an uncommitted failure.

The existing LCARS 26 Classic design system is the UI foundation.

- `SECTOR`: expandable Strategic Map and context commands
- `STARBASE`: dedicated full management interface
- other management views present fleet, economy, colonies and history without owning simulation state

Strategic Map uses semantic zoom and renders only known information. UI animation/audio preferences remain separate from world saves.

## Code Boundaries

- `src/engine/`: authoritative world, commands, simulation, factions, economy and save schema
- `src/ui/`: LCARS presentation and interaction
- `src/StrategicMap.*`: strategic world rendering/camera
- `electron/`: engine host, IPC and persistence
- `tests/`: deterministic rules, persistence and Electron E2E

Prefer domain data over scattered constants, strict TypeScript over `any`, and root-cause refactors over compatibility patches around rejected architecture.

## v9 Implementation

The fixed step is 0.1 game-minute, scheduled every 100 ms by the Electron host. A 1x game minute is therefore approximately one real second. Speeds 4/16 repeat the same steps and stop the batch at a major pause. Sensors observe each game minute; faction decisions use simulation-time deadlines.

A directive stores its own phase, work, travelled distance, loaded manifest, delivered amount and remaining physical reservations. Only active/suspended directives reserve stock; queued actions reserve nothing. REPLACE clears all three directive containers. INTERRUPT pushes the current directive onto a LIFO stack. Completion resumes the stack before the FIFO queue and validates what remains, including partially loaded magazines and retained haul manifests. Failed targets release reservations and report the reason; actual cargo is retained.

Sector IDs derive from coordinates; system/body IDs derive from their sector and local index. Coordinate generation uses initialSeed and a local derived PRNG, separate from the mutable combat/cloak RNG. The engine stores generated content and survey tiers; Renderer receives neither random source. Map transforms are unbounded and preserve world center on resize; FIT includes known locations/systems. Local-body labels are shown at local zoom or for a selected system.

Physical inventory belongs to a location, construction site, ship cargo, magazine, enemy hideout or wreck. Credits are the command budget. HAUL reservations move into cargo only after loading; delivery uses the lesser of the actual cargo and remaining manifest. Cancelling does not restore consumed industry materials or unload cargo. Completed construction projects resolve later queued shipments into their resulting facility.

Mine accidents cap shared response work at 20 and consume 5 Materials once, using unreserved facility stock first and the completing onsite vessel's cargo for the remainder. Insufficient combined inventory spends nothing. Snapshot events include derived `accidentResponse` metadata for active owned facilities: local availability and each current responder's proximity-based phase, cargo and shortfall. Suspended/queued responses are excluded. This metadata is not stored in WorldState or saves; the save version is 11. Existing excess work is clamped when a response continues.

Route forecasts clip both voyage legs against the union of charted Sector rectangles to show the uncharted distance fraction, using public geography only. Boosted physical movement creates a saved, short warp wake that amplifies its detectable signature to 1.5x sensor radius. Ordinary movement clears it; a stopped wake decays within one game minute. Sensors never read route orders or planned paths to infer a contact. Risky corridors remain physically faster and damaging. Safe routes are direct when no observed hazard crosses the voyage. Stable, coordinate-only candidate paths avoid discovered anomalies and fresh hostile contacts; facility locations and hidden threats cannot force detours. When no safe candidate exists, the public forecast and execution note explicitly reports elevated risk.

Construction uses on-site stock and cannot start work while required goods are reserved for another delivery. Industry jobs independently complete shipbuilding, upgrades and manufacturing without owning vessels. There is no rear resource accumulator. Colony income and limited Exchange orders provide recovery. Exchange escrow is a persistent paid manifest; a preexisting civilian carrier must visit the origin, load, travel and deposit. A new hull takes 25 minutes and receives a fresh ID, independent operator identity and empty magazines. Full manufacturing output waits without duplicate payment or production.

Orion reports record local observations, value, escort defense, freshness and position. Raiders pursue reported positions until acquiring their own sensor contact. Loot is physically transferred, returned and partly consumed by black-market sale; repairs, rearming and replacement hulls use the hideout's finite stock. Docked ships retain a service deadline and can redeploy after it. There is no periodic reinforcement source. Romulan reports plus tension determine command stance; actual boundary crossings, withdrawal, construction and attacks persist in history.

Public Snapshot/Observation types are recursively readonly and detached by structuredClone. Snapshot uses an explicit field whitelist; enemy intent, assets, stocks, reports, seed and unrevealed geography stay private. Contacts retain the frozen last observed position during loss of signal. AgentControllerPort exposes only getObservation and submitAction for its assigned vessel; an active Admiral directive rejects an autonomous submission.

v9 saves use timeline-v9.json and frontiers-v9, independently of all earlier roots; v8 and earlier world formats are rejected without migration or modification. Schema checks clocks, references, stable-ID uniqueness, physical capacities, module slots, reservations, historical counters and industry recipes. Runtime target loss remains a valid historical reference until the directive can handle it. Midnight writes occur in the host's after-step callback before the next accelerated step. The host switches engines only after a restored/new branch has been persisted.

## Frontier domains

`inventory.ts` centralizes available stock, canonical completed-project storage, per-good capacity, deposits and destructive reservation reconciliation. No queued directive reserves source goods. Completed projects transfer their leftover cargo into the new facility. Merchant orders retain un-loaded escrow and loaded/delivered counters; each leg is physical navigation.

`fleet.ts` coordinates current group orders using the slowest participating ship. Directive group slots and spacing are captured when issued, so membership changes affect subsequent commands. Group HAUL reserves one shared total on rendezvous and distributes it in stable flagship/member order. A loading barrier prevents premature departure. Independent overrides leave membership intact. Standing directives share action validation and navigation, and cannot outrank any pending Admiral directive.

`society.ts` stores Colony State and independent Personnel. Training, actual meeting, appointment, experience and bounded skill effects use simulation time. Officers do not select tasks. Initial colonies have explicit commanders; new colony construction establishes its commander. An empty post does not regenerate an unlimited series of new characters.

`world-events.ts` owns persistent evidence, subject, stage, deadline, response, work, outcome and follow-up links. It is separate from transient `SimulationEvent` and rolling communications. Mining exposure, contamination/crowding, actual attacks, surveyed rare objects and observed border conditions trigger events. Refugees leave a real source population, consume passenger capacity and reach an actual destination; carrier loss records real population loss. Invasion references existing faction assets and cannot create ships.

Wormholes are paired coordinate objects with independent local seed, stable/unstable state and physical traversal. Unknown exits are omitted from Snapshot. Exploration reveals varied content and permanent historical entries rather than Credits. Authored Helios deposit and New Horizon world do not rely on a random resource/habitable template.

Enemy local observations stay on the observer until within home communication range. Received intelligence retains original observation time and determines deployment and pressure. Romulan reserves originate at Border Command; observe/patrol/probe/reinforce/escalate/withdraw use received evidence and persistent political tension. Observed hostile fire, not hidden intent, permits autonomous targeting.

Renderer has separate command-object and destination state. Map points do not overwrite the selected ship/group command object. SVG symbol registration is exhaustive over map entity kinds. Shared title bars use non-shrinking pure-color caps, bounded tail geometry and wrapping text across DPI scales. Title content and rounded frame masks occupy separate layers.

## Reconnaissance and map

`tracking.ts` shares physical cloak visibility across sensors, combat acquisition and enemy intelligence. Counter-tracking accumulates evidence only from detected ships moving with the observer, with stable bearing or a following position. Evidence, decoy waypoints and enemy destination stay on the authoritative Enemy. Evasion runs before every return/dock/decision branch and ends after 15 minutes without detected following evidence. Romulan sensing/exposure factors and cloak signatures are centralized.

SHADOW stores the owned ship's own last observed position and signal time. Shared contact knowledge can initiate a search but does not update a following ship that lacks physical sensor contact. Loss searches that frozen position for 20 minutes before holding. Cloak is initialized once per newly started SHADOW; a validated manual toggle persists for its current execution. Firing decloaks and energy drain is less than Veil core regeneration.

Unknown facilities have independent `SiteIntel`: observed coordinates, consecutive observation progress and lastSeen. The public `siteContacts` projection omits locationId, owner, name, inventories and destination. After ten consecutive game-minute observations an actual facility is confirmed. Docked/homeId alone never changes visibility. Public communications/history describe received declarations and observed events; weapon effects with hidden endpoints are filtered.

FRONTIER 0/0 has a fixed paired Wormhole to 0/12. Coordinate generation creates the unique Veil derelict, without generic recyclable wreck inventory. SURVEY and ASSIST_EVENT claim its one persistent fleet identity; a save flag and loss archive enforce uniqueness. That recovery event has no expiry.

Goods are Materials, Photon, Quantum and Special Finds; Credits are the budget. There is no upkeep scheduler or operating shortage state. Mine material storage is 3000. Colony income retains population/development/personnel/event factors. Dormant owned ships hold position, low ammunition reports once per continuous shortage, with a saved optional `ammoAlertActive` latch reset only when both ammunition types meet their configured thresholds. Legacy v13 saves initialize this latch from the current ammunition condition and old `ammoReport` cooldown; recovery is checked even under Admiral or Agent control. Low ammunition does not redirect ships, and optional repair/rearm requires physical docking. Emergency combat disengagement has a local point and is cleared by Admiral work.

Map generation uses finite rejection sampling and deterministic fallback, with at most two systems and six secondary bodies per system. Authored sites and friendly facilities reserve layout space. Sector/System views suppress secondary bodies until system selection; local view expands them. Strategic co-located sites/facilities and docked fleets share markers. Label measurement uses loaded Antonio/Alibaba fonts, marker obstacles, multiple candidate positions and stable priority. `src/ui/map/palette.ts` owns faction/type meaning; alert decoration is independent.

## v9 command presentation and alerts

`selectedShipIds` is transient Renderer intent, separate from inspected `Selection` and formal fleet groups. Ordinary owned-ship clicks replace it; Ctrl clicks toggle membership. Non-ship inspection retains it and destroyed IDs are pruned. `ComposerRequest.shipIds` carries it into all task entry points, while explicit ship/group requests take precedence. Batch commands reuse validated `issueDirective.shipIds`; no temporary group is persisted. RETURN retains cargo; UNLOAD to `base` unloads the actual manifest.

The engine emits `shipTransited` only after physical traversal. Main forwards a public whitelist of owned ID, actual exit coordinate and tick through preload `onEvents`. Renderer camera following prioritizes the primary selected ship and ends on manual camera interaction or a new inspected object. It never needs a hidden destination, and overlays remain mounted.

`baseResources` is computed in main from the command budget, base inventory and held reservations; the UI cannot calculate or edit economic authority. `mapMarkers` contains only public dismissed/removable IDs. `dismissMapMarker` validates survey/event completion, remaining goods, rewards and active recovery before preserving the real entity but recording its display dismissal in the world save.

Sensor observation maintains persistent private `contactAlerts` deduplication records. Only the first detection of each stable vessel ID creates a `newContact` pause reason; reacquisition after ten game minutes and first confirmed hostility still produce threat communications but never repeat the contact pause, including after reload. Only the first-contact message requests manual continuation. The engine finishes the first observed tick and stops the accelerated batch immediately. Public communications and contact projections provide the alert content; confirmation and orders do not resume the engine. Same-step first observations form one modal/audio event. No deduplication ledger or faction intent crosses IPC.

When CAPTURE transfers a facility to Starfleet, it removes that facility's private `siteIntel` in the same fixed step, before capture reports trigger persistence. Discovery and capture history remain intact. The strict save schema continues to reject reconnaissance records referencing owned facilities; autosave retains its protection against actual write failures.

Near survey completion creates the existing derelict event immediately. `ContextGuidance` reads public snapshot state to expose existing SURVEY, ASSIST_EVENT, HAUL, UNLOAD, build, upgrade and SHADOW entry points; it does not own a tutorial or mission system.

Console preferences version 2 stores independent text scale and interface zoom outside world saves. Root text defaults to 18px, all display rules use rem/em, and canvas measurements derive from computed text size. Electron applies zoom only when the value changes. Responsive decisions use available width divided by text size; oversized content wraps or scrolls, navigation expands and Inspector becomes a drawer. Local label candidates must connect to the nearest text edge within 4em; there is no screen-edge fallback.

## Production, occupation and wormhole geography

World saves use version 11 and an independent v11 directory/index. Parsing rejects earlier versions; v9/v10 files remain unchanged. The unused `legacy-v9/` definitions preserve historical fixture documentation and are not part of the v11 load path.

`productionDiscountUnlocked` is set by actual survey/event/recovery acquisition and never derived from current stock during rendering. Main projects original and discounted prices, plus available/reserved inventory for every owned operational location. Build/manufacture/upgrade commands accept `locationId` (legacy default Dawn), and every IndustryJob stores its paying/producing base. Destruction cancels unpaid-output work permanently and records its loss, allowing an unfinished upgrade to be retried at another base. Galaxy capacity is independent of its initial loadout.

Defeated enemy bases/outposts have `occupation=ruined`. CAPTURE is an interruptible ship directive; successful on-site work transfers ownership to a secured ruin. startBaseRefit creates a physical construction inventory and retains the target location ID. Delivered material is consumed only when construction completes, and excess stock transfers to the rebuilt facility. Enemy home service and reinforcement must check faction ownership even though the historical home reference remains valid. Strategic upgrades remain shared across the command.

Ordinary wormholes use a seeded invertible affine permutation between nonadjacent sector blocks. Fixed Dawn endpoints remain authored. Arrival materializes the reciprocal portal. Only discovered, surveyed passages expose confirmed exit coordinates; unsurveyed exits and seeds remain private. The renderer groups public markers at overview zoom and coarsens viewport grid cells instead of clipping the world to a fixed number of sectors.

The Inspector uses a scoped Chinese title mode and localized preset names. renamedEntityIds preserves player names verbatim, including names supplied at construction and names that resemble bilingual presets. Numeric colony data use existing LCARS segmented meters. Rearm previews account for reservations released by REPLACE and validate shared per-vessel quantities against all selected ships and total available stock. Queued directives reserve nothing until execution starts; they wait for future physical supply if stock is insufficient.

## v11 Agent execution

`Operator.kind=agent` and an Agent share a stable actor ID. `Assignment` links that actor to one own ship; a ship has at most one Agent and careers do not restrict Action types. Agent stores personality, three skills, experience, trust/fatigue/morale, goal, bounded memory, relationships, assignment, model overrides and decision deadlines/revision. Physical ship state remains separate. New worlds include Talia / Galaxy and Mira / Antares; graduated Colony candidates register the same entity structure and channels.

`electron/agents/service.ts` receives only snapshot, controllerPort and validated Command callbacks; it has no WorldState or engine object. A pending decision reason triggers a bounded asynchronous Chat Completions call, one valid logical decision per Agent and no global concurrency limit, independent of fixed-step physics. Simulation time sets opportunity, danger, completion and retry nodes. Pause allows intentional chat/config/manual decisions while physical ticks remain stopped. `agentDecisionState` and `agentDecision` require the matching Agent actor; renderer/Admiral cannot submit these internal commands. The engine validates the complete decision, all messages and coordination before applying any part. Actions go through `submitAction` and existing `issueDirective` validation. Admiral active/queued/suspended work is checked on every autonomous submit. Assignment, new chat, model settings, Admiral takeover and authority-changing input advances revision; late responses are dropped and stale in-flight requests aborted. Engine replacement disposes all previous requests.

Directives distinguish `admiral`, `agent`, `standing` and persist actorId. History includes source and actor. Agent-selected tasks suppress duplicate Priority Communications reports; task reports live in chat, while durable world history remains available. Agent ships bypass standing high-level decisions while Agent autonomy is enabled; weapon physics and ROE remain in the engine. Completion grants XP and relevant skill growth only from actual outcomes, including each actual HAUL delivery cycle. Skills alter later loading/working efficiency. Loss clears assignment in the destruction transaction, preserving Agent memory and relationships before any autosave.

`chat.ts` owns deterministic transcript append, validated channel membership, @ name/ID resolution, read cursors, bounded memory and wake reasons. The command group contains Admiral and every Agent; private channels contain exactly Admiral and one Agent. Observations include only that actor's channels, at most 24 recent messages and at most 32 controlled memory entries. Model decisions can retain a concise memory and change goal/action; the model cannot write arbitrary numeric state. Escort coordination is a persisted contract: request wakes a named peer, acceptance requires a real matching ESCORT, refusal/completion/failure adjusts both relationships. The engine waits for actual departure rather than completing an accepted escort while the cargo ship is still awaiting its next model decision.

`journey.ts` is a deterministic public-chart planner, evaluating each route mode with a graph of confirmed wormhole endpoints, Warp edges and physical transit edges. Unknown/unsurveyed exits are never graph vertices. HAUL respects its chosen Warp route; MOVE compares routes. Risk reflects only observed hazards/hostiles, uncharted distance, risky-route exposure and known wormhole stability. A Directive persists JourneyPlan, current leg and transit work; all move/haul/escort execution goes through `go()`. `transit.ts` handles real damage, position, survey/discovery, return passages and public shipTransited events for both manual and planned transit. A surveyed passage exposes its confirmed exit in Snapshot; other exits remain null.

`electron/agents/config.ts` stores global Base URL/model/effort separately from saves, encrypting Key via Electron safeStorage (Windows DPAPI). IPC returns only hasKey and public settings, never key/ciphertext/path. Key is used only in Authorization; provider bodies/errors are bounded and never logged or returned. Credential echoes are rejected. NONE omits reasoning_effort; explicit unsupported-parameter errors permit bounded compatibility retry without reasoning or response_format. Successful text JSON still passes the same strict schema. Timeout or parsing/action failure produces a safe private error and simulation-time retry; simulation continues.

Save version 11 and its independent timeline reject older schemas. Strict validation covers Agent/Operator/Assignment equality, channel membership, message sequences and references, memory bounds, relationships, escort contracts, directive actor provenance and only confirmed Journey wormhole references, alongside existing physical inventories, reservations and deterministic rules. Training pays separate recruitment/tuition immediately, advances only in simulation time and creates Agent/operator/channel entities exactly once.

Protocol reference: [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

The built-in Agent Demo uses `demo.ts` to prepare a deterministic v11 save. Exploration confirms the passage via actual TRANSIT; training pays recruitment/tuition and advances 85 real simulation minutes; authored initial Agent decisions pass the same validated internal command path. There is no runtime scripted model replacement. Save Manager creates a new independent demo timeline and saves outgoing progress. `npm run demo:save` exports an inspectable world plus a portable SaveStore directory, excluding API configuration. Continuing the scenario uses ordinary fixed-step physics, chat/outcome and training rules.


### Agent transport diagnostics and cancellation

`AgentRequestTiming` uses `decisionStartedAt` (shared across compatibility/repair attempts) and per-HTTP `startedAt`; it has no `deadlineAt`. Safe metadata includes HTTP status, JSON/SSE format, choice count, allowlisted finish reason and failure category. Cancelled requests have a distinct terminal phase. Provider error text, raw payloads and credentials are never exposed or persisted. SSE handles incremental UTF-8, CRLF, comments, usage and completion markers. Completed content stays bounded at 128KB; SSE framing is bounded at 2MB. Truncation, empty/reasoning-only output and interrupted streams cannot commit decisions.

`testAgentApi(settings?, requestId?)` accepts an optional UUID; `cancelAgentApiTest(requestId)` aborts the corresponding main-process test. Existing calls without an ID remain compatible. Closing the settings panel cancels its test; replacing the world/service or exiting cancels outstanding tests. UI tests use isolated userData and a local HTTP provider.
