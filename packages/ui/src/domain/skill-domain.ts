import {
  CompassIcon,
  FlagIcon,
  HandHeartIcon,
  MapIcon,
  MessagesSquareIcon,
  ScaleIcon,
  SproutIcon,
  type LucideIcon,
} from 'lucide-react';

/** Muted domain hues (chroma ≤ 0.07 applied in CSS) and line glyphs for seals. */
export const SKILL_DOMAIN_STYLE: Readonly<Record<string, { hue: number; icon: LucideIcon }>> = {
  client_discovery: { hue: 200, icon: CompassIcon },
  planning_advice: { hue: 250, icon: MapIcon },
  behavioral_coaching: { hue: 300, icon: HandHeartIcon },
  trust_integrity: { hue: 160, icon: ScaleIcon },
  communication: { hue: 35, icon: MessagesSquareIcon },
  relationship_growth: { hue: 85, icon: SproutIcon },
  leadership: { hue: 340, icon: FlagIcon },
};

export const domainStyle = (domain: string) =>
  SKILL_DOMAIN_STYLE[domain] ?? { hue: 60, icon: CompassIcon };
