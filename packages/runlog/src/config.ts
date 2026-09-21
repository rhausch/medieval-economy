import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { ConfigError, resolveSettings, settingsToFile, type Settings } from '@folk/sim';

/**
 * Read a configuration file and resolve it over the defaults; errors name the file and the problem.
 * A relative path is taken from the directory the command was started in (npm runs workspace scripts
 * from the package folder, and records where you really were in INIT_CWD).
 */
export function loadSettings(path: string): Settings {
  const resolved = isAbsolute(path) ? path : resolve(process.env.INIT_CWD ?? process.cwd(), path);
  let text: string;
  try {
    text = readFileSync(resolved, 'utf8');
  } catch (error) {
    throw new ConfigError(`cannot read ${path}: ${(error as Error).message}`);
  }
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`${path} is not valid JSON: ${(error as Error).message}`);
  }
  try {
    return resolveSettings(file);
  } catch (error) {
    if (error instanceof ConfigError)
      throw new ConfigError(`${path}: ${error.message.replace(/^invalid configuration: /, '')}`);
    throw error;
  }
}

/** A short fingerprint of the settings a run used, recorded in its manifest. */
export function hashSettings(settings: Settings): string {
  return createHash('sha256')
    .update(JSON.stringify(settingsToFile(settings)))
    .digest('hex')
    .slice(0, 16);
}
