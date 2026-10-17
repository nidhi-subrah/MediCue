import raw from "@shared/catalog.json";
import type { Catalog, Need } from "@shared/types";

export const catalog = raw as unknown as Catalog;
export const needById: Record<string, Need> = Object.fromEntries(catalog.needs.map((n) => [n.id, n]));
export const needLabel = (id: string) => needById[id]?.label ?? id;
