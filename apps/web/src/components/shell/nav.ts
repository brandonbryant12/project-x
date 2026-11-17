import type { SessionView } from '@repo/api';
import {
  BellIcon,
  BookOpenIcon,
  ChartNoAxesColumnIcon,
  CompassIcon,
  HandshakeIcon,
  HistoryIcon,
  HomeIcon,
  InboxIcon,
  LayersIcon,
  MessagesSquareIcon,
  ScanSearchIcon,
  ScrollTextIcon,
  type LucideIcon,
  SproutIcon,
  UserIcon,
  UsersIcon,
} from 'lucide-react';

export interface NavItem {
  readonly label: string;
  readonly to: string;
  readonly params?: Record<string, string>;
  readonly icon: LucideIcon;
  readonly badge?: 'inbox';
  readonly key: string;
}

export interface NavGroup {
  readonly label: string | null;
  readonly items: ReadonlyArray<NavItem>;
}

/** Navigation adapts to the relationships a person has (ux-brief §1). */
export const navFor = (session: SessionView): ReadonlyArray<NavGroup> => {
  const { relations } = session;
  const groups: Array<NavGroup> = [
    {
      label: null,
      items: [
        { key: 'home', label: 'Home', to: '/', icon: HomeIcon },
        ...(relations.canObserve
          ? [
              {
                key: 'inbox',
                label: 'Inbox',
                to: '/inbox',
                icon: InboxIcon,
                badge: 'inbox' as const,
              },
            ]
          : []),
      ],
    },
    {
      label: 'My growth',
      items: [
        { key: 'development', label: 'Development', to: '/development', icon: SproutIcon },
        {
          key: 'conversations',
          label: 'Conversations',
          to: '/conversations',
          icon: MessagesSquareIcon,
        },
        { key: 'timeline', label: 'Timeline', to: '/timeline', icon: HistoryIcon },
        {
          key: 'profile',
          label: 'Profile',
          to: '/people/$id',
          params: { id: session.person.id },
          icon: UserIcon,
        },
      ],
    },
  ];
  const support: Array<NavItem> = [];
  if (relations.hasReports)
    support.push({ key: 'team', label: 'My team', to: '/team', icon: UsersIcon });
  if (relations.isCoach || relations.hasCoachees) {
    support.push({ key: 'coaching', label: 'Coachees', to: '/coaching', icon: HandshakeIcon });
  }
  if (support.length > 0) groups.push({ label: 'People I support', items: support });
  groups.push({
    label: 'Explore',
    items: [
      { key: 'skills', label: 'Skills', to: '/catalog/skills', icon: CompassIcon },
      { key: 'activities', label: 'Activities', to: '/catalog/activities', icon: LayersIcon },
      { key: 'people', label: 'People', to: '/people', icon: BookOpenIcon },
    ],
  });
  const admin = session.grants.includes('tenant_admin');
  const governance = admin || session.grants.includes('compliance_reviewer');
  const program = admin || session.grants.includes('program_owner');
  const oversight: Array<NavItem> = [
    ...(program
      ? [{ key: 'adoption', label: 'Adoption', to: '/adoption', icon: ChartNoAxesColumnIcon }]
      : []),
    ...(governance
      ? [
          {
            key: 'ai-usage',
            label: 'Assistant checks',
            to: '/admin/ai-usage',
            icon: ScanSearchIcon,
          },
          { key: 'audit', label: 'Audit trail', to: '/admin/audit', icon: ScrollTextIcon },
        ]
      : []),
  ];
  if (oversight.length > 0) groups.push({ label: 'Governance', items: oversight });
  groups.push({
    label: 'You',
    items: [{ key: 'settings', label: 'Notifications', to: '/settings', icon: BellIcon }],
  });
  if (!relations.isCoach && !relations.hasCoachees) {
    groups[1] = {
      label: 'My growth',
      items: [
        ...(groups[1]?.items ?? []),
        { key: 'coaching', label: 'Coaching', to: '/coaching', icon: HandshakeIcon },
      ],
    };
  }
  return groups;
};
