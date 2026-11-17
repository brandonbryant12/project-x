import { useSuspenseQuery } from '@tanstack/react-query';
import { queryOptions } from './api.ts';

export const sessionQuery = queryOptions('session', 'me', undefined);

export const useSession = () => useSuspenseQuery(sessionQuery).data;
