import type { SessionView } from '@repo/api';
import {
  BookOpenIcon,
  ChartNoAxesColumnIcon,
  CompassIcon,
  HandshakeIcon,
  HomeIcon,
  InboxIcon,
  type LucideIcon,
  ScanSearchIcon,
  ScrollTextIcon,
  SlidersHorizontalIcon,
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
 * Navigation separates "My growth" from "Coaching others" so advisors, leaders,
 * and coaches immediately understand where their own progress lives vs. where
 * they support others.
 */
export const navFor = (session: SessionView): ReadonlyArray<NavGroup> => {
  const { relations, grants } = session;
  const groups: Array<NavGroup> = [
    {
      label: null,
      items: [{ key: 'home', label: 'Home', to: '/', icon: HomeIcon }],
    },
    {
      label: 'My growth',
      items: [
        { key: 'development', label: 'My skills', to: '/development', icon: SproutIcon },
        { key: 'skills', label: 'Skill catalog', to: '/catalog/skills', icon: CompassIcon },
      ],
    },
  ];

  const coachingItems: Array<NavItem> = [];
  if (relations.canObserve) {
    coachingItems.push({
      key: 'inbox',
      label: 'Feedback requests',
      to: '/inbox',
      icon: InboxIcon,
      badge: 'inbox',
    });
  }
  if (relations.hasReports) {
    coachingItems.push({ key: 'team', label: 'My team', to: '/team', icon: UsersIcon });
  }
  if (relations.isCoach || relations.hasCoachees) {
    coachingItems.push({
      key: 'coaching',
      label: 'People I coach',
      to: '/coaching',
      icon: HandshakeIcon,
    });
  }
  if (coachingItems.length > 0) {
    groups.push({ label: 'Coaching', items: coachingItems });
  }

  groups.push({
    label: 'Directory',
    items: [{ key: 'people', label: 'People', to: '/people', icon: BookOpenIcon }],
  });

  const admin = grants.includes('tenant_admin');
  const programOwner = grants.includes('program_owner');
  const compliance = grants.includes('compliance_reviewer');
  if (admin || programOwner) {
    groups.push({
      label: 'Program',
      items: [{ key: 'adoption', label: 'Adoption', to: '/adoption', icon: ChartNoAxesColumnIcon }],
    });
  }
  if (admin || compliance || programOwner) {
    const govItems: Array<NavItem> = [
      { key: 'policy', label: 'Program policy', to: '/admin/policy', icon: SlidersHorizontalIcon },
    ];
    if (admin || compliance) {
      govItems.push(
        { key: 'ai-usage', label: 'Privacy checks', to: '/admin/ai-usage', icon: ScanSearchIcon },
        { key: 'audit', label: 'Audit trail', to: '/admin/audit', icon: ScrollTextIcon },
      );
    }
    groups.push({ label: 'Governance', items: govItems });
  }
  return groups;
};
