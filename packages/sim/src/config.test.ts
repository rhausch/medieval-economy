import { describe, expect, it } from 'vitest';
import { ConfigError, defaultSettings, resolveSettings, settingsToFile } from './config';
import { createSim } from './sim';
import { ledgerRows } from './metrics';

const small = { seed: 3, world: { width: 64, height: 64, noiseScale: 24 } };

describe('configuration', () => {
  it('round-trips: the defaults written to a file resolve to the defaults', () => {
    const file = JSON.parse(JSON.stringify(settingsToFile(defaultSettings())));
    expect(resolveSettings(file)).toEqual(defaultSettings());
  });

  it('accepts an empty configuration', () => {
    expect(resolveSettings({})).toEqual(defaultSettings());
    expect(resolveSettings()).toEqual(defaultSettings());
  });

  it('applies overrides across sections, collections and nested values', () => {
    const s = resolveSettings({
      body: { baselineKcalPerTick: 9.5, reserveCapacity: 20000 },
      injury: { healTicks: [0, 100, 200] },
      goods: { berries: { kcalPerKg: 400 } },
      actions: { chase: { kcalPerTick: 100, minorInjury: 0.5 } },
      species: { berries: { maxCapacity: 12, moisture: { optimum: 0.4 } } },
      deciders: { utility: { params: { wNeed: { min: 1, max: 1.5 } } } },
      folk: { count: 7, deciders: ['utility'] },
      ecology: { plantRegrowthScale: 0.5 },
      world: { width: 100 },
    });
    expect(s.body.baselineKcalPerTick).toBe(9.5);
    expect(s.body.reserveCapacity).toBe(20000);
    expect(s.body.maxIntakeKcalPerTick).toBe(defaultSettings().body.maxIntakeKcalPerTick);
    expect(s.injury.healTicks).toEqual([0, 100, 200]);
    expect(s.goods.find((g) => g.key === 'berries')!.kcalPerKg).toBe(400);
    expect(s.actions.find((a) => a.key === 'chase')!.kcalPerTick).toBe(100);
    expect(s.actions.find((a) => a.key === 'chase')!.minorInjury).toBe(0.5);
    expect(s.species.find((x) => x.key === 'berries')!.maxCapacity).toBe(12);
    expect(s.species.find((x) => x.key === 'berries')!.moisture.optimum).toBe(0.4);
    expect(s.deciders.find((d) => d.key === 'utility')!.params[0]).toMatchObject({
      min: 1,
      max: 1.5,
    });
    expect(s.folk).toMatchObject({ count: 7, deciders: ['utility'] });
    expect(s.ecology.plantRegrowthScale).toBe(0.5);
    expect(s.world.width).toBe(100);
    // Untouched entries keep their defaults.
    expect(s.actions.find((a) => a.key === 'gather')).toEqual(
      defaultSettings().actions.find((a) => a.key === 'gather'),
    );
  });

  const rejects = (file: unknown, path: string): void => {
    expect(() => resolveSettings(file)).toThrow(ConfigError);
    expect(() => resolveSettings(file)).toThrow(path);
  };

  it('rejects unknown sections, settings and entries, naming the path', () => {
    rejects({ nonsense: {} }, 'nonsense');
    rejects({ body: { nonsense: 1 } }, 'body.nonsense');
    rejects({ species: { unicorn: { maxCapacity: 1 } } }, 'species.unicorn');
    rejects({ actions: { chase: { nonsense: 1 } } }, 'actions.chase.nonsense');
    rejects({ deciders: { magic: {} } }, 'deciders.magic');
    rejects({ goods: { berries: { kcalPerKg: 1, nonsense: 1 } } }, 'goods.berries.nonsense');
  });

  it('rejects the wrong kind of value', () => {
    rejects({ body: { baselineKcalPerTick: 'lots' } }, 'body.baselineKcalPerTick');
    rejects({ injury: { healTicks: [1, 2] } }, 'injury.healTicks');
    rejects({ body: 5 }, 'body');
    rejects({ folk: { deciders: 'rules' } }, 'folk.deciders');
    rejects({ species: { berries: { key: 'x' } } }, 'species.berries.key');
    rejects('nope', 'JSON object');
  });

  it('rejects settings that tie definitions to the code', () => {
    rejects({ species: { berries: { id: 9 } } }, 'species.berries.id');
    rejects({ actions: { gather: { option: 4 } } }, 'actions.gather.option');
  });

  it('rejects impossible values', () => {
    rejects({ body: { reserveCapacity: 0 } }, 'body.reserveCapacity');
    rejects({ body: { startReserveFraction: { min: 0.9, max: 0.2 } } }, 'startReserveFraction');
    rejects({ folk: { count: 0 } }, 'folk.count');
    rejects({ folk: { deciders: ['wizard'] } }, 'wizard');
    rejects({ folk: { deciders: [] } }, 'folk.deciders');
    rejects({ deciders: { rules: { params: { eatBelow: { min: 2, max: 1 } } } } }, 'eatBelow');
    rejects({ injury: { deathChancePerTick: [0, 0, 3] } }, 'deathChancePerTick');
    rejects({ injury: { durationMultiplier: [1, 0.5, 2] } }, 'durationMultiplier');
    rejects({ ecology: { interval: 0 } }, 'ecology.interval');
  });
});

describe('configuration in a run', () => {
  it('records the effective settings, with options applied over the file', () => {
    const settings = resolveSettings({ folk: { count: 9 } });
    const sim = createSim({ ...small, settings, folkCount: 4, plantRegrowthScale: 0.25 });
    expect(sim.folk.count).toBe(4);
    expect(sim.settings.folk.count).toBe(4);
    expect(sim.settings.ecology.plantRegrowthScale).toBe(0.25);
    expect(sim.settings.world.seed).toBe(3);
    expect(createSim({ ...small, settings }).folk.count).toBe(9);
  });

  it('runs with the configured metabolism', () => {
    const burn = (baseline: number): number => {
      const sim = createSim({
        ...small,
        folkCount: 3,
        settings: resolveSettings({ body: { baselineKcalPerTick: baseline } }),
      });
      for (let i = 0; i < 100; i++) sim.step();
      return ledgerRows(sim.metrics)
        .filter((r) => r.category === 'baseline')
        .reduce((sum, r) => sum + r.kcal, 0);
    };
    expect(burn(7.9)).toBeCloseTo(7.9 * 3 * 100, 3);
    expect(burn(20)).toBeCloseTo(20 * 3 * 100, 3);
  });

  it('uses the configured action costs and food values', () => {
    const cheap = resolveSettings({ actions: { gather: { yield: 5 } } });
    const sim = createSim({ ...small, folkCount: 1, deciders: ['rules'], settings: cheap });
    expect(sim.settings.actions.find((a) => a.key === 'gather')!.yield).toBe(5);
  });

  it('gives identical runs identical results whatever the configuration object identity', () => {
    const a = createSim({ ...small, settings: resolveSettings({ body: { mealKcal: 900 } }) });
    const b = createSim({ ...small, settings: resolveSettings({ body: { mealKcal: 900 } }) });
    for (let i = 0; i < 200; i++) {
      a.step();
      b.step();
    }
    expect(a.folk.reserve).toEqual(b.folk.reserve);
  });
});
