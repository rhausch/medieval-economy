/** Goods table. Folk inventories hold kilograms of each good. */
export interface GoodDef {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  readonly edible: boolean;
  /** Food energy in kcal per kg (edible weight). */
  readonly kcalPerKg: number;
}

export const GOODS_LIST: readonly GoodDef[] = [
  { id: 0, key: 'berries', name: 'Berries', edible: true, kcalPerKg: 500 },
  { id: 1, key: 'roots', name: 'Roots and nuts', edible: true, kcalPerKg: 1200 },
  { id: 2, key: 'meat', name: 'Meat', edible: true, kcalPerKg: 1500 },
];
