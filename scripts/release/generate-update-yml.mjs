#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

function usage() {
  console.error(
    [
      'Usage:',
      '  node scripts/release/generate-update-yml.mjs \\',
      '    --version 1.2.3 \\',
      '    --output /path/to/latest.yml \\',
      '    [--path "Primary-Asset-Name.ext"] \\',
      '    [--release-date "2026-02-14T00:00:00.000Z"] \\',
      '    --file /path/to/artifact1 [--file /path/to/artifact2 ...]',
      '',
      'Notes:',
      '  - File URLs in YAML use each artifact basename.',
      '  - --path defaults to the first --file basename.',
      '  - Use this after final signing/notarization so hashes match shipped binaries.',
    ].join('\n'),
  );
}

function parseArgs(argv) {
  const out = {
    version: '',
    output: '',
    primaryPath: '',
    releaseDate: new Date().toISOString(),
    files: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--version') {
      out.version = next || '';
      i += 1;
      continue;
    }
    if (arg === '--output') {
      out.output = next || '';
      i += 1;
      continue;
    }
    if (arg === '--path') {
      out.primaryPath = next || '';
      i += 1;
      continue;
    }
    if (arg === '--release-date') {
      out.releaseDate = next || out.releaseDate;
      i += 1;
      continue;
    }
    if (arg === '--file') {
      out.files.push(next || '');
      i += 1;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    out.files.push(arg);
  }

  return out;
}

function yamlScalar(value) {
  if (/^[A-Za-z0-9._/-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "''")}'`;
}

async function sha512Base64(filePath) {
  const data = await fs.readFile(filePath);
  return createHash('sha512').update(data).digest('base64');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.version || !args.output || args.files.length === 0) {
    usage();
    process.exitCode = 1;
    return;
  }

  const fileRows = [];
  for (const raw of args.files) {
    if (!raw) {
      throw new Error('Empty file path in --file');
    }
    const abs = path.resolve(raw);
    const stat = await fs.stat(abs);
    if (!stat.isFile()) {
      throw new Error(`Not a file: ${abs}`);
    }
    fileRows.push({
      abs,
      url: path.basename(abs),
      size: stat.size,
      sha512: await sha512Base64(abs),
    });
  }

  const primary = args.primaryPath || fileRows[0].url;
  const primaryRow = fileRows.find((f) => f.url === primary) || fileRows[0];

  const lines = [];
  lines.push(`version: ${yamlScalar(args.version)}`);
  lines.push('files:');
  for (const row of fileRows) {
    lines.push(`  - url: ${yamlScalar(row.url)}`);
    lines.push(`    sha512: ${yamlScalar(row.sha512)}`);
    lines.push(`    size: ${row.size}`);
  }
  lines.push(`path: ${yamlScalar(primaryRow.url)}`);
  lines.push(`sha512: ${yamlScalar(primaryRow.sha512)}`);
  lines.push(`releaseDate: ${yamlScalar(args.releaseDate)}`);
  lines.push('');

  const outPath = path.resolve(args.output);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, lines.join('\n'), 'utf8');

  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exitCode = 1;
});

