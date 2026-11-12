import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const projectRoot = new URL('../', import.meta.url);
process.chdir(fileURLToPath(projectRoot));

const [template, styles, browserBuild] = await Promise.all([
  readFile('web/index.html', 'utf8'),
  readFile('web/styles.css', 'utf8'),
  build({
    entryPoints: ['web/app.js'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
  }),
]);
const script = browserBuild.outputFiles[0].text.replaceAll('</script', '<\\/script');
const page = template
  .replace('/* CARELINE_STYLES */', () => styles)
  .replace('/* CARELINE_SCRIPT */', () => script);

await writeFile(
  'worker/page.js',
  `// Generated from web/. Do not edit.\nexport const page = ${JSON.stringify(page)};\n`,
);
await rm('dist', { recursive: true, force: true });
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await build({
  entryPoints: ['worker/index.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/server/index.js',
});
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
await mkdir('docs', { recursive: true });
await writeFile('docs/index.html', page);
await writeFile('docs/.nojekyll', '');
console.log('Built Worker and GitHub Pages frontend.');
