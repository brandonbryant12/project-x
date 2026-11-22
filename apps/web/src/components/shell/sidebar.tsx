import type { SessionView } from '@repo/api';
import { BrandLockup, cn, PersonAvatar } from '@repo/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { queryOptions } from '@/lib/api.ts';
import { navFor, type NavItem } from './nav.ts';

export const useInboxCount = (enabled: boolean) => {
  const { data } = useQuery({ ...queryOptions('observations', 'inbox', undefined), enabled });
  return data ? data.requests.length + data.drafts.length : 0;
};

const NavLink = ({ item, count }: { readonly item: NavItem; readonly count: number }) => (
  <Link
    to={item.to}
    activeOptions={{ exact: item.to === '/' }}
    className="group relative flex h-9 items-center gap-2.5 rounded-control px-2.5 text-ui font-medium text-ink-2 transition-colors duration-120 hover:bg-surface/70 hover:text-ink data-[status=active]:bg-surface data-[status=active]:text-ink data-[status=active]:shadow-sm data-[status=active]:ring-1 data-[status=active]:ring-line"
  >
    <span
      aria-hidden
      className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-primary opacity-0 transition-opacity group-data-[status=active]:opacity-100"
    />
    <item.icon aria-hidden className="size-4 text-ink-3 group-data-[status=active]:text-primary" />
    <span className="flex-1 truncate">{item.label}</span>
    {item.badge === 'inbox' && count > 0 ? (
      <span
        className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 font-mono text-[11px] font-semibold text-primary-fg tabular"
        aria-label={`${count} waiting on you`}
      >
        {count}
      </span>
    ) : null}
  </Link>
);

export const Sidebar = ({ session }: { readonly session: SessionView }) => {
  const count = useInboxCount(session.relations.canObserve);
  return (
    <aside className="sticky top-0 hidden h-dvh w-[252px] shrink-0 flex-col border-r border-line bg-sunken/70 lg:flex">
      <Link to="/" className="flex h-14 items-center border-b border-line/60 px-4">
        <BrandLockup size="sm" />
      </Link>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-3">
        {navFor(session).map((group, idx) => (
          <div key={group.label ?? 'top'} className={cn('grid gap-0.5', idx > 0 && 'mt-5')}>
            {group.label ? (
              <p className="px-2.5 pb-1 font-mono text-[10.5px] font-medium tracking-[0.09em] text-ink-3 uppercase">
                {group.label}
              </p>
            ) : null}
            {group.items.map((item) => (
              <NavLink key={item.key} item={item} count={count} />
            ))}
          </div>
        ))}
      </nav>
      <Link
        to="/people/$id"
        params={{ id: session.person.id }}
        className="m-3 flex items-center gap-2.5 rounded-card border border-transparent p-2 transition-colors hover:border-line hover:bg-surface"
      >
        <PersonAvatar person={session.person} size="sm" />
        <span className="min-w-0">
          <span className="block truncate text-ui font-medium text-ink">
            {session.person.displayName}
          </span>
          <span className="block truncate text-meta text-ink-3">{session.tenant.name}</span>
        </span>
      </Link>
    </aside>
  );
};
