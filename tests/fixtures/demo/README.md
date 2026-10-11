# Frozen demo fixtures

Byte-for-byte copies of previously tracked demo data: v11 JSON and timeline
are consumed by migration/isolation and Electron Agent tests; v16 JSON is
consumed by Last Light tests. These are immutable test inputs, not player saves.
The generator now writes `.test-data/demo/` and never overwrites these fixtures.
