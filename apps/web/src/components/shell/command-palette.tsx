import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogTitle,
  PersonAvatar,
} from '@repo/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { CompassIcon, MessageSquarePlusIcon, SendIcon, SproutIcon, UserIcon } from 'lucide-react';
import { useState } from 'react';
import { queryOptions } from '@/lib/api.ts';
import { useLogDialog } from './log-dialog-context.tsx';

/** ⌘K: quick search across people, skills, and core coaching actions. */
export const CommandPalette = ({
  open,
  onOpenChange,
  canObserve,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly canObserve: boolean;
}) => {
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const log = useLogDialog();
  const people = useQuery({ ...queryOptions('people', 'search', { query: { q } }), enabled: open });
  const skills = useQuery({ ...queryOptions('catalog', 'skills', { query: {} }), enabled: open });
  const go = (fn: () => void) => {
    onOpenChange(false);
    setQ('');
    fn();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className="top-[18%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <Command shouldFilter={false}>
          <CommandInput
            value={q}
            onValueChange={setQ}
            placeholder="Search people, skills, or actions..."
          />
          <CommandList>
            <CommandEmpty>Nothing matches “{q}”.</CommandEmpty>
            {q === '' ? (
              <CommandGroup heading="Quick actions">
                <CommandItem onSelect={() => go(() => log.show())}>
                  <SendIcon /> Ask for feedback
                </CommandItem>
                {canObserve ? (
                  <CommandItem
                    onSelect={() => go(() => void navigate({ to: '/observations/new' }))}
                  >
                    <MessageSquarePlusIcon /> Give feedback
                  </CommandItem>
                ) : null}
                <CommandItem onSelect={() => go(() => void navigate({ to: '/development' }))}>
                  <SproutIcon /> My skills
                </CommandItem>
              </CommandGroup>
            ) : null}
            {(people.data ?? []).slice(0, 6).map((card) => (
              <CommandGroup key={card.person.id} heading={card.person.displayName}>
                <CommandItem
                  onSelect={() =>
                    go(() => void navigate({ to: '/people/$id', params: { id: card.person.id } }))
                  }
                >
                  <PersonAvatar person={card.person} size="xs" /> View {card.person.displayName}
                  {card.relation ? (
                    <span className="ml-auto text-meta text-ink-3">{card.relation}</span>
                  ) : null}
                </CommandItem>
                {canObserve && card.relation ? (
                  <CommandItem
                    onSelect={() =>
                      go(
                        () =>
                          void navigate({
                            to: '/observations/new',
                            search: { for: card.person.id },
                          }),
                      )
                    }
                  >
                    <MessageSquarePlusIcon /> Give feedback to{' '}
                    {card.person.displayName.split(' ')[0]}
                  </CommandItem>
                ) : null}
              </CommandGroup>
            ))}
            {q !== '' ? (
              <CommandGroup heading="Skills">
                {(skills.data ?? [])
                  .filter((s) => s.name.toLowerCase().includes(q.toLowerCase()))
                  .slice(0, 5)
                  .map((s) => (
                    <CommandItem
                      key={s.id}
                      onSelect={() =>
                        go(
                          () =>
                            void navigate({
                              to: '/catalog/skills/$slug',
                              params: { slug: s.slug },
                            }),
                        )
                      }
                    >
                      <CompassIcon /> {s.name}
                    </CommandItem>
                  ))}
              </CommandGroup>
            ) : null}
            {q === '' ? (
              <CommandGroup heading="Go to">
                <CommandItem onSelect={() => go(() => void navigate({ to: '/people' }))}>
                  <UserIcon /> People directory
                </CommandItem>
                <CommandItem onSelect={() => go(() => void navigate({ to: '/catalog/skills' }))}>
                  <CompassIcon /> Skill catalog
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
};
