/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSchema, validate, type DocumentNode } from 'graphql';
import { describe, expect, it } from 'vitest';
import * as operations from './graphql';

const here = import.meta.dirname;
// The bridge's current schema, read from its source so the two cannot drift.
const bridgeSource = readFileSync(
  join(here, '../../../bridge/src/schema.ts'),
  'utf8',
);
const currentSdl = /typeDefs: \/\* GraphQL \*\/ `([^`]*)`/.exec(
  bridgeSource,
)?.[1];
const frozen040 = readFileSync(join(here, 'bridge-0.4.0.graphql'), 'utf8');
// Only these may fail on a 0.4.0 bridge; the app detects that and asks the
// user to update instead of breaking agent sessions in projects.
const needsNewer = [
  'HOME_FOLDER',
  'START_TERMINAL',
  'START_HOME_SESSION',
  'HERMES',
  'HERMES_SUMMARY',
  'HERMES_SEND',
  'HERMES_STOP',
  'HERMES_NEW',
  'START_HERDR',
  'FOLDERS',
  'START_FOLDER_SESSION',
  'START_FOLDER_TERMINAL',
];

const documents = Object.entries(operations).filter(
  (entry): entry is [string, DocumentNode] =>
    typeof entry[1] === 'object' &&
    entry[1] !== null &&
    (entry[1] as DocumentNode).kind === 'Document',
);
const errorsAgainst = (sdl: string, document: DocumentNode) =>
  validate(buildSchema(sdl), document).map((error) => error.message);

describe('app operations against bridge schemas', () => {
  it('finds the operations and the current schema', () => {
    expect(currentSdl).toBeTruthy();
    expect(documents.length).toBeGreaterThan(8);
  });
  it.each(documents)('%s matches the current bridge', (_name, document) => {
    expect(errorsAgainst(currentSdl ?? '', document)).toEqual([]);
  });
  it.each(documents.filter(([name]) => !needsNewer.includes(name)))(
    '%s still works against a 0.4.0 bridge',
    (_name, document) => {
      expect(errorsAgainst(frozen040, document)).toEqual([]);
    },
  );
});
