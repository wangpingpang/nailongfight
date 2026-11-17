import {readdir, readFile, writeFile, mkdir, access} from 'node:fs/promises';
import {validateConfig} from '../src/game/config.mjs';

const source = new URL('../src/game/', import.meta.url);
const out = new URL('../dist/', import.meta.url);
const read = file => readFile(new URL(file, source), 'utf8');
const dataUrl = (type, bytes) => 'data:' + type + ';base64,' + Buffer.from(bytes).toString('base64');
const scriptJSON = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const images = new Map();
for (const file of await readdir(new URL('assets/', source))) {
  if (file.endsWith('.svg')) images.set('./assets/' + file, dataUrl('image/svg+xml', await read('assets/' + file)));
}
function embedArtwork(text) {
  for (const [path, url] of images) text = text.replaceAll(path, url);
  return text;
}
const cfg = JSON.parse(await read('data/game.json'));
validateConfig(cfg);
for (const asset of Object.values(cfg.assets)) await access(new URL(asset.path, source));
const modules = new Set((await readdir(source)).filter(name => name.endsWith('.mjs')));
const imports = {};
for (const file of modules) {
  const code = embedArtwork(await read(file)).replace(/(from\s*['"])\.\/(\w+\.mjs)(['"])/g, (_, start, dependency, end) => {
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
    '<script type="importmap">' + scriptJSON({imports}) + '</script>\n<script type="module">import "game/main.mjs";</script>';
}
html = html.replace(/<script type="module" src=".\/main.mjs"><\/script>/, inlineScripts);
await mkdir(out, {recursive:true});
await writeFile(new URL('echo-arena.html', out), html);
console.log('离线试玩文件  dist/echo-arena.html');
