import './scripts/test-data.mjs';
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], maxWorkers: 4 } });
