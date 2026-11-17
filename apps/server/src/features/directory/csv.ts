/**
 * The HR file format: RFC 4180 CSV with a header row. Quoted fields may hold
 * commas, doubled quotes and line breaks. Pure; no I/O.
 */
export const DIRECTORY_COLUMNS = [
  'email',
  'display_name',
  'title',
  'location',
  'business_function',
  'manager_email',
  'job_family',
  'entra_object_id',
] as const;
export type DirectoryColumn = (typeof DIRECTORY_COLUMNS)[number];

/** Every column except `entra_object_id` must be present in the header. */
const REQUIRED: ReadonlyArray<DirectoryColumn> = DIRECTORY_COLUMNS.filter(
  (c) => c !== 'entra_object_id',
);

export interface CsvRow {
  /** 1-based line number in the file, header included, for messages. */
  readonly line: number;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly title: string | null;
  readonly location: string | null;
  readonly businessFunction: string | null;
  readonly managerEmail: string | null;
  readonly jobFamily: string | null;
  readonly entraObjectId: string | null;
}

export type ParsedCsv =
  | { readonly ok: true; readonly rows: ReadonlyArray<CsvRow> }
  | { readonly ok: false; readonly message: string };

/** Splits CSV text into records of fields, tracking the line each record starts on. */
const records = (text: string): Array<{ line: number; fields: Array<string> }> => {
  const out: Array<{ line: number; fields: Array<string> }> = [];
  let fields: Array<string> = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  const endRecord = () => {
    fields.push(field);
    if (fields.length > 1 || fields[0]?.trim() !== '') out.push({ line: start, fields });
    fields = [];
    field = '';
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        if (char === '\n') line++;
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      fields.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
      start = line;
    } else field += char;
  }
  if (field !== '' || fields.length > 0) endRecord();
  return out;
};

const clean = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

export const parseDirectoryCsv = (text: string): ParsedCsv => {
  const all = records(text.replace(/^﻿/, ''));
  const [header, ...body] = all;
  if (!header) return { ok: false, message: 'The file is empty. Include a header row.' };
  const names = header.fields.map((f) => f.trim().toLowerCase());
  const missing = REQUIRED.filter((c) => !names.includes(c));
  if (missing.length > 0) {
    return {
      ok: false,
      message: `The header is missing ${missing.join(', ')}. Expected columns: ${DIRECTORY_COLUMNS.join(', ')}.`,
    };
  }
  const index = (column: DirectoryColumn) => names.indexOf(column);
  const at = (fields: ReadonlyArray<string>, column: DirectoryColumn) =>
    index(column) < 0 ? null : clean(fields[index(column)]);
  return {
    ok: true,
    rows: body.map(({ line, fields }) => ({
      line,
      email: at(fields, 'email')?.toLowerCase() ?? null,
      displayName: at(fields, 'display_name'),
      title: at(fields, 'title'),
      location: at(fields, 'location'),
      businessFunction: at(fields, 'business_function'),
      managerEmail: at(fields, 'manager_email')?.toLowerCase() ?? null,
      jobFamily: at(fields, 'job_family'),
      entraObjectId: at(fields, 'entra_object_id'),
    })),
  };
};
