// 最小のサービスワーカー: ホーム画面への追加（インストール）を成立させるためのもの。
// API とページはキャッシュしない（常に最新を取りに行く）。画像だけ軽くキャッシュする。
const CACHE = 'ssm-static-v2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (!url.pathname.startsWith('/assets/')) return; // index.html は常にネットワーク
  e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(e.request)) ?? fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })));
});
