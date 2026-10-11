import { execFileSync } from 'node:child_process';
execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], { stdio: 'inherit' });
console.log('Enabled versioned pre-commit / pre-push hooks.');
