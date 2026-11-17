import { Api } from '@repo/api';
import { HttpApiBuilder } from 'effect/http-api';
import { apiErrorsOnly } from '../../http/api-errors.ts';
import { departPerson } from './depart.ts';
import { importDirectory } from './import.ts';

export const DirectoryHandlers = HttpApiBuilder.group(Api, 'directory', (handlers) =>
  handlers
    .handle('importDirectory', ({ payload }) => importDirectory(payload).pipe(apiErrorsOnly))
    .handle('departPerson', ({ params, payload }) =>
      departPerson(params.id, payload).pipe(apiErrorsOnly),
    ),
);
