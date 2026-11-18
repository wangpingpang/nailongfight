import {readdir, readFile, writeFile, mkdir} from 'node:fs/promises';
import {extname} from 'node:path';
import {applyFighterModule, validateConfig} from '../src/game/config.mjs';

import {clipPath} from '../src/game/fighter-audio.mjs';

const source = new URL('../src/game/', import.meta.url);
const out = new URL('../dist/', import.meta.url);
const read = file => readFile(new URL(file, source), 'utf8');
const dataUrl = (type, bytes) => 'data:' + type + ';base64,' + Buffer.from(bytes).toString('base64');
const scriptJSON = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const baseConfig = JSON.parse(await read('data/game.json'));
const fighters = JSON.parse(await read('data/' + baseConfig.fighterModule));
const cfg = validateConfig(applyFighterModule(baseConfig, fighters));
const images = new Map();
const imageTypes = {'.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.jpeg':'image/jpeg'};
for (const path of new Set(Object.values(cfg.assets).map(asset => asset.path))) {
  const bytes = await readFile(new URL(path, source));
  const mime = imageTypes[extname(path).toLowerCase()];
  if (mime) images.set(path, dataUrl(mime, bytes));
}
const fighterAudio = {};
for (const bank of new Set(Object.values(cfg.fighterAudio?.banks ?? {}))) {
  for (const cue of Object.keys(cfg.fighterAudio.gains)) {
    const path = clipPath(bank,cue);
    fighterAudio[path] = (await readFile(new URL(path,source))).toString('base64');
  }
}
function embedArtwork(text) {
  // Only literal paths in markup, styles and code also need substitution.
  for (const [path, url] of images) {
    if (text.includes(path)) text = text.replaceAll(path, url);
  }
  return text;
}
const modules = new Set((await readdir(source)).filter(name => name.endsWith('.mjs')));
const imports = {};
for (const file of modules) {
  const code = embedArtwork(await read(file)).replace(/(from\s*['"])\.\/([\w-]+\.mjs)(['"])/g, (_, start, dependency, end) => {
    if (!modules.has(dependency)) throw new Error(file + ' 缺少模块 ' + dependency);
    return start + 'game/' + dependency + end;
  });
  imports['game/' + file] = dataUrl('text/javascript;charset=utf-8', code);
}
const css = await read('style.css');
let html = await read('index.html');
html = embedArtwork(html).replace(/<link rel="stylesheet" href=".\/style.css"\s*\/?>/, () => '<style>' + embedArtwork(css) + '</style>');
function inlineScripts() {
  return '<script type="application/json" id="inline-game-config">' + scriptJSON(cfg) + '</script>\n' +
    '<script type="application/json" id="inline-game-assets">' + scriptJSON(Object.fromEntries(images)) + '</script>\n' +
    '<script type="application/json" id="inline-fighter-audio">' + scriptJSON(fighterAudio) + '</script>\n' +
    '<script type="importmap">' + scriptJSON({imports}) + '</script>\n<script type="module">import "game/main.mjs";</script>';
}
html = html.replace(/<script type="module" src=".\/main.mjs"><\/script>/, inlineScripts);
await mkdir(out, {recursive:true});
await writeFile(new URL('echo-arena.html', out), html);
console.log('离线试玩文件  dist/echo-arena.html');
