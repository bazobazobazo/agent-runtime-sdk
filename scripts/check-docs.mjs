#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

const root = new URL('..', import.meta.url).pathname;
const markdownFiles = [
  join(root, 'README.md'),
  join(root, 'CONTRIBUTING.md'),
  ...(await markdownUnder(join(root, 'docs'))),
  ...(await markdownUnder(join(root, 'examples'))),
  ...(await markdownUnder(join(root, 'packages'))).filter((path) => path.endsWith('README.md')),
].sort();

const problems = [];
const snippets = [];

for (const path of markdownFiles) {
  const content = await readFile(path, 'utf8');
  checkLinks(path, content);
  checkImports(path, content);
  extractSnippets(path, content);
}

await checkSnippets();
await checkTsdoc();

if (problems.length) {
  throw new Error(`Documentation check failed:\n${problems.map((item) => `- ${item}`).join('\n')}`);
}

console.log(`Checked ${markdownFiles.length} Markdown files, ${snippets.length} TypeScript snippets, local links, public imports, and stable-export TSDoc.`);

async function markdownUnder(directory) {
  if (!existsSync(directory)) return [];
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await markdownUnder(path));
    else if (entry.isFile() && extname(entry.name) === '.md') output.push(path);
  }
  return output;
}

function checkLinks(path, content) {
  const linkPattern = /(?<!!)\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of content.matchAll(linkPattern)) {
    const raw = match[1].trim().replace(/^<|>$/g, '');
    if (!raw || raw.startsWith('#') || /^(?:https?:|mailto:)/.test(raw)) continue;
    const withoutAnchor = raw.split('#', 1)[0];
    if (!withoutAnchor) continue;
    const target = resolve(dirname(path), decodeURIComponent(withoutAnchor));
    if (!existsSync(target)) problems.push(`${relative(root, path)} has broken link ${raw}`);
  }
}

function checkImports(path, content) {
  const prohibited = /from\s+['"]@banzae\/[^'"]+\/(?:src|dist|protocol|transport|parser|dispatcher)(?:\/[^'"]*)?['"]/g;
  for (const match of content.matchAll(prohibited)) {
    problems.push(`${relative(root, path)} contains unsupported deep import ${match[0]}`);
  }
}

function extractSnippets(path, content) {
  const fence = /^```(?:ts|typescript)\s*\n([\s\S]*?)^```\s*$/gm;
  let index = 0;
  for (const match of content.matchAll(fence)) {
    index += 1;
    snippets.push({ path, index, code: match[1] });
  }
}

async function checkSnippets() {
  if (!snippets.length) return;
  const directory = await mkdtemp(join(root, '.docs-check-'));
  try {
    const files = [];
    for (const snippet of snippets) {
      const file = join(directory, `snippet-${files.length + 1}.ts`);
      await writeFile(file, `${snippet.code}\nexport {};\n`, 'utf8');
      files.push(file);
    }
    const config = JSON.parse(await readFile(join(root, 'tsconfig.base.json'), 'utf8'));
    const options = {
      ...config.compilerOptions,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      baseUrl: root,
      noEmit: true,
      declaration: false,
      declarationMap: false,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    };
    const program = ts.createProgram(files, options);
    for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
      const fileIndex = diagnostic.file ? files.indexOf(diagnostic.file.fileName) : -1;
      const source = fileIndex >= 0 ? snippets[fileIndex] : undefined;
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
      problems.push(`${source ? `${relative(root, source.path)} TypeScript snippet ${source.index}` : 'TypeScript snippet'}: ${message}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function checkTsdoc() {
  const inventory = JSON.parse(await readFile(join(root, 'etc/api/public-api-inventory.json'), 'utf8')).exports;
  const expected = new Set(
    inventory
      .filter((item) => item.classification === 'stable-for-alpha')
      .map((item) => `${item.package}:${item.entrypoint}:${item.name}`),
  );
  const entries = [];
  for (const directory of await readdir(join(root, 'packages'))) {
    const manifestPath = join(root, 'packages', directory, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.private) continue;
    for (const [entrypoint, target] of Object.entries(manifest.exports ?? {})) {
      if (entrypoint !== '.') continue;
      entries.push({
        packageName: manifest.name,
        entrypoint,
        file: join(root, 'packages', directory, target.types.replace(/^\.\//, '')),
      });
    }
  }
  const program = ts.createProgram(entries.map((entry) => entry.file), {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  for (const entry of entries) {
    const source = program.getSourceFile(entry.file);
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    if (!moduleSymbol) continue;
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const key = `${entry.packageName}:${entry.entrypoint}:${exported.name}`;
      if (!expected.has(key)) continue;
      const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      if (!ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim()) {
        problems.push(`${key} has no TSDoc`);
      }
    }
  }
}
