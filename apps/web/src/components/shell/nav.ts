import type { SessionView } from '@repo/api';
import {
  ChartNoAxesColumnIcon,
  ClipboardListIcon,
  CompassIcon,
  HandshakeIcon,
  HomeIcon,
  InboxIcon,
  type LucideIcon,
  LibraryBigIcon,
  ScaleIcon,
  ScanSearchIcon,
  ScrollTextIcon,
  SproutIcon,
  UsersIcon,
} from 'lucide-react';

export interface NavItem {
  readonly label: string;
  readonly to: string;
  readonly icon: LucideIcon;
  readonly badge?: 'inbox';
  readonly key: string;
}

export interface NavGroup {
  readonly label: string | null;
  readonly items: ReadonlyArray<NavItem>;
}

/**
 * Navigation adapts to the relationships a person has (ux-brief §1), and stays
 * short: an advisor sees Home, My plan and Skills. Observers add what waits for
 * their signature and the people they support. People is reached from search;
 * profile and notifications from the account menu; coaching from "Your support".
 */
export const navFor = (session: SessionView): ReadonlyArray<NavGroup> => {
  const { relations, grants } = session;
  const groups: Array<NavGroup> = [
    {
      label: null,
      items: [
        { key: 'home', label: 'Home', to: '/', icon: HomeIcon },
        ...(relations.canObserve
          ? [
              {
                key: 'inbox',
                label: 'To sign',
                to: '/inbox',
                icon: InboxIcon,
                badge: 'inbox' as const,
              },
            ]
          : []),
        { key: 'development', label: 'My plan', to: '/development', icon: SproutIcon },
        ...(relations.hasReports
          ? [{ key: 'team', label: 'My team', to: '/team', icon: UsersIcon }]
          : []),
        ...(relations.isCoach || relations.hasCoachees
          ? [{ key: 'coaching', label: 'People I coach', to: '/coaching', icon: HandshakeIcon }]
          : []),
        { key: 'skills', label: 'Skills', to: '/catalog/skills', icon: CompassIcon },
      ],
    },
  ];
  const admin = grants.includes('tenant_admin');
  if (admin || grants.includes('program_owner')) {
    groups.push({
      label: 'Program',
      items: [
        { key: 'adoption', label: 'Adoption', to: '/adoption', icon: ChartNoAxesColumnIcon },
        {
          key: 'credit-rules',
          label: 'Credit rules',
          to: '/program/credit-rules',
          icon: ScaleIcon,
        },
        {
          key: 'program-skills',
          label: 'Skill catalog',
          to: '/program/skills',
          icon: LibraryBigIcon,
        },
        {
          key: 'program-templates',
          label: 'Activity templates',
          to: '/program/templates',
          icon: ClipboardListIcon,
        },
      ],
    });
  }
  if (admin || grants.includes('compliance_reviewer')) {
    groups.push({
      label: 'Governance',
      items: [
        { key: 'ai-usage', label: 'Assistant checks', to: '/admin/ai-usage', icon: ScanSearchIcon },
        { key: 'audit', label: 'Audit trail', to: '/admin/audit', icon: ScrollTextIcon },
      ],
    });
  }
  return groups;
};
