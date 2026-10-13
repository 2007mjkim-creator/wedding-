const CACHE_NAME = 'marryst-cache-v1';

// 오프라인 사전 캐싱 자산 목록
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png'
];

// 1. Install 이벤트: 정적 자원 사전 캐싱 및 즉시 대기열 통과
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        console.log('[Service Worker] 캐시 저장소 오픈 및 정적 자산 프리캐싱 시작');
        for (const asset of PRECACHE_ASSETS) {
          try {
            await cache.add(asset);
          } catch (err) {
            console.warn('[Service Worker] 사전 캐싱 건너뜀:', asset, err);
          }
        }
      })
      .then(() => self.skipWaiting())
      .catch((error) => {
        console.error('[Service Worker] 설치 중 캐싱 실패:', error);
      })
  );
});

// 2. Activate 이벤트: 구버전 캐시 정리 및 즉시 클라이언트 제어
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] 이전 캐시 삭제:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[Service Worker] 클라이언트 제어 권한 획득');
      return self.clients.claim();
    })
  );
});

// 3. Fetch 이벤트: 정적 자산 오프라인 캐싱 및 폴백 전략
self.addEventListener('fetch', (event) => {
  // GET 요청 및 http/https 프로토콜만 캐싱
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;

  const request = event.request;

  // HTML 탐색(Navigation) 요청: 네트워크 우선 -> 실패 시 오프라인 캐시 반환
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        })
        .catch(async () => {
          console.log('[Service Worker] 오프라인 탐색 요청 감지, 캐시된 index.html 제공');
          const cache = await caches.open(CACHE_NAME);
          const cachedResponse = await cache.match('./index.html') || await cache.match('/');
          return cachedResponse || new Response('<h1>오프라인 상태입니다. 네트워크 연결을 확인해주세요.</h1>', {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        })
    );
    return;
  }

  // 정적 자산(CSS, JS, 이미지, 폰트 등): 캐시 우선 -> 네트워크 폴백 및 동적 캐싱
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request).then((networkResponse) => {
        // 유효한 응답이거나 CORS Opaque 응답인 경우 캐시에 보관
        if (!networkResponse || (networkResponse.status !== 200 && networkResponse.type !== 'opaque')) {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseToCache);
        });

        return networkResponse;
      }).catch((fetchError) => {
        console.warn('[Service Worker] 자원 로드 실패(오프라인):', request.url, fetchError);
        // 이미지 요청 실패 시 캐시된 기본 아이콘 또는 빈 응답
        if (request.destination === 'image') {
          return caches.match('/icons/icon-192x192.png');
        }
        return Promise.reject(fetchError);
      });
    })
  );
});
