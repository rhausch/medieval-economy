/**
 * Regenerate configs/default.json from the built-in defaults. Run this (npm run config:default) after
 * changing a default; a test fails if the file and the defaults disagree.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defaultSettings, settingsToFile } from '../packages/sim/src/index';

const target = fileURLToPath(new URL('../configs/default.json', import.meta.url));
writeFileSync(target, JSON.stringify(settingsToFile(defaultSettings()), null, 2) + '\n');
console.log(`wrote ${target}`);
