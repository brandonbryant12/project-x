import type { SessionView } from '@repo/api';
import { cn, PersonAvatar } from '@repo/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { queryOptions } from '@/lib/api.ts';
import { navFor, type NavItem } from './nav.ts';
import { PRODUCT_NAME } from '@/lib/brand.ts';

export const useInboxCount = (enabled: boolean) => {
  const { data } = useQuery({ ...queryOptions('observations', 'inbox', undefined), enabled });
  return data ? data.requests.length + data.drafts.length : 0;
};

const NavLink = ({ item, count }: { readonly item: NavItem; readonly count: number }) => (
  <Link
    to={item.to}
    activeOptions={{ exact: item.to === '/' }}
    className="group flex h-8 items-center gap-2.5 rounded-control px-2.5 text-ui font-medium text-ink-2 transition-colors duration-120 hover:bg-sunken hover:text-ink data-[status=active]:bg-surface data-[status=active]:text-ink data-[status=active]:shadow-sm"
  >
    <item.icon aria-hidden className="size-4 text-ink-3 group-data-[status=active]:text-primary" />
    <span className="flex-1 truncate">{item.label}</span>
    {item.badge === 'inbox' && count > 0 ? (
      <span className="text-meta text-ink-3 tabular" aria-label={`${count} waiting on you`}>
        {count}
      </span>
    ) : null}
  </Link>
);

export const Sidebar = ({ session }: { readonly session: SessionView }) => {
  const count = useInboxCount(session.relations.canObserve);
  return (
    <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col border-r border-line bg-sunken/60 lg:flex">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <span
          aria-hidden
          className="grid size-7 place-items-center rounded-full border-2 border-primary"
        >
          <span className="size-3 rounded-full bg-primary" />
        </span>
        <span className="font-serif text-[17px] font-medium tracking-tight text-ink">
          {PRODUCT_NAME}
        </span>
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-2">
        {navFor(session).map((group) => (
          <div key={group.label ?? 'top'} className={cn('grid gap-0.5', group.label && 'mt-5')}>
            {group.label ? (
              <p className="px-2.5 pb-1.5 text-meta font-medium text-ink-3">{group.label}</p>
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
        className="m-3 flex items-center gap-2.5 rounded-control p-2 transition-colors hover:bg-surface"
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
