/** Goods table. Folk inventories hold a quantity of each good. */
export interface GoodDef {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  readonly edible: boolean;
  /** Satiety restored per unit eaten. */
  readonly foodValue: number;
  /** Carry weight per unit. */
  readonly weight: number;
}

export const GOODS_LIST: readonly GoodDef[] = [
  { id: 0, key: 'plantFood', name: 'Plant food', edible: true, foodValue: 1, weight: 1 },
  { id: 1, key: 'meat', name: 'Meat', edible: true, foodValue: 2, weight: 1 },
];
