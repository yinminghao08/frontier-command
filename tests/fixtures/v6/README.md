# v6 isolated worlds

These are full authoritative engine saves, including private faction state. They are never shipped to the renderer or automatically loaded by the game.

- `initial.json`: seed 236807, four original ships, fresh paused 1× world.
- `in-progress.json`: tick 1000; actual discovery, mining and loaded transport, with Admiral directive stacks.
- `continued.json`: resumed save at tick 4000; physical delivery, surveyed discoveries and a cargo module installed through an interrupted directive.
- `command-lost.json`: the same branch after real damage destroys Dawn; permanent terminal state.

Regenerate with `npm run build` followed by `node scripts/create-v6-fixtures.mjs`. The generator uses production commands and fixed steps, explicitly resumes critical pauses while preparing fixtures, and validates every saved world. Tests load these files through the production v6 parser and compare deterministic continuation. Electron E2E additionally prepares fresh temporary worlds for midnight, permanent ship loss and transactional restore failures; it does not modify production user data.

Legacy v1 fixtures were removed. v5 files in a user's data directory remain untouched and are excluded from the v6 loading path.
