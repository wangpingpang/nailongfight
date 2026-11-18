import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, extname, sep} from 'node:path';

const root = fileURLToPath(new URL('../src/game/', import.meta.url));
const port = Number(process.env.PORT || 4173);
const mime = {'.html':'text/html', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.ico':'image/x-icon', '.mp3':'audio/mpeg'};

http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, {Allow:'GET, HEAD'}).end();
      return;
    }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    const type = mime[extname(path)];
    if (!path.startsWith(resolve(root) + sep) || !type) throw new Error('missing');
    const body = await readFile(path);
    res.writeHead(200, {'Content-Type': type + (type.startsWith('text/') || type === 'application/json' ? '; charset=utf-8' : ''), 'Cache-Control':'no-store'});
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log('回声练习场  http://127.0.0.1:' + port));
