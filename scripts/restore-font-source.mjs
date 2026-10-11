import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const path = 'fonts/AlibabaPuHuiTi-3-65-Medium.ttf';
const expected = 'd92b378a2d08ac1e5c2b87d03b9939fdfae93d3c336b6a13ac4e00ce44f6db9e';
// Full clones already contain this unchanged, originally supplied authoring input.
// Never fetch arbitrary font mirrors or overwrite a user's different source.
const bytes = existsSync(path) ? readFileSync(path) : execFileSync('git', ['cat-file', 'blob', '38ee60f77e5c1f6db437e63c31b43a654fa4e231'], { maxBuffer: 16 * 1024 * 1024 });
if (createHash('sha256').update(bytes).digest('hex') !== expected) throw Error('Font source checksum mismatch; existing file preserved.');
if (!existsSync(path)) writeFileSync(path, bytes, { flag: 'wx' });
console.log('Verified original Medium source. Runtime builds use the four allowlisted font assets and do not need this input.');
