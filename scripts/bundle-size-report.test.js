/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { bundleSizeReport } from './bundle-size-report.js';

test('reports positive, negative and unchanged sizes without budgets', () => {
  const base = [
    { name: 'grow', size: 100 },
    { name: 'shrink', size: 200 },
    { name: 'same', size: 50 },
  ];
  const head = [
    { name: 'same', size: 50 },
    { name: 'grow', size: 10000 },
    { name: 'shrink', size: 100 },
  ];
  const report = bundleSizeReport(base, head);
  assert.ok(report.includes('| grow | 100 | 10000 | +9900 B (+9900.00%) |'));
  assert.ok(report.includes('| shrink | 200 | 100 | -100 B (-50.00%) |'));
  assert.ok(report.includes('| same | 50 | 50 | 0 B (0.00%) |'));
});

test('matches rows by name, handles added and removed exports and zero baselines', () => {
  const report = bundleSizeReport(
    [
      { name: 'removed', size: 100 },
      { name: 'empty', size: 0 },
    ],
    [
      { name: 'added', size: 10 },
      { name: 'empty', size: 5 },
    ],
  );
  assert.ok(report.includes('| added | — | 10 | added |'));
  assert.ok(report.includes('| removed | 100 | — | removed |'));
  assert.ok(report.includes('| empty | 0 | 5 | +5 B |'));
});

test('escapes table cells from package metadata', () => {
  const results = [{ name: '<entry>|\nnext', size: 1 }];
  assert.ok(
    bundleSizeReport(results, results).includes('&lt;entry&gt;&#124; next'),
  );
});

test('fails on missing or invalid measurements instead of producing an empty report', () => {
  const good = [{ name: 'entry', size: 1 }];
  for (const invalid of [
    [],
    {},
    [{ name: 'entry' }],
    [{ name: 'entry', size: -1 }],
    [{ name: 'entry', size: Number.NaN }],
    [...good, ...good],
  ]) {
    assert.throws(() => bundleSizeReport(invalid, good));
    assert.throws(() => bundleSizeReport(good, invalid));
  }
});

test('measures exports of new packages and supports revisions without them', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'bundle-size-config-'));
  const loadChecks = () =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import checks from ${JSON.stringify(new URL('../.size-limit.js', import.meta.url).href)}; console.log(JSON.stringify(checks));`,
        ],
        { env: { ...process.env, BUNDLE_SIZE_ROOT: root }, encoding: 'utf8' },
      ),
    );
  try {
    for (const directory of ['api', 'instrumentation', 'sdk']) {
      const packageRoot = resolve(root, 'packages', directory);
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        resolve(packageRoot, 'package.json'),
        JSON.stringify({
          name: `@opentelemetry/browser-${directory}`,
          exports: {
            '.': { default: './dist/index.js', types: './dist/index.d.ts' },
            './package.json': './package.json',
          },
        }),
      );
    }
    const checks = loadChecks();
    assert.deepEqual(checks.map(({ name }) => name).sort(), [
      '@opentelemetry/browser-api [*, brotli]',
      '@opentelemetry/browser-api [*, gzip]',
      '@opentelemetry/browser-instrumentation [*, brotli]',
      '@opentelemetry/browser-instrumentation [*, gzip]',
      '@opentelemetry/browser-sdk [*, brotli]',
      '@opentelemetry/browser-sdk [*, gzip]',
    ]);
    const api = checks.find(
      ({ name }) => name === '@opentelemetry/browser-api [*, gzip]',
    );
    assert.equal(api.path, resolve(root, 'packages/api/dist/index.js'));
    assert.equal(api.gzip, true);
    rmSync(resolve(root, 'packages/api'), { recursive: true });
    assert.equal(loadChecks().length, 4);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
