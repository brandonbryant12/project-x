import { createContext, useCallback, useContext, useMemo, useState } from 'react';

interface LogDialogState {
  readonly open: boolean;
  readonly activityId: string | null;
}

interface LogDialogApi extends LogDialogState {
  readonly show: (activityId?: string | null) => void;
  readonly hide: () => void;
}

const Ctx = createContext<LogDialogApi | null>(null);

export const LogDialogProvider = ({ children }: { readonly children: React.ReactNode }) => {
  const [state, setState] = useState<LogDialogState>({ open: false, activityId: null });
  const show = useCallback(
    (activityId: string | null = null) => setState({ open: true, activityId }),
    [],
  );
  const hide = useCallback(() => setState((s) => ({ ...s, open: false })), []);
  const value = useMemo(() => ({ ...state, show, hide }), [state, show, hide]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useLogDialog = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLogDialog must be used inside LogDialogProvider');
  return ctx;
};
