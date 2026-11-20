import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseIngestCliArgs, resolveCsvFilesInDir } from '../../src/ingest/cli.js';

describe('Ingest CLI argument parsing and directory resolution (no DB required)', () => {
  it('validates --type, --dir, and --data-as-of arguments strictly', () => {
    expect(
      parseIngestCliArgs([
        '--type',
        'corporate',
        '--dir',
        '/mnt/ingest/corporate/2026-10',
        '--data-as-of',
        '2026-09-30',
      ]),
    ).toEqual({
      type: 'corporate',
      dir: '/mnt/ingest/corporate/2026-10',
      dataAsOf: '2026-09-30',
    });

    expect(() =>
      parseIngestCliArgs(['--type', 'unknown', '--dir', '/tmp', '--data-as-of', '2026-09-30']),
    ).toThrow(/--type/);

    expect(() => parseIngestCliArgs(['--type', 'corporate', '--data-as-of', '2026-09-30'])).toThrow(
      /--dir/,
    );

    expect(() =>
      parseIngestCliArgs(['--type', 'corporate', '--dir', '/tmp', '--data-as-of', '2026-02-30']),
    ).toThrow(/--data-as-of/);

    expect(() =>
      parseIngestCliArgs(['--type', 'invoice', '--dir', '/tmp', '--data-as-of', '2026-04-31']),
    ).toThrow(/--data-as-of/);

    expect(() =>
      parseIngestCliArgs([
        '--type',
        'corporate',
        '--dir',
        '/tmp',
        '--data-as-of',
        '2026-09-30',
        'extra-arg',
      ]),
    ).toThrow(/positional/);
  });

  it('reads .csv files in ascending filename order and fails when directory is missing or has no .csv', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'houjin-cli-args-unit-'));
    try {
      const subDir = path.join(tempRoot, 'order-check');
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(subDir, '02_second.csv'), 'dummy2\n', 'utf-8');
      fs.writeFileSync(path.join(subDir, '01_first.csv'), 'dummy1\n', 'utf-8');
      fs.writeFileSync(path.join(subDir, 'readme.txt'), 'ignore me\n', 'utf-8');

      const resolved = resolveCsvFilesInDir(subDir);
      expect(resolved.map((p) => path.basename(p))).toEqual(['01_first.csv', '02_second.csv']);

      const emptyDir = path.join(tempRoot, 'empty-dir');
      fs.mkdirSync(emptyDir, { recursive: true });
      expect(() => resolveCsvFilesInDir(emptyDir)).toThrow(/No \.csv files/);

      expect(() => resolveCsvFilesInDir(path.join(tempRoot, 'does-not-exist'))).toThrow(
        /does not exist/,
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
