import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@repo/ui';
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useTheme, type ThemeChoice } from '@/lib/theme.ts';

const NEXT: Record<ThemeChoice, ThemeChoice> = { light: 'dark', dark: 'system', system: 'light' };
const ICON = { light: SunIcon, dark: MoonIcon, system: MonitorIcon } as const;
const LABEL = { light: 'Light theme', dark: 'Dark theme', system: 'System theme' } as const;

export const ThemeToggle = () => {
  const [choice, setChoice] = useTheme();
  const Icon = ICON[choice];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`${LABEL[choice]}. Switch theme.`}
          onClick={() => setChoice(NEXT[choice])}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{LABEL[choice]}</TooltipContent>
    </Tooltip>
  );
};
