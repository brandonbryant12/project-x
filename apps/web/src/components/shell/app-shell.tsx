import type { SessionView } from '@repo/api';
import {
  Button,
  Drawer,
  DrawerContent,
  DrawerTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Kbd,
  PersonAvatar,
} from '@repo/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  BellIcon,
  CircleHelpIcon,
  HomeIcon,
  InboxIcon,
  LogOutIcon,
  MenuIcon,
  MessageSquarePlusIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  SproutIcon,
  UserIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { HowItWorksDialog } from '@/components/how-it-works-dialog.tsx';
import { QuickRequestDialog } from '@/features/development/quick-request-dialog.tsx';
import { call } from '@/lib/api.ts';
import { PRODUCT_NAME } from '@/lib/brand.ts';
import { CommandPalette } from './command-palette.tsx';
import { useLogDialog } from './log-dialog-context.tsx';
import { navFor } from './nav.ts';
import { Sidebar, useInboxCount } from './sidebar.tsx';
import { ThemeToggle } from './theme-toggle.tsx';
import { useShortcuts } from './use-shortcuts.ts';

const AccountMenu = ({ session }: { readonly session: SessionView }) => {
  const qc = useQueryClient();
  const signOut = async () => {
    await call('auth', 'signOut', undefined).catch(() => undefined);
    qc.clear();
    window.location.assign('/sign-in');
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="cursor-pointer rounded-full" aria-label="Account">
          <PersonAvatar person={session.person} size="sm" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>
          {session.person.displayName}
          <br />
          {session.email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/people/$id" params={{ id: session.person.id }}>
            <UserIcon /> Your profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/settings">
            <BellIcon /> Notifications
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOutIcon /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const MobileTabs = ({
  session,
  onMore,
}: {
  readonly session: SessionView;
  readonly onMore: () => void;
}) => {
  const log = useLogDialog();
  const navigate = useNavigate();
  const count = useInboxCount(session.relations.canObserve);
  const tab =
    'flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-ink-3 data-[status=active]:text-primary';
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(60px+env(safe-area-inset-bottom))] items-start border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <Link to="/" activeOptions={{ exact: true }} className={`${tab} h-[60px]`}>
        <HomeIcon className="size-5" /> Home
      </Link>
      {session.relations.canObserve ? (
        <Link to="/inbox" className={`${tab} h-[60px]`}>
          <span className="relative">
            <InboxIcon className="size-5" />
            {count > 0 ? (
              <span className="absolute -top-1 -right-2.5 rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-fg tabular">
                {count}
              </span>
            ) : null}
          </span>
          Requests
        </Link>
      ) : null}
      <div className="flex h-[60px] flex-1 items-center justify-center">
        <Button
          variant="primary"
          size="icon"
          className="size-11 rounded-full shadow-sm"
          aria-label={session.relations.canObserve ? 'Give feedback' : 'Ask for feedback'}
          onClick={() =>
            session.relations.canObserve ? void navigate({ to: '/observations/new' }) : log.show()
          }
        >
          <PlusIcon className="size-5" />
        </Button>
      </div>
      <Link to="/development" className={`${tab} h-[60px]`}>
        <SproutIcon className="size-5" /> My skills
      </Link>
      <button type="button" onClick={onMore} className={`${tab} h-[60px] cursor-pointer`}>
        <MenuIcon className="size-5" /> More
      </button>
    </nav>
  );
};

export const AppShell = ({
  session,
  children,
}: {
  readonly session: SessionView;
  readonly children: React.ReactNode;
}) => {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const log = useLogDialog();
  const navigate = useNavigate();
  const canObserve = session.relations.canObserve;
  const handlers = useMemo(
    () => ({
      palette: () => setPaletteOpen(true),
      log: () => log.show(),
      observe: canObserve ? () => void navigate({ to: '/observations/new' }) : null,
    }),
    [log, navigate, canObserve],
  );
  useShortcuts(handlers);
  return (
    <div className="flex min-h-dvh">
      <Sidebar session={session} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2.5 border-b border-line bg-canvas/90 px-4 backdrop-blur md:px-6">
          <Link
            to="/"
            className="shrink-0 font-serif text-[17px] font-medium whitespace-nowrap text-ink lg:hidden"
          >
            {PRODUCT_NAME}
          </Link>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="ml-auto flex h-9 w-9 min-w-0 cursor-pointer items-center justify-center gap-2 rounded-control border border-line bg-surface px-0 text-ui text-ink-3 transition-colors hover:border-line-strong sm:w-full sm:max-w-64 sm:justify-start sm:px-3 lg:ml-0"
          >
            <SearchIcon className="size-4" />
            <span className="hidden flex-1 text-left sm:inline">Search people & skills</span>
            <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
          </button>
          <div className="ml-auto hidden items-center gap-2 md:flex">
            <Button
              variant={canObserve ? 'secondary' : 'primary'}
              size="sm"
              onClick={() => log.show()}
            >
              <SendIcon /> Ask for feedback
            </Button>
            {canObserve ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => void navigate({ to: '/observations/new' })}
              >
                <MessageSquarePlusIcon /> Give feedback
              </Button>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="How Coaching Catalyst works"
            title="How it works"
            onClick={() => setHelpOpen(true)}
          >
            <CircleHelpIcon />
          </Button>
          <ThemeToggle />
          <AccountMenu session={session} />
        </header>
        <main className="flex-1 pb-[calc(76px+env(safe-area-inset-bottom))] lg:pb-0">
          {children}
        </main>
      </div>
      <MobileTabs session={session} onMore={() => setMoreOpen(true)} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} canObserve={canObserve} />
      <QuickRequestDialog />
      <HowItWorksDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} session={session} />
    </div>
  );
};

const MoreSheet = ({
  open,
  onOpenChange,
  session,
}: {
  readonly open: boolean;
  readonly onOpenChange: (o: boolean) => void;
  readonly session: SessionView;
}) => (
  <MoreDrawer open={open} onOpenChange={onOpenChange}>
    {navFor(session).map((group) => (
      <div key={group.label ?? 'top'} className="grid gap-0.5 px-4 pb-3">
        {group.label ? (
          <p className="px-2 pb-1 text-[11px] font-semibold tracking-wider text-ink-3 uppercase">
            {group.label}
          </p>
        ) : null}
        {group.items.map((item) => (
          <Link
            key={item.key}
            to={item.to}
            onClick={() => onOpenChange(false)}
            className="flex h-11 items-center gap-3 rounded-control px-2 text-body text-ink hover:bg-sunken"
          >
            <item.icon className="size-4 text-ink-3" /> {item.label}
          </Link>
        ))}
      </div>
    ))}
  </MoreDrawer>
);

const MoreDrawer = ({
  open,
  onOpenChange,
  children,
}: {
  readonly open: boolean;
  readonly onOpenChange: (o: boolean) => void;
  readonly children: React.ReactNode;
}) => (
  <Drawer open={open} onOpenChange={onOpenChange}>
    <DrawerContent>
      <DrawerTitle className="sr-only">Navigation</DrawerTitle>
      <div className="overflow-y-auto py-2">{children}</div>
    </DrawerContent>
  </Drawer>
);
