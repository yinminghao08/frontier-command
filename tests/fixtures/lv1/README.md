# Pre-refactor LV1 fixtures

Captured from the original v1 engine before the architecture refactor. Do not regenerate these from the v2 implementation; they are behavioral regression evidence.

Seed: 236807. Steps: 0.1 seconds.

1. `initial.json`: unmodified new world.
2. Dispatch Verity to Amber (safe), Meridian to Colony Run (fast), Vigil to R-3 (safe). Unpause and step 200 times. Capture `in-progress.json`.
3. Take control of Verity; submit helm turn 0.3, throttle 1. Step 100 times. Capture `manual.json`.
4. Release Verity with resume=true. Step 5000 times. Capture `continued.json`.

The tests compare full migrated states, including PRNG state, movements, contacts, mission outcomes, resources and logs. Migration may change only version and the explicitly refactored identity/definition fields.
