import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
// Dedicated temporary root, shared by Node, Vitest and Playwright.
const directory = resolve('.test-data/tmp');
mkdirSync(directory, { recursive: true });
process.env.TMPDIR = directory;
process.env.TMP = directory;
process.env.TEMP = directory;
