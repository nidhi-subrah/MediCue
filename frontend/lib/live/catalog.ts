import {
  Activity, Bone, Brain, CircleHelp, Droplet, Frown, HeartPulse, Pill, Smile, Snowflake,
  Thermometer, Toilet, TriangleAlert, Users, Utensils, type LucideIcon,
} from 'lucide-react'
// Duplicated from ../../shared/catalog.json — Turbopack can't resolve a symlink or an
// import outside the project root for a JSON (non-type-only) module. Keep in sync if the
// shared catalog changes.
import raw from './catalog-data.json'
import type { Catalog, Need } from '@/lib/types'

export const catalog = raw as unknown as Catalog
export const needById: Record<string, Need> = Object.fromEntries(catalog.needs.map((n) => [n.id, n]))
export const needLabel = (id: string) => needById[id]?.label ?? id

/** Lucide stand-ins for the catalog's emoji icons, so ChoiceCard/BodyMap keep v0's icon-chip look. */
export const CATALOG_ICONS: Record<string, LucideIcon> = {
  head: Brain,
  chest: HeartPulse,
  belly: CircleHelp,
  back: Bone,
  arms_legs: Activity,
  surgical_site: TriangleAlert,
  mouth_throat: Smile,
  whole_body: Users,
  toilet: Toilet,
  people: Users,
  pain: HeartPulse,
  hard_to_breathe: Activity,
  too_hot: Thermometer,
  too_cold: Snowflake,
  thirsty: Droplet,
  hungry: Utensils,
  need_toilet: Toilet,
  sick: Frown,
  uncomfortable: Frown,
  scared: TriangleAlert,
  want_someone: Users,
  medicine: Pill,
  not_sure: CircleHelp,
}
