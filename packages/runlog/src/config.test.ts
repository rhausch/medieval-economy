import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { ConfigError, defaultSettings, resolveSettings, settingsToFile } from '@folk/sim';
import { hashSettings, loadSettings } from './config';

const repoConfigs = fileURLToPath(new URL('../../../configs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'folk-config-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const write = (name: string, text: string): string => {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
};

describe('configs/default.json', () => {
  it('matches the built-in defaults exactly (regenerate it if you change a default)', () => {
    const file = JSON.parse(readFileSync(join(repoConfigs, 'default.json'), 'utf8'));
    expect(file).toEqual(JSON.parse(JSON.stringify(settingsToFile(defaultSettings()))));
    expect(loadSettings(join(repoConfigs, 'default.json'))).toEqual(defaultSettings());
  });
});

describe('the shipped configurations', () => {
  it('all load and validate', () => {
    const files = readdirSync(repoConfigs).filter((f) => f.endsWith('.json'));
    expect(files).toContain('default.json');
    expect(files).toContain('hard-times.json');
    for (const file of files)
      expect(() => loadSettings(join(repoConfigs, file)), file).not.toThrow();
  });

  it('hard-times really is harder', () => {
    const hard = loadSettings(join(repoConfigs, 'hard-times.json'));
    expect(hard.body.baselineKcalPerTick).toBeGreaterThan(
      defaultSettings().body.baselineKcalPerTick,
    );
    expect(hard.body.reserveCapacity).toBeLessThan(defaultSettings().body.reserveCapacity);
  });
});

describe('loadSettings', () => {
  it('loads a partial file over the defaults', () => {
    const s = loadSettings(write('a.json', JSON.stringify({ body: { mealKcal: 1000 } })));
    expect(s.body.mealKcal).toBe(1000);
    expect(s.body.reserveCapacity).toBe(15000);
  });

  it('finds a relative path from the directory the command was started in', () => {
    write('rel.json', JSON.stringify({ body: { mealKcal: 777 } }));
    const original = process.env.INIT_CWD;
    process.env.INIT_CWD = dir;
    try {
      expect(loadSettings('rel.json').body.mealKcal).toBe(777);
    } finally {
      if (original === undefined) delete process.env.INIT_CWD;
      else process.env.INIT_CWD = original;
    }
  });

  it('names the file and the problem for bad content', () => {
    const bad = write('bad.json', JSON.stringify({ body: { mealKcal: 'lots' } }));
    expect(() => loadSettings(bad)).toThrow(ConfigError);
    expect(() => loadSettings(bad)).toThrow(/bad\.json.*body\.mealKcal/);
  });

  it('reports missing files and invalid JSON', () => {
    expect(() => loadSettings(join(dir, 'nope.json'))).toThrow(/cannot read/);
    expect(() => loadSettings(write('broken.json', '{ not json'))).toThrow(/not valid JSON/);
  });
});

describe('hashSettings', () => {
  it('is stable for equal settings and differs when any value changes', () => {
    const a = hashSettings(defaultSettings());
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(hashSettings(resolveSettings({}))).toBe(a);
    expect(hashSettings(resolveSettings({ actions: { chase: { kcalPerTick: 88 } } }))).not.toBe(a);
  });
});
