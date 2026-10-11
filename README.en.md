<p align="center">
  <a href="./README.md">简体中文</a> · <a href="./README.en.md"><strong>English</strong></a>
</p>

<p align="center">
  <img src="./assets/readme/frontier-command-card.svg" width="100%" alt="Frontier Command, an LCARS-style frontier management and agent simulation" />
</p>

<h1 align="center">Frontier Command</h1>

<p align="center">
  A single-player frontier management game where LLM agents operate ships and take jobs.
</p>

<p align="center">
  Models make decisions when judgment is needed. The game engine owns travel, inventory, combat, settlement, and saves.
</p>

<p align="center">
  <code>Electron</code> · <code>React</code> · <code>TypeScript</code> · <code>LCARS 26 Classic</code> · <code>v1.6.0 / Save v16</code>
</p>

## Quick start

Windows is the main development and verification target. With Node.js, npm, and Git installed:

\`\`\`powershell
git clone https://github.com/yinminghao08/frontier-command.git
cd frontier-command
npm ci
npm run dev
\`\`\`

You can also run \`npm start\` to build the project and launch Electron.

A fresh world begins paused at **DAY 1 00:00**. Inspect Dawn Starbase, the Helios mine, and your fleet, then unpause the simulation. Exploration, hauling, construction, and direct ship command all work without a model API.

## What you do

You are the Admiral of Dawn Frontier Command. The frontier is made of ships, facilities, inventories, routes, and agents with their own judgment.

- Chart unknown sectors, investigate anomalies, and confirm wormhole exits.
- Move actual Materials from mines to Dawn, then spend them on ships, repairs, refits, and construction.
- Patrol, escort, intercept, shadow, attack, and capture facilities using real ship capabilities and ammunition.
- Build mines, outposts, and colonies while upgrading Dawn Starbase.
- Recruit and train agents, assign ships, and negotiate jobs, risk, and rewards.

The systems feed into one another:

\`\`\`text
Explore → Find resources → Build → Mine → Haul → Produce and expand
                                         ↓
                                  Routes gain value
                                         ↓
                          Pirates scout, intercept, steal
                                         ↓
                        Escort, reroute, track, hit logistics
\`\`\`

## Agents have their own judgment

The starting agents are Talia, a Battle specialist, and Mira, a Logistics specialist. Career changes competence and priorities without blocking physically valid actions.

Each agent has a stable profile and persistent state, including risk tolerance, task preferences, fatigue, stress, trust, relationships, and memories. When you assign a job, the model receives the public information that agent is allowed to know. It can accept, refuse, suggest conditions, or ask another agent for help.

Model output cannot write directly to the world. Goals and actions pass local validation before the authoritative engine can execute them.

\`\`\`mermaid
flowchart LR
    A["Admiral<br/>Chat / Direct command"] --> B["Intent Gateway"]
    O["Public Observation<br/>Personality / Memory / Intel"] --> C["Agent Cognition"]
    C --> B
    B --> D["FAR<br/>Objective / Task Runtime"]
    D --> E["Authoritative Engine"]
    E --> F["Domain Journal"]
    F --> D
    F --> G["Task Cards / Reports"]
    E --> O
\`\`\`

The model is called for task judgment, negotiation, important danger, and meaningful strategy choices. Movement, loading, mining, combat settlement, and routine progress stay inside the engine, so the simulation does not need an LLM call every tick.

## A freight run

Suppose Mira is asked to haul Materials from Helios back to Dawn.

1. Mira receives the objective along with her ship state, current risks, task state, relationships, and recent events.
2. If she wants an escort, she can create a structured collaboration request for a Battle agent. The other agent decides independently and can suggest conditions.
3. Once the terms are settled, FAR stores the objective, task steps, dependencies, and completion criteria. The engine performs repairs, rendezvous, loading, travel, and unloading.
4. Orion can plan an interception only from information it has physically observed and received. Stolen cargo has to make it back to an Orion base before it enters the pirate economy.
5. Delivery, losses, commitments, experience, and relationship changes are saved and appear in later observations.

The demo save prepares the situation. It does not prewrite an agent's answer.

## World simulation

### Logistics

Mines have finite stock and storage. Helios can hold 3000 Materials and stops producing when full. Ships have cargo limits, loading takes time, and cargo can be lost in transit. RETURN keeps cargo aboard; an explicit delivery is required to unload it.

### Orion Syndicate

Orion has ships, bases, stock, ammunition, and Credits. Its deterministic AI scouts traffic, relays reports, assembles raids, extorts or boards targets, carries stolen cargo home, then pays for repairs and expansion.

Destroyed Orion ships are permanent losses. Hitting supply points, following returning ships to a base, or making a profitable route too dangerous to raid changes what the faction can afford to do next.

### Navigation and intelligence

MOVE, HAUL, ESCORT, and agent travel share the Journey Planner. Routes can use normal Warp and wormholes whose exits have already been discovered and confirmed. Unknown exits are not available to automatic planning.

The renderer and agent observations receive only information the player has learned. Hidden bases, internal enemy destinations, counter-tracking evidence, and random state remain in the main process.

### Persistence

Ship losses, cargo provenance, escrow, task evidence, relationship changes, and major events are stored in versioned saves. Save v16 can migrate supported older timelines while preserving the original files and execution evidence.

## Frontier Agent Runtime

FAR owns the lifecycle between a goal and a recoverable, verifiable task. It does not calculate damage or move inventory on behalf of the simulation.

| Component | Responsibility |
| --- | --- |
| Cognition | Build public observations for model decisions and receive structured responses |
| Intent Gateway | Resolve goals and validate entity references, authority, capability, and parameters |
| FAR | Persist objectives, tasks, dependencies, queues, interruptions, revisions, recovery, and completion criteria |
| Authoritative Engine | Advance navigation, combat, inventory, economy, construction, society, and deterministic opponents |
| Domain Journal | Record cargo, cost, loss, and completion evidence and prevent duplicate settlement |
| Reply Coordinator | Keep one primary reply per directed message and handle cancellation and retry state |

Further reading:

- [FAR v16 architecture](docs/agent-core-v2-architecture.md)
- [FAR delivery and audit record](docs/agent-core-v2-delivery.md)
- [Game engine architecture](docs/architecture.md)
- [World rules](docs/worldbuilding.md)

## Agent API

Configure an OpenAI Chat Completions compatible endpoint under **CONSOLE SETTINGS → AGENT API**. The Base URL can be an API root or a full chat endpoint. Each agent can override the default model and reasoning settings.

The Electron main process stores the API key with the operating system's \`safeStorage\`. Keys are excluded from public snapshots, chat records, and world saves.

Thinking and Reasoning Effort are mapped according to known model capabilities. If an explicit setting is unsupported, the app returns an error instead of silently dropping it.

Third-party API calls may cost money. A low-cost model is a sensible place to start.

## Agent demo

The repository includes an isolated fixed-seed demo:

1. Start the game and open **Save Manager → AGENT DEMO**.
2. Configure the Agent API.
3. Send Mira: \`请评估当前矿场运输与护航风险。\`
4. Inspect **REQUESTS**, Task Cards, and **SYSTEM REPORTS**, then approve or reject any negotiated conditions.
5. Advance time and watch repairs, rendezvous, loading, wormhole travel, delivery, and relationship changes.

See [demo/README.md](demo/README.md) for the full walkthrough.

## Development

Common commands:

\`\`\`powershell
npm run dev
npm run build
npm test
npm run test:e2e
npm run package
\`\`\`

<details>
<summary>Command notes</summary>

- \`npm run dev\`: development mode.
- \`npm run build\`: TypeScript checks, Vite build, and Electron main-process build.
- \`npm test\`: Vitest rule tests.
- \`npm run test:e2e\`: Playwright end-to-end tests against Electron.
- \`npm run package\`: Windows unpacked application directory.

</details>

The v16 verification record reports 472 passing Vitest checks and 68 passing Electron E2E checks. Those tests use isolated userData and a local mock provider, not the player's production API configuration. See [v16 verification](docs/verification/v16/README.md).

## Project scope

- Single-player only. There is no multiplayer MMO server.
- Windows is the primary development and verification platform.
- The game does not bundle a free LLM. Agent autonomy requires a compatible API supplied by the player.
- A fixed seed can reproduce deterministic world rules. Model responses are not guaranteed to repeat.
- Save Manager currently has no cloud sync or import/export workflow.

## License and third-party material

\`package.json\` currently declares the project \`UNLICENSED\`. A public GitHub repository does not grant an MIT, Apache, or other open-source license by itself.

LCARS, font, and third-party material notices are listed in:

- [docs/references.md](docs/references.md)
- [docs/ANTONIO-OFL.txt](docs/ANTONIO-OFL.txt)
- [fonts/NOTICE.md](fonts/NOTICE.md)

Frontier Command is an unofficial science-fiction fan project and is not affiliated with the Star Trek rights holders.

<p align="center">
  <a href="./README.md">简体中文</a> ·
  <a href="./docs/agent-core-v2-architecture.md">FAR architecture</a> ·
  <a href="./demo/README.md">Demo guide</a>
</p>
