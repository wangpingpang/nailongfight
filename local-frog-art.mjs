// The private T07 artwork stays on the device that owns the original offline game.
const storageKey = 't07.original-frog-images.v1';
const originalSha256 = '725e5ec374cc7d8f731645659f2d2b75dfe6f2f89f89013c505a784ce04aaa79';
const frogs = ['melancholy', 'laughing', 'sacred'];
const defaults = new WeakMap();
let currentUrls;
let firstLoad;

function assetFor(id, sheet) {
  return sheet === 'A' || sheet === 'B' ? 'frog-' + sheet : id + '-' + sheet;
}

export async function readFrogImages(file) {
  if (file.size !== 20709783) throw new Error('请选择 T07-电脑试玩版.html 原文件。');
  const contents = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', contents);
  const hex = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  if (hex !== originalSha256) throw new Error('文件版本不匹配，请使用 T07 原版电脑试玩文件。');
  const html = new TextDecoder().decode(contents);
  const tag = 'id="inline-game-assets">';
  const from = html.indexOf(tag) + tag.length;
  const images = JSON.parse(html.slice(from, html.indexOf('</script>', from)));
  const names = new Set(['frog-model', ...frogs.flatMap(id => ['A','B','C','D','E'].map(sheet => assetFor(id,sheet)))]);
  const result = {};
  for (const name of names) {
    const url = images['./assets/fighters/' + name + '.webp'];
    const bytes = Uint8Array.from(atob(url.split(',')[1]), c => c.charCodeAt(0));
    result[name] = new Blob([bytes], {type:'image/webp'});
  }
  return result;
}

function readOrWritePack(mode, value) {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open(storageKey, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('looks');
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('本机外观存储暂不可用。'));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('looks', mode);
      const items = tx.objectStore('looks');
      const action = mode === 'readonly' ? items.get('original') :
        value ? items.put(value,'original') : items.delete('original');
      tx.oncomplete = () => { db.close(); resolve(action.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}

function setImages(images) {
  if (currentUrls) Object.values(currentUrls).forEach(url => URL.revokeObjectURL(url));
  currentUrls = images ? Object.fromEntries(Object.entries(images).map(([name,blob]) => [name,URL.createObjectURL(blob)])) : null;
}

export async function applyLocalFrogArt(config) {
  if (!firstLoad) {
    firstLoad = (async () => {
      try {
        if (globalThis.localStorage?.getItem(storageKey)) setImages(await readOrWritePack('readonly'));
      } catch { /* The public artwork also works with browser storage disabled. */ }
    })();
  }
  await firstLoad;
  if (!config.assets['pond.melancholy.portrait']) return config;
  const original = defaults.get(config) || new Map();
  defaults.set(config, original);
  for (const id of frogs) {
    const actor = config.characters[id];
    const sheets = config.animations[actor.animation].sheets;
    const bindings = [[actor.asset,'frog-model'],...Object.entries(sheets).map(([sheet,asset])=>[asset,assetFor(id,sheet)])];
    for (const [key,name] of bindings) {
      const asset = config.assets[key];
      if (!original.has(key)) original.set(key,asset.path);
      asset.path = currentUrls?.[name] || original.get(key);
    }
  }
  return config;
}

export function frogLookSettings(config) {
  const box = document.createElement('details');
  const title = document.createElement('summary');
  title.textContent = '本机奶蛙外观';
  const note = document.createElement('p');
  note.className = 'muted';
  note.textContent = '选择已有的 T07-电脑试玩版.html，可在这台电脑使用原版图集。对手可以独立选外观。';
  const select = document.createElement('input');
  select.type = 'file';
  select.accept = '.html';
  select.setAttribute('aria-label','选择 T07 电脑试玩原包');
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'quiet';
  reset.textContent = '使用公网外观';
  reset.disabled = !currentUrls;
  const status = document.createElement('p');
  status.setAttribute('role','status');
  status.textContent = currentUrls ? '当前使用本机原版图集。' : '当前使用公网外观。';
  async function change(file) {
    select.disabled = true;
    reset.disabled = true;
    try {
      const images = file ? await readFrogImages(file) : null;
      let saved = true;
      try {
        await readOrWritePack('readwrite',images);
        if (images) localStorage.setItem(storageKey,'1');
        else localStorage.removeItem(storageKey);
      } catch { saved = false; }
      setImages(images);
      await applyLocalFrogArt(config);
      status.textContent = images ? '已启用原版图集。' : '已恢复公网外观。';
      if (!saved) status.textContent += '本次选择仅在当前页面生效。';
    } catch (error) {
      status.textContent = error.message || '无法读取外观文件。';
    } finally {
      select.value = '';
      select.disabled = false;
      reset.disabled = !currentUrls;
    }
  }
  select.addEventListener('change',()=>{ if (select.files[0]) void change(select.files[0]); });
  reset.addEventListener('click',()=>{ void change(null); });
  box.append(title,note,select,reset,status);
  return box;
}
