/// <reference lib="webworker" />
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope;

// Control the page on first install too, so later updates wait for a safe point.
clientsClaim();
cleanupOutdatedCaches();
// App shell, models and voice lines are all precached: the local game modes work offline.
precacheAndRoute(self.__WB_MANIFEST);

// Offline SPA shell; never intercept matchmaking or the version check.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/matchmake\//, /^\/version\.json$/],
  }),
);

// The page decides when it's safe to switch versions (see src/pwa/updater.ts).
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting();
});
