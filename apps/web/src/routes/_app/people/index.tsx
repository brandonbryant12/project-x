import { createFileRoute } from '@tanstack/react-router';
import { PeopleScreen } from '@/features/people/people-screens.tsx';

export const Route = createFileRoute('/_app/people/')({ component: PeopleScreen });
