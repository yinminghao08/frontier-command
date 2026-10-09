# Frontier Agent Runtime v2

Status: approved implementation specification. Implementation and verification results are recorded separately in `docs/verification/v16/README.md`.

## Baseline and observed conflicts

The published v15 baseline is `c83889a2044616ec5791385ff01337c632b162fc`. Eight existing working-tree changes are preserved in a separate baseline commit. Development uses `feature/agent-core-v2` in an isolated checkout; the original checkout remains untouched.

The actual v15 input path is `sendChat -> appendChat/wakeAgent -> AgentDecisionService.pump -> admiralChatTask -> compileAdmiralIntent -> receiveAdmiralTask`. The same pump can also select `judgeTask` or the large `decide` protocol. Accepted work is advanced by both `advanceAdmiralTasks` and `advanceContracts`; autonomous actions also enter through `applyAgentCommand`, while Standing Orders directly construct directives. `SimulationEngine.complete` calls `agentOutcome`, `contractDirectiveOutcome`, and `admiralTaskOutcome`. All these paths, plus `directiveFeedback`, can append replies. The ordinary Admiral action task equates directive completion with task completion. `compactObservation` and task judgments discard required target/inventory context above 8,200 bytes. Provider compatibility drops explicit reasoning settings. Assignment is persisted twice.

Baseline checks: 26 unit test files / 411 tests passed; renderer and Electron TypeScript checks passed. Build/E2E and measured comparisons are recorded in the verification report, not inferred from those checks.

## Ownership and dependencies

```mermaid
flowchart LR
 I[Interaction] --> N[Intent]
 N --> O[Objective]
 N --> C[Cognition Scheduler]
 C --> P[Provider Gateway]
 P --> V[Decision Validation]
 V --> O
 O --> T[Task Registry / Planner / Scheduler / Runner]
 T --> G[Authoritative Engine Gateway]
 G --> E[Command / Journey / Inventory / Combat]
 E --> J[Domain Event Journal]
 J --> T
 T --> R[Reply Coordinator]
 R --> U[Communication Store / Task Card]
 K[Public Knowledge / Personal Memory] --> N
 K --> C
```

SimulationEngine exclusively owns persistent FAR data and all physical changes. Electron owns cancellable asynchronous requests and secret configuration. Renderer receives public immutable projections. Runtime code uses bounded engine ports; model code cannot access mutable WorldState or submit physical actions. World rules use 0.1 game-minute fixed steps; network timeouts and telemetry use monotonic real time. Determinism compares the same seed and accepted command/decision sequence at the same simulation ticks.

Each interaction has one routing owner. Each objective has one root task. Collaboration creates independently owned objectives linked by dependencies, not a second executor for the same work. Each physical directive records its authorization and submission identity. Existing Command and Action validators remain the physical authority.

## Persistent contracts

- Interaction: interactionId, source, sender, recipient, sourceMessageId, original instruction/structured payload, authorization mode, related objective and routing phase.
- Objective: objectiveId, schemaVersion, originInteractionId, sourceMessageId, issuerId, nullable ownerAgentId, typed goal, constraints, locally derived completion criteria, authorization, status/revision and simulation timestamps. Preserve original text and amendment linkage. Direct commands without an Agent never create a synthetic Agent.
- Task: taskId, objectiveId, owner, state/revision, current step, assigned ships, directive identities, progress, block reason, processed event identities/cursor, completion evidence and recovery state.
- DomainEvent: stable eventId and sequence, discriminated type/payload, sourceId, optional objective/task/directive links, simulationTick. This is separate from narrative WorldEvent.
- Cargo provenance: lightweight attributed batches and transaction receipts. Physical inventory remains authoritative. A receipt observes a transaction; consuming an event never applies inventory changes again.
- ReplyRecord: unique sourceMessageId/recipientAgentId key, request phase and at most one committed primary message. Important later notifications have independent task/event identities.
- Assignment: the only persistent ship/operator link; Agent ship display and current command authority are derived separately.

Schemas use discriminated TypeScript unions and strict Zod validation. Goal families cover transport, recovery, navigation, exploration/survey, patrol, escort, engagement, repair/service, construction and rest, plus the existing diplomacy/event capabilities. The engine constructs completion criteria; models cannot provide executable predicates.

`TaskHandler.validate(objective, observation)` checks legality; `plan(objective, task)` produces deterministic steps; `advance(task, event)` consumes facts once; `verifyCompletion(task, authoritativeReadView)` returns evidence or a reason that the full goal remains unmet. Planning and ordinary progress never call a model.

`submitInteraction` handles addressed chat at message insertion, structured UI commands, collaboration and eligible opportunities. The service does not scan old messages. `reviseObjective`, `cancelObjective`, and `resumeObjective` require expected revisions. `commitCognition` accepts one purpose-specific schema and checks the request/world session/authorization/configuration/assignment generation. `submitDirective(taskId, actorId, command, expectedRevision)` validates permissions, task revision, association, target, resources, inventory, journey and ROE, and returns a deduplicated submission receipt. `fetchModels` runs in main and never returns credentials.

## Lifecycle and interruption

Objective proposal may negotiate, accept or reject; acceptance creates eligible task work. Tasks transition proposed -> accepted -> running. Accepted/running work may block or interrupt. Blocked work resumes only after relevant fact changes and revalidation; interrupted Agent work requires explicit Admiral resume. Completed, completed_partial, failed and cancelled are irreversible. Queue position is scheduling data, not an overloaded lifecycle state.

Direct authority outranks accepted voluntary work, which outranks autonomous opportunities and Standing Orders. Preserve existing physical QUEUE/REPLACE/INTERRUPT rules. Direct takeover preserves an Agent objective, progress, cargo, escrow and commitments as interrupted rather than silently failing or replaying it. Explicit cancellation settles once. Continuous REST still requires continuous time after interruption. Resuming paid/reserved work must not charge, reserve or transfer twice.

Journal consumption runs at command/fixed-step transaction boundaries, never recursively inside complete callbacks. Ordinary directive completion creates a fact, not objective success. Combat completion requires publicly confirmed outcomes; private enemy destruction cannot leak through task status.

## Vertical slice semantics

Mine load/return: navigate to the real source, LOAD actual goods, verify the receipt, RETURN, verify arrival and cargo retained. LOAD is an additive existing-system Action using capacity, unreserved stock and the existing loading duration. Prefer full hold; when source inventory is short, load all currently available stock. Zero inventory without task goods blocks until actual production. Only an explicit delivery goal adds UNLOAD. RETURN, HAUL, UNLOAD and RECOVER retain their v15 semantics.

Scout recovery/delivery: enroll discovered matching wrecks and their available Materials, RECOVER real stock, return/unload in multiple trips, and continue enrolling matching discoveries until closure. At completion, refresh the public set and prove each enrolled amount delivered with no outstanding attributed goods or unexplained loss. Discoveries after the terminal transition do not reopen the task. Pre-existing/mixed cargo cannot prove recovery. Third-party collection and cargo loss produce honest blocked/partial outcomes. Newly generated wrecks preserve source identity/class; legacy classification uses trustworthy loss records, otherwise it remains unknown and requires clarification.

Remove mining accidents triggered by extracted quantity * hazard >= 180. End old active accidents during migration with a rule-removal historical outcome; stop associated repair work without success XP or breach penalty. Preserve spent resources. Capacity and depletion remain effective.

## Cognition, knowledge and communication

Use separate TaskJudgment, ObjectiveProposal, CollaborationDecision, CommunicationDecision and StrategicDecision schemas. Simple unambiguous commands and structured UI input are deterministic. Composite/conditional/referential input uses semantic interpretation, followed by local entity, authorization and world validation. Follow-up commands use the persisted original goal; substantive voluntary amendments require new consent.

Observations are built for the decision purpose. Mandatory instructions, goals, constraints, targets, commitments and execution evidence are never byte-trimmed. Optional memories are ranked by relevance. If mandatory context cannot fit, return an explicit context error, not an incomplete task. Knowledge distinguishes public current facts, personal experiences, commitments/relationships and causal recent results. Hidden geography, enemy plans, stocks and RNG remain private.

Scheduler admissions are addressed player input, meaningful collaboration, novel actionable opportunity, material danger/failure/strategy change, or a valuable social event. Per-Agent single flight, stable event identity, coalescing and priority prevent repeated cancel/restart on low-value changes. Unassigned Agents have zero autonomous requests, automatic retries or unsolicited peer requests; player-initiated conversation still works. Engine reports/acknowledgements cannot trigger peers.

Only Reply Coordinator commits primary replies. Failure/cancel/retry changes the response lifecycle without emitting another primary message. Ordinary progress updates Task Cards. Factual task statuses, quantities and completion language derive from engine evidence; model text expresses intent, subjective choice and explanation. Contracts preserve versioned offers, conditions, escrow, bounded counteroffers, actual rendezvous/dependencies and one-time settlement. Chat is never contract truth.

## Provider gateway

Keep OpenAI-compatible Chat Completions, safe storage and cancellable SSE/JSON transport. Separate provider adapters, model registry, request manager and response validation. Global connection/defaults and Agent model/thinking/effort overrides are independent. Thinking supports provider-default/on/off; inheritance is null. Legacy effort=none migrates to provider-default, because it formerly meant omission rather than a proven off switch.

Capabilities are supported/unsupported/unknown with provider/model/evidence scope. Model directories do not establish reasoning capabilities. Use documented model-specific off mappings; unknown forced settings fail visibly rather than silently changing reasoning. Negotiate strict schema, tool output, JSON object or validated text JSON separately. No format fallback changes thinking. Maximum two compatibility retries and one format repair, four HTTP attempts per stage; authority/world drift is not model repair input. Default connection timeout 30 seconds and idle-body timeout 120 seconds; configurable and cancellable, without a total deadline on a progressing stream. Per-purpose output budgets distinguish visible output and reasoning-inclusive limits.

Model fetching accepts API root, version root or full chat endpoint while preserving provider path prefixes; unsupported listing leaves manual model input functional. Telemetry records per-Agent purpose, attempts, input/output/reasoning tokens, connection/first-byte/first-content/generation/validation/repair/total durations, with unknown usage retained as unknown. Do not store API keys or reasoning bodies in game saves, renderer snapshots or logs.

## Replacement map and staging

| Existing file(s) | Final responsibility |
|---|---|
| admiral-intent.ts | Intent Gateway; remove legacy regex task compiler |
| admiral-tasks.ts / admiral-task-schema.ts | Objective/Task Runtime and frozen legacy migration |
| agents.ts | Agent state, small decision validation/commit |
| chat.ts | Communication Store; scheduler/coordinator own triggering/replies |
| contracts.ts | Coordination/settlement; runtime owns physical work |
| projection.ts / context.ts | Public projection and purpose-based knowledge |
| decision-protocol.ts / task-judgment.ts | Purpose-specific schemas |
| service.ts | Cognition Scheduler; no transcript scanning |
| client.ts / transport.ts / runtime.ts | Provider gateway/telemetry |
| command-system.ts / execution.ts / inventory.ts | Existing physical authority, LOAD and causal receipts |
| directive-feedback.ts | Domain/communication intents, no independent primary replies |
| saves.ts / save-schema.ts / persistence.ts | Frozen v15, v16 validation and atomic timeline migration |
| services.ts / world-events.ts | Remove periodic mine shutdown; preserve other ecology |

Phase 0: preserve baseline, freeze published v15, commit this reviewable specification.
Phase 1: implement interaction -> objective -> runtime -> engine -> event -> reply, LOAD, both real logistics scenarios and single ownership.
Phase 2: migrate all task/standing/coordination behaviors. Disconnect old global advancement; any temporary adapter is only called by its sole TaskHandler and is removed before completion.
Phase 3: migrate cognition, communication, knowledge, provider and telemetry.
Phase 4: LCARS task cards, authoritative assignment labels, model directory/configuration, response lifecycle and persistence.
Phase 5: remove adapters/duplicate paths, regression, fault injection, benchmarks and actual Electron QA.

## Persistence and acceptance

Freeze v15 validators from the published commit before changing live types. v16 stores timeline-v16.json in userData and branch files under frontiers-v16/. Preserve original v15 files and retain v14 import. Validate old input before migration; stage every head, backup, daily snapshot and terminal record together with a recoverable publication marker. Preserve identities, cargo, reservations, paid work, contracts/escrow, histories and settlement markers. Unknown legacy cargo is unattributed; missing evidence is recorded rather than fabricated. Preserve old transcript and index already committed replies. Old in-flight requests become explicitly retryable and cannot commit into the restored world.

Required tests: full/short/empty source load-return and optional delivery; dynamic multi-trip recovery/mixed cargo/loss/full destination; objective consent/takeover/resume/queues; Frontier 0/12 versus body survey; confirmed combat; escort rendezvous/conditions/settlement; zero autonomous unassigned/model-on-progress calls; primary reply identity; schemas/provider settings/directory/fallback; malformed/truncated/disconnected/timed-out/cancelled/late responses; in-progress save/reload/speed/determinism and migration interruption; removed mine accidents with capacity/depletion preserved; actual Electron card/chat/ship/inventory/configuration consistency.

Run npm run build, npm test and npm run test:e2e against isolated data. Record screenshots/logs. Compare baseline and FAR on identical local-provider scenarios: requests, request bytes/schema size, corrections, cancellations/restarts, task advancement cost and p50/p95. Mock duration and estimated tokens are not real provider performance/cost. This delivery does not access player production API configuration. Report real-provider validation as not performed.

## Implementation status (2026-10-09)

FAR owns all player, group, standing and contract physical task submission. The production Cognition Service sends only purpose-specific engine-session tickets; the client no longer exposes decide/judgeTask. TaskHandler Registry performs read-only planning, event advancement and independent completion verification; Runtime applies the plan and alone submits Commands. Survey, construction and continuing assault recovery fields are persisted on Task.execution, rather than Objective. The declared Task transition table enforces legal nonterminal transitions and irreversible terminal states.

Task revisions retain the same root, transactions, custody and paid checkpoint. Scope baselines distinguish cumulative history from the current revision's loaded/delivered/lost goods. Real-engine tests prove prior delivery to a different sink cannot satisfy the revised destination after reload, fixed shortages yield partial completion, and invalid scope data is rejected. RETURN retains cargo, LOAD uses physical inventory and reservations, and recovery expands discovered source sets only while active.

Cognition events are claimed once when their HTTP request starts. Newly arriving events remain queued; takeover/cancellation cannot replay a consumed manual trigger. Negotiation uses the minimal CoordinationIntent directly, with request, objective and condition-version checks. Strategic decisions can choose locally validated repair/rest or a public opportunity, map risk preference to a real route, and request escort consent. Supported transport intents store a real escort preparation condition; peer consent, actual rendezvous, dependency proofs and escrow remain engine-owned. Paid repair activities finish before their dependent activity can replace them. Ordinary physical progress is a deduplicated domain fact, Task history update and zero-model event; it does not append routine chat.

Assignment is the sole persisted operator/ship relation. LCARS shared Task Cards and model settings are implemented. The previous dedicated actual Electron scenario passed three runs using isolated userData and local HTTP Mock; it must be rerun against the current handler/protocol changes before final acceptance. Published v15 schemas remain frozen; raw directives, custody/payment/XP, contract escrow and legacy history migrate without replay. Old files remain intact alongside staged v16 timeline publication.

Current verification: full regression before the five additional handler/scope proofs passes 32 files / 449 tests (far-handler-full.log). The additional targeted handler/logistics set passes 17 tests (far-handler-proofs.log). Renderer and Electron strict TypeScript checks pass after the Handler migration and dead-module deletion. The earlier build and Electron pass are checkpoints, not final results. All API validation is local Mock; real vendors and costs are unverified.

Consolidation still outstanding: remove the remaining old mixed engine Command and its test callers while preserving social, consent, ROE, XP and coordination tests; broaden semantic strategic/event/diplomacy coverage; final full build, tests, Electron suite and baseline/FAR benchmarks. No final delivery or GitHub push has occurred. User authorized committing and pushing the finished branch after acceptance.

Provider evidence: the model registry was checked against official OpenAI model/reasoning documentation and DashScope thinking documentation on 2026-10-09. Fetch Models does not infer reasoning support; unknown forced controls fail visibly. Output fallback preserves thinking/effort, configured off determines the effective output budget, and escaped credential echoes are refused before validated output can commit. Mock telemetry is not live-provider performance.

## Implementation checkpoint — 2026-10-09

The legacy mixed Command, decision JSON, client decide/judgeTask and context/task-judgment files are deleted. Domain test fixtures exercise the real typed engine/controller/coordination ports and never supply a production fallback. The TaskHandler registry is fully implemented as pure planning/verification over deep readonly views; runtime alone commits physical commands. Execution cursors live on Task rather than Objective. Queued steps have persisted scheduling and pending step history; Admiral interruption retains a checkpoint for explicit resume.

Condition generations preserve unchanged paid preparations but require fresh consent after an escort changes, including a later return to a previously chosen peer. Migration validates old schemas first; live save validation checks history chains and eligible evidence generations. Inventory remains authoritative. Cargo delivered elsewhere is diverted, not falsely marked lost or credited to the goal. Terminal goals keep subsequent custody receipts without reopening or repeating settlement. Cancellation records held Directive outcomes and withdraws descendants.

Cognition includes locally generated rescue-choice IDs, maintenance choices, high-level service/diplomacy/event/transit/contact goals, small judgments/communication and structured support. Missing API configuration does not consume unclaimed danger. Configuration alone produces no opportunity; pending player/coordination work is requeued with revised authority. Model output cannot supply raw runtime completion evidence.

Current verification:33 unit files /461 tests passed; build passed. The latest full68-case Electron run remains in progress and must finish before final acceptance. Earlier33 passed /35 failed full E2E was a pre-consolidation checkpoint. Targeted core geometry/UI, compound goals, construction, explicit takeover, full hold, rescue and frozen-save cases have passed. Performance harness exists; extended600-minute run is pending. Real Provider performance remains deliberately unverified.
