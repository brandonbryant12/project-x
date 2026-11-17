import {
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@repo/ui';
import { useIsDesktop } from '@/lib/use-media.ts';

/** Dialog on desktop, bottom drawer on phones (ux-brief §6). */
export const ResponsiveDialog = ({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  readonly children: React.ReactNode;
  readonly className?: string;
}) => {
  const desktop = useIsDesktop();
  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={cn('max-w-xl', className)}>
          <div className="grid gap-1.5 pr-8">
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </div>
          {children}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="grid gap-1 px-5 pt-2">
          <DrawerTitle>{title}</DrawerTitle>
          {description ? <DrawerDescription>{description}</DrawerDescription> : null}
        </div>
        <div className="overflow-y-auto px-5 pt-4 pb-5">{children}</div>
      </DrawerContent>
    </Drawer>
  );
};
