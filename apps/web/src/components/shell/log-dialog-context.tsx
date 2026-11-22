import { createContext, useCallback, useContext, useMemo, useState } from 'react';

interface RequestFeedbackOptions {
  readonly skillId?: string | null;
  readonly activityId?: string | null;
}

interface LogDialogState {
  readonly open: boolean;
  readonly skillId: string | null;
  readonly activityId: string | null;
}

interface LogDialogApi extends LogDialogState {
  readonly show: (options?: string | RequestFeedbackOptions | null) => void;
  readonly hide: () => void;
}

const Ctx = createContext<LogDialogApi | null>(null);

export const LogDialogProvider = ({ children }: { readonly children: React.ReactNode }) => {
  const [state, setState] = useState<LogDialogState>({
    open: false,
    skillId: null,
    activityId: null,
  });
  const show = useCallback((options?: string | RequestFeedbackOptions | null) => {
    if (typeof options === 'string') {
      setState({ open: true, skillId: null, activityId: options });
    } else {
      setState({
        open: true,
        skillId: options?.skillId ?? null,
        activityId: options?.activityId ?? null,
      });
    }
  }, []);
  const hide = useCallback(() => setState((s) => ({ ...s, open: false })), []);
  const value = useMemo(() => ({ ...state, show, hide }), [state, show, hide]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useLogDialog = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useLogDialog must be used inside LogDialogProvider');
  return ctx;
};
