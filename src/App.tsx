import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Database, ShieldAlert, ShoppingBag } from 'lucide-react';
import { resolvePreferredImageUrl } from './components/CulinaryImage';
import { Footer } from './components/Footer';
import { HeroSection } from './components/HeroSection';
import { LocationSection } from './components/LocationSection';
import { MenuCatalog } from './components/MenuCatalog';
import { Navbar } from './components/Navbar';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PopularSection } from './components/PopularSection';
import { SpecialtiesSection } from './components/SpecialtiesSection';
import { ToastContainer } from './components/ToastContainer';
import { CartProvider, useCart } from './context/CartContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { ToastProvider, useToast } from './context/ToastContext';
import {
  INITIAL_CATEGORIES,
  INITIAL_MENU_ITEMS,
  INITIAL_RESTAURANTS,
} from './data/seedData';
import {
  getLastConsultedRestaurant,
  scheduleRestaurantMediaCaching,
} from './services/offlineMediaCache';
import {
  clearOutbox,
  enqueueOutboxMutation,
  getLastSyncedAt,
  loadCachedSnapshotSync,
  loadOutbox,
  loadPlatformState,
  PlatformState,
  replaceOutbox,
  savePlatformState,
  setLastSyncedAt,
  SyncEntityType,
  SyncOperation,
} from './services/offlineStore';
import {
  assertAuthorized,
  canCreateRestaurant,
  canDeleteRestaurant,
  canEditRestaurant,
  canManageAccounts,
  canManageCategory,
  canManageMenuForRestaurant,
  canPushServerSync,
  canToggleRestaurantStatus,
  PermissionError,
} from './services/permissions';
import {
  buildNonConflictingServerMerge,
  canActorReplayMutation,
  changeOwnLocalPassword,
  createLocalServerOwner,
  fetchLocalServerInfo,
  getLocalAuthToken,
  listLocalServerUsers,
  reassignLocalServerOwner,
  resetLocalServerUserPassword,
  restoreLocalServerSession,
  SyncConflictDetail,
  syncPendingOutboxWithSupabase,
  SyncStatus,
  syncWithServer,
  toggleLocalServerUserActive,
  updateLocalServerUser,
  updateOwnLocalCredentials,
} from './services/syncService';
import { AppView, Category, MenuItem, PlatformUser, Restaurant } from './types/menu';

function isSupabaseEnvConfigured(): boolean {
  const rawUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();
  return Boolean(rawUrl && rawKey && rawUrl.startsWith('http') && rawKey.length > 20);
}

let supabaseDataModulePromise: Promise<typeof import('./services/supabaseData')> | null = null;
function loadSupabaseData() {
  if (!supabaseDataModulePromise) {
    supabaseDataModulePromise = import('./services/supabaseData');
  }
  return supabaseDataModulePromise;
}

// Lazy-load secondary drawers and the Pro workspace so customer QR scans load minimally on slow networks
const ProWorkspace = lazy(() =>
  import('./components/ProWorkspace').then((m) => ({ default: m.ProWorkspace }))
);
const CartDrawer = lazy(() =>
  import('./components/CartDrawer').then((m) => ({ default: m.CartDrawer }))
);
const DishDetailModal = lazy(() =>
  import('./components/DishDetailModal').then((m) => ({ default: m.DishDetailModal }))
);
const QRCodeModal = lazy(() =>
  import('./components/QRCodeModal').then((m) => ({ default: m.QRCodeModal }))
);

const ACTIVE_VIEW_KEY = 'smartmenu_qr_active_view_v1';
const OPEN_QR_STATE_KEY = 'smartmenu_qr_open_qr_v1';

function readStoredActiveView(): AppView {
  if (typeof window === 'undefined') return 'customer';
  try {
    if (window.location.hash.includes('type=recovery')) {
      return 'pro';
    }
    const raw = window.localStorage.getItem(ACTIVE_VIEW_KEY);
    return raw === 'pro' ? 'pro' : 'customer';
  } catch {
    return 'customer';
  }
}

function readStoredOpenQr(): Restaurant | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(OPEN_QR_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Restaurant | null;
    return parsed && parsed.id && parsed.slug ? parsed : null;
  } catch {
    return null;
  }
}

function getInitialRestaurantSlug(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('restaurant');
}

function SmartMenuShell() {
  const { language, t, formatFC } = useLanguage();
  const { getCart } = useCart();
  const { showToast } = useToast();

  const supabaseEnabled = isSupabaseEnvConfigured();
  const initialCachedSnapshot = useRef<PlatformState | null>(
    loadCachedSnapshotSync(false)
  ).current;

  const [restaurants, setRestaurants] = useState<Restaurant[]>(
    supabaseEnabled ? initialCachedSnapshot?.restaurants ?? [] : INITIAL_RESTAURANTS
  );
  const [categories, setCategories] = useState<Category[]>(
    supabaseEnabled ? initialCachedSnapshot?.categories ?? [] : INITIAL_CATEGORIES
  );
  const [menuItems, setMenuItems] = useState<MenuItem[]>(
    supabaseEnabled ? initialCachedSnapshot?.menuItems ?? [] : INITIAL_MENU_ITEMS
  );
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string>(
    initialCachedSnapshot?.updatedAt ?? new Date().toISOString()
  );
  const [baseUpdatedAt, setBaseUpdatedAt] = useState<string>(
    initialCachedSnapshot?.baseUpdatedAt ??
      initialCachedSnapshot?.updatedAt ??
      new Date().toISOString()
  );
  const [isCloudBootstrapping, setIsCloudBootstrapping] = useState<boolean>(
    supabaseEnabled && !(initialCachedSnapshot && initialCachedSnapshot.restaurants.length > 0)
  );

  const [activeRestaurantId, setActiveRestaurantId] = useState<string>(() => {
    const urlSlug = getInitialRestaurantSlug();
    if (urlSlug && initialCachedSnapshot) {
      const matched = initialCachedSnapshot.restaurants.find((r) => r.slug === urlSlug);
      if (matched) return matched.id;
    }
    const lastConsulted = getLastConsultedRestaurant();
    if (lastConsulted && initialCachedSnapshot) {
      const matched = initialCachedSnapshot.restaurants.find((r) => r.slug === lastConsulted.slug);
      if (matched) return matched.id;
    }
    return initialCachedSnapshot?.restaurants[0]?.id ?? 'rocomamas-lubumbashi';
  });
  const [activeView, setActiveView] = useState<AppView>(() => readStoredActiveView());
  const [passwordRecoveryPending, setPasswordRecoveryPending] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.location.hash.includes('type=recovery') : false
  );
  const [selectedDish, setSelectedDish] = useState<MenuItem | null>(null);
  const [openQrSnapshot, setOpenQrSnapshot] = useState<Restaurant | null>(() => readStoredOpenQr());
  const [cartOpen, setCartOpen] = useState(false);

  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'online'
  );
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [localServerActive, setLocalServerActive] = useState<boolean>(false);
  const [localAuthRequired, setLocalAuthRequired] = useState<boolean>(false);
  const [currentProUser, setCurrentProUser] = useState<PlatformUser | null>(null);
  const [lastSyncedAt, setLastSyncedAtState] = useState<string | null>(() => getLastSyncedAt());
  const [conflictServerState, setConflictServerState] = useState<PlatformState | null>(null);
  const [conflictDetails, setConflictDetails] = useState<SyncConflictDetail[]>([]);
  const [autoRetryAt, setAutoRetryAt] = useState<string | null>(null);
  const [retryStoppedPermanent, setRetryStoppedPermanent] = useState<boolean>(false);
  const lastCloudSyncRef = useRef<number>(0);
  const lastForegroundProbeRef = useRef<number>(0);
  const inFlightCloudSyncRef = useRef<Promise<void> | null>(null);
  const queuedCloudResyncRef = useRef<{
    force: boolean;
    forceOverwrite: boolean;
    respectBackoff: boolean;
  } | null>(null);
  const inFlightLocalSyncRef = useRef<Promise<void> | null>(null);

  const activeViewRef = useRef(activeView);
  activeViewRef.current = activeView;
  const activeRestaurantIdRef = useRef(activeRestaurantId);
  activeRestaurantIdRef.current = activeRestaurantId;
  const restaurantsRef = useRef(restaurants);
  restaurantsRef.current = restaurants;
  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;
  const menuItemsRef = useRef(menuItems);
  menuItemsRef.current = menuItems;
  const usersRef = useRef(users);
  usersRef.current = users;
  const localServerActiveRef = useRef(localServerActive);
  localServerActiveRef.current = localServerActive;
  const currentProUserRef = useRef<PlatformUser | null>(currentProUser);
  currentProUserRef.current = currentProUser;
  const baseUpdatedAtRef = useRef(baseUpdatedAt);
  baseUpdatedAtRef.current = baseUpdatedAt;
  const syncStatusRef = useRef(syncStatus);
  syncStatusRef.current = syncStatus;
  const pendingCountRef = useRef(pendingCount);
  pendingCountRef.current = pendingCount;

  const applyAndCacheCloudState = useCallback(
    async (
      nextRestaurants: Restaurant[],
      nextCategories: Category[],
      nextItems: MenuItem[],
      nextUsers?: PlatformUser[],
      allowEmptyReplacement = false
    ) => {
      // Never delete previously cached valid menu data before a valid replacement arrives
      if (!allowEmptyReplacement && nextRestaurants.length === 0 && restaurantsRef.current.length > 0) {
        return;
      }

      const now = new Date().toISOString();
      setRestaurants(nextRestaurants);
      setCategories(nextCategories);
      setMenuItems(nextItems);
      if (nextUsers) {
        setUsers(nextUsers);
      }
      setUpdatedAt(now);
      setBaseUpdatedAt(now);
      baseUpdatedAtRef.current = now;
      setLastSyncedAt(now);
      setLastSyncedAtState(now);

      const urlSlug = getInitialRestaurantSlug();
      if (urlSlug) {
        const matched = nextRestaurants.find((r) => r.slug === urlSlug);
        if (matched) {
          setActiveRestaurantId(matched.id);
        }
      } else if (
        nextRestaurants.length > 0 &&
        !nextRestaurants.some((r) => r.id === activeRestaurantIdRef.current)
      ) {
        setActiveRestaurantId(nextRestaurants[0].id);
      }

      const saved = await savePlatformState({
        restaurants: nextRestaurants,
        categories: nextCategories,
        menuItems: nextItems,
        users: [],
        updatedAt: now,
        baseUpdatedAt: now,
      });

      // Mirror fresh cloud snapshot onto local PC LAN server only for authenticated Pro sessions
      if (
        localServerActiveRef.current &&
        nextRestaurants.length > 0 &&
        activeViewRef.current === 'pro' &&
        canPushServerSync(currentProUserRef.current) &&
        Boolean(getLocalAuthToken())
      ) {
        void syncWithServer(saved, true, {
          lastCloudSyncAt: now,
          pushOnlyToLocal: true,
          actor: currentProUserRef.current,
        });
      }
    },
    []
  );

  const refreshFromSupabase = useCallback(
    async (
      force = false,
      forceOverwriteConflicts = false,
      respectBackoff = false
    ): Promise<void> => {
      if (!isSupabaseEnvConfigured()) return;

      if (inFlightCloudSyncRef.current) {
        const prev = queuedCloudResyncRef.current;
        queuedCloudResyncRef.current = {
          force: Boolean(prev?.force || force),
          forceOverwrite: Boolean(prev?.forceOverwrite || forceOverwriteConflicts),
          respectBackoff: prev ? prev.respectBackoff && respectBackoff : respectBackoff,
        };
        return inFlightCloudSyncRef.current;
      }

      const executeRefresh = async () => {
        const outbox = await loadOutbox();
        setPendingCount(outbox.length);

        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          setSyncStatus('offline');
          // Even without Internet WAN, check if a local PC Wi-Fi server can serve catalog updates
          const localProbe = await syncWithServer(
            {
              restaurants: restaurantsRef.current,
              categories: categoriesRef.current,
              menuItems: menuItemsRef.current,
              users: usersRef.current,
              updatedAt: new Date().toISOString(),
              baseUpdatedAt: baseUpdatedAtRef.current,
            },
            false,
            { pullOnly: true }
          );
          if (localProbe.localServerActive) {
            setLocalServerActive(true);
            localServerActiveRef.current = true;
            if (
              localProbe.mergedState &&
              localProbe.mergedState.restaurants.length > 0 &&
              outbox.length === 0
            ) {
              await applyAndCacheCloudState(
                localProbe.mergedState.restaurants,
                localProbe.mergedState.categories,
                localProbe.mergedState.menuItems,
                localProbe.mergedState.users
              );
            }
          }
          setIsCloudBootstrapping(false);
          return;
        }

        if (
          !force &&
          outbox.length === 0 &&
          lastCloudSyncRef.current > 0 &&
          Date.now() - lastCloudSyncRef.current < 15_000
        ) {
          return;
        }

        setSyncStatus('syncing');
        try {
          const sb = await loadSupabaseData();

          // Restore renewable session automatically before replaying queued offline mutations
          if (outbox.length > 0 && !currentProUserRef.current) {
            const restored = await sb.restoreSupabaseSession().catch(() => null);
            if (restored) {
              currentProUserRef.current = restored;
              setCurrentProUser(restored);
            }
          }

          // Replay queued offline mutations before pulling fresh cloud data so edits are never lost
          if (outbox.length > 0) {
            const replayResult = await syncPendingOutboxWithSupabase(
              {
                restaurants: restaurantsRef.current,
                categories: categoriesRef.current,
                menuItems: menuItemsRef.current,
                users: [],
                updatedAt: new Date().toISOString(),
                baseUpdatedAt: baseUpdatedAtRef.current,
              },
              forceOverwriteConflicts,
              currentProUserRef.current,
              { respectBackoff }
            );
            setPendingCount(replayResult.pendingCount);

            if (replayResult.status === 'conflict' && replayResult.serverConflictState) {
              setConflictServerState(replayResult.serverConflictState);
              setConflictDetails(replayResult.conflicts ?? []);
              setSyncStatus('conflict');
              setAutoRetryAt(null);
              setIsCloudBootstrapping(false);
              return;
            }

            if (replayResult.status === 'error') {
              setConflictDetails([]);
              setSyncStatus('error');
              if (replayResult.retryable === false) {
                setRetryStoppedPermanent(true);
                setAutoRetryAt(null);
              } else {
                setRetryStoppedPermanent(false);
                setAutoRetryAt(
                  replayResult.nextRetryAt ?? new Date(Date.now() + 10_000).toISOString()
                );
              }
              setIsCloudBootstrapping(false);
              return;
            }

            if (replayResult.mergedState) {
              setConflictDetails([]);
              await applyAndCacheCloudState(
                replayResult.mergedState.restaurants,
                replayResult.mergedState.categories,
                replayResult.mergedState.menuItems,
                replayResult.mergedState.users
              );
              lastCloudSyncRef.current = Date.now();
              setSyncStatus('online');
              setAutoRetryAt(null);
              setRetryStoppedPermanent(false);
              setPendingCount(replayResult.pendingCount);
              setIsCloudBootstrapping(false);
              return;
            }
          }

          const urlSlug = getInitialRestaurantSlug();

          // On QR-code customer scans (?restaurant=<slug>), fetch only the target venue's menu first
          if (activeViewRef.current === 'customer' && urlSlug) {
            const scoped = await sb.fetchSupabaseRestaurantCatalogBySlug(urlSlug);
            if (scoped && scoped.restaurants.length > 0) {
              const targetRest = scoped.restaurants[0];
              const mergedRestaurants = restaurantsRef.current.some((r) => r.id === targetRest.id)
                ? restaurantsRef.current.map((r) => (r.id === targetRest.id ? targetRest : r))
                : [targetRest, ...restaurantsRef.current];
              const otherCategories = categoriesRef.current.filter(
                (c) => c.restaurantId && c.restaurantId !== targetRest.id
              );
              const mergedCategories = [...scoped.categories, ...otherCategories];
              const otherItems = menuItemsRef.current.filter(
                (m) => m.restaurantId !== targetRest.id
              );
              const mergedItems = [...scoped.menuItems, ...otherItems];

              await applyAndCacheCloudState(mergedRestaurants, mergedCategories, mergedItems);
              lastCloudSyncRef.current = Date.now();
              setSyncStatus('online');
              setAutoRetryAt(null);
              setRetryStoppedPermanent(false);
              const latestOutbox = await loadOutbox();
              setPendingCount(latestOutbox.length);
              return;
            }
          }

          const cloud = await sb.fetchSupabaseCatalog(force);
          await applyAndCacheCloudState(
            cloud.restaurants,
            cloud.categories,
            cloud.menuItems,
            cloud.users
          );
          lastCloudSyncRef.current = Date.now();
          setSyncStatus('online');
          setAutoRetryAt(null);
          setRetryStoppedPermanent(false);
          const latestOutbox = await loadOutbox();
          setPendingCount(latestOutbox.length);
        } catch {
          // Hybrid fallback: on Wi-Fi LAN without WAN Internet, navigator.onLine may still be true
          const localProbe = await syncWithServer(
            {
              restaurants: restaurantsRef.current,
              categories: categoriesRef.current,
              menuItems: menuItemsRef.current,
              users: usersRef.current,
              updatedAt: new Date().toISOString(),
              baseUpdatedAt: baseUpdatedAtRef.current,
            },
            false,
            { pullOnly: true }
          ).catch(() => null);

          if (localProbe?.localServerActive) {
            setLocalServerActive(true);
            localServerActiveRef.current = true;
            if (
              localProbe.mergedState &&
              localProbe.mergedState.restaurants.length > 0 &&
              outbox.length === 0
            ) {
              await applyAndCacheCloudState(
                localProbe.mergedState.restaurants,
                localProbe.mergedState.categories,
                localProbe.mergedState.menuItems,
                localProbe.mergedState.users
              );
            }
            setSyncStatus('offline');
            if (pendingCountRef.current > 0) {
              setRetryStoppedPermanent(false);
              setAutoRetryAt(new Date(Date.now() + 15_000).toISOString());
            }
          } else {
            const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
            setSyncStatus(isOffline ? 'offline' : 'error');
            if (!isOffline && pendingCountRef.current > 0) {
              setRetryStoppedPermanent(false);
              setAutoRetryAt(new Date(Date.now() + 10_000).toISOString());
            }
          }
        } finally {
          setIsCloudBootstrapping(false);
        }
      };

      const runPromise = executeRefresh().finally(() => {
        inFlightCloudSyncRef.current = null;
        const queued = queuedCloudResyncRef.current;
        queuedCloudResyncRef.current = null;
        if (queued) {
          void refreshFromSupabase(queued.force, queued.forceOverwrite, queued.respectBackoff);
        }
      });

      inFlightCloudSyncRef.current = runPromise;
      return runPromise;
    },
    [applyAndCacheCloudState]
  );

  const runSync = useCallback(
    async (stateSnapshot: PlatformState, forceOverwrite = false, respectBackoff = false) => {
      if (isSupabaseEnvConfigured()) {
        await refreshFromSupabase(true, forceOverwrite, respectBackoff);
        return;
      }

      if (inFlightLocalSyncRef.current) {
        return inFlightLocalSyncRef.current;
      }

      const executeLocalSync = async () => {
        const allowPush =
          activeViewRef.current === 'pro' && canPushServerSync(currentProUserRef.current);

        setSyncStatus('syncing');
        const result = await syncWithServer(stateSnapshot, forceOverwrite && allowPush, {
          pullOnly: !allowPush,
          actor: currentProUserRef.current,
        });
        if (result.localServerActive !== undefined) {
          setLocalServerActive(result.localServerActive);
        }
        if (result.localAuthRequired) {
          setLocalAuthRequired(true);
        } else if (result.status === 'online') {
          setLocalAuthRequired(false);
        }
        setPendingCount(result.pendingCount);
        setSyncStatus(result.status);
        if (result.status === 'online') {
          setAutoRetryAt(null);
          setRetryStoppedPermanent(false);
        } else if (result.status === 'error' && result.pendingCount > 0) {
          setRetryStoppedPermanent(Boolean(result.localAuthRequired));
          setAutoRetryAt(
            result.localAuthRequired ? null : new Date(Date.now() + 10_000).toISOString()
          );
        }
        if (result.lastSyncedAt) {
          setLastSyncedAtState(result.lastSyncedAt);
        }

        if (result.status === 'conflict' && result.serverConflictState) {
          setConflictServerState(result.serverConflictState);
          setAutoRetryAt(null);
        } else if (result.mergedState) {
          setRestaurants(result.mergedState.restaurants);
          setCategories(result.mergedState.categories);
          setMenuItems(result.mergedState.menuItems);
          setUpdatedAt(result.mergedState.updatedAt);
          setBaseUpdatedAt(result.mergedState.baseUpdatedAt || result.mergedState.updatedAt);
        }
      };

      const localPromise = executeLocalSync().finally(() => {
        inFlightLocalSyncRef.current = null;
      });
      inFlightLocalSyncRef.current = localPromise;
      return localPromise;
    },
    [refreshFromSupabase]
  );

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const [outbox, serverInfo] = await Promise.all([
        loadOutbox().catch(() => []),
        fetchLocalServerInfo().catch(() => ({ active: false })),
      ]);
      if (!mounted) return;
      setPendingCount(outbox.length);
      setLocalServerActive(serverInfo.active);
      localServerActiveRef.current = serverInfo.active;

      if (isSupabaseEnvConfigured()) {
        // Hydrate from IndexedDB if localStorage snapshot wasn't available, then restore session + refresh Supabase
        if (!initialCachedSnapshot || initialCachedSnapshot.restaurants.length === 0) {
          const cached = await loadPlatformState(false).catch(() => null);
          if (mounted && cached && cached.restaurants.length > 0) {
            setRestaurants(cached.restaurants);
            setCategories(cached.categories);
            setMenuItems(cached.menuItems);
            setUpdatedAt(cached.updatedAt);
            setBaseUpdatedAt(cached.baseUpdatedAt || cached.updatedAt);
            const urlSlug = getInitialRestaurantSlug();
            if (urlSlug) {
              const matched = cached.restaurants.find((r) => r.slug === urlSlug);
              if (matched) setActiveRestaurantId(matched.id);
            }
            setIsCloudBootstrapping(false);
          }
        }
        try {
          const sb = await loadSupabaseData();
          const restoredUser = await sb.restoreSupabaseSession();
          if (mounted && restoredUser) {
            currentProUserRef.current = restoredUser;
            setCurrentProUser(restoredUser);
          }
          if (serverInfo.active) {
            await restoreLocalServerSession().catch(() => null);
          }
        } catch {
          // Offline or no session; outbox stays safely in IndexedDB
        }
        await refreshFromSupabase(true);
        return;
      }

      const state = await loadPlatformState(true);
      if (!mounted) return;
      setRestaurants(state.restaurants);
      setCategories(state.categories);
      setMenuItems(state.menuItems);
      setUpdatedAt(state.updatedAt);
      setBaseUpdatedAt(state.baseUpdatedAt || state.updatedAt);

      const urlSlug = getInitialRestaurantSlug();
      if (urlSlug) {
        const matched = state.restaurants.find((r) => r.slug === urlSlug);
        if (matched) {
          setActiveRestaurantId(matched.id);
        }
      }

      if (serverInfo.active) {
        const restoredLocal = await restoreLocalServerSession().catch(() => ({ ok: false as const }));
        if (mounted && restoredLocal.ok && restoredLocal.user) {
          currentProUserRef.current = restoredLocal.user;
          setCurrentProUser(restoredLocal.user);
        }
      }

      runSync(state);
    };

    init();

    let recoverySub: { unsubscribe: () => void } | null = null;
    if (isSupabaseEnvConfigured()) {
      import('./services/supabaseClient').then(({ getSupabaseClient }) => {
        if (!mounted) return;
        const sb = getSupabaseClient();
        if (!sb) return;
        const { data } = sb.auth.onAuthStateChange((event) => {
          if (event === 'PASSWORD_RECOVERY') {
            setPasswordRecoveryPending(true);
            setActiveView('pro');
          }
        });
        recoverySub = data.subscription;
      });
    }

    const handleOnline = async () => {
      setRetryStoppedPermanent(false);
      setAutoRetryAt(null);
      if (isSupabaseEnvConfigured()) {
        if (!currentProUserRef.current) {
          try {
            const sb = await loadSupabaseData();
            const restored = await sb.restoreSupabaseSession();
            if (restored) {
              currentProUserRef.current = restored;
              setCurrentProUser(restored);
            }
          } catch {
            // Ignore transient error
          }
        }
        await refreshFromSupabase(true, false, false);
      } else {
        if (!currentProUserRef.current && localServerActiveRef.current) {
          const restored = await restoreLocalServerSession().catch(() => ({ ok: false as const }));
          if (restored.ok && restored.user) {
            currentProUserRef.current = restored.user;
            setCurrentProUser(restored.user);
          }
        }
        const latest = await loadPlatformState(true);
        await runSync(latest, false, false);
      }
    };
    const handleOffline = () => {
      setSyncStatus('offline');
      setAutoRetryAt(null);
    };

    const handleForegroundResume = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (syncStatusRef.current === 'conflict' || syncStatusRef.current === 'syncing') return;

      const hasPendingOrError =
        pendingCountRef.current > 0 || syncStatusRef.current === 'error';
      const canReachNetwork =
        typeof navigator === 'undefined' || navigator.onLine || localServerActiveRef.current;
      if (!canReachNetwork) return;

      const now = Date.now();
      const throttleMs = hasPendingOrError ? 5_000 : 15_000;
      if (now - lastForegroundProbeRef.current < throttleMs) return;
      lastForegroundProbeRef.current = now;
      void handleOnline();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', handleForegroundResume);
    document.addEventListener('visibilitychange', handleForegroundResume);

    // Gentle multi-device background refresh (45s) while visible and idle
    const periodicSyncTimer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (syncStatusRef.current === 'conflict' || syncStatusRef.current === 'syncing') return;
      if (pendingCountRef.current > 0) return;

      if (isSupabaseEnvConfigured()) {
        if (typeof navigator !== 'undefined' && !navigator.onLine && !localServerActiveRef.current) {
          return;
        }
        void refreshFromSupabase(true, false, true);
      } else if (localServerActiveRef.current) {
        void loadPlatformState(true).then((latest) => runSync(latest, false, false));
      }
    }, 45_000);

    return () => {
      mounted = false;
      recoverySub?.unsubscribe();
      window.clearInterval(periodicSyncTimer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleForegroundResume);
      document.removeEventListener('visibilitychange', handleForegroundResume);
    };
  }, [initialCachedSnapshot, refreshFromSupabase, runSync]);

  // Automatic exponential-backoff retry scheduler when pending mutations or transient errors exist
  useEffect(() => {
    if (syncStatus === 'conflict' || syncStatus === 'syncing' || retryStoppedPermanent) {
      return;
    }
    if (pendingCount === 0 && syncStatus !== 'error') {
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return;
    }

    const targetMs = autoRetryAt ? Date.parse(autoRetryAt) : Date.now() + 8_000;
    const rawDelay = Number.isFinite(targetMs) ? targetMs - Date.now() : 8_000;
    const jitterMs = Math.floor(Math.random() * 1_000);
    const delayMs = Math.min(300_000, Math.max(3_000, rawDelay)) + jitterMs;

    const timer = window.setTimeout(async () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      if (isSupabaseEnvConfigured()) {
        await refreshFromSupabase(true, false, true);
      } else {
        const latest = await loadPlatformState(true);
        await runSync(latest, false, true);
      }
    }, delayMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [autoRetryAt, pendingCount, refreshFromSupabase, retryStoppedPermanent, runSync, syncStatus]);

  useEffect(() => {
    if (supabaseEnabled || !localServerActive || currentProUser?.role !== 'super_admin') {
      return;
    }
    let mounted = true;
    listLocalServerUsers().then((list) => {
      if (mounted) {
        setUsers(list);
      }
    });
    return () => {
      mounted = false;
    };
  }, [supabaseEnabled, localServerActive, currentProUser?.id, currentProUser?.role]);

  const activeRestaurant =
    restaurants.find((r) => r.id === activeRestaurantId) ?? restaurants[0] ?? null;

  const qrRestaurant = openQrSnapshot
    ? restaurants.find((r) => r.id === openQrSnapshot.id) ?? openQrSnapshot
    : null;

  const handleOpenQr = useCallback((restaurant: Restaurant) => {
    setOpenQrSnapshot(restaurant);
    try {
      window.localStorage.setItem(OPEN_QR_STATE_KEY, JSON.stringify(restaurant));
    } catch {
      // Ignore storage errors
    }
  }, []);

  const handleCloseQr = useCallback(() => {
    setOpenQrSnapshot(null);
    try {
      window.localStorage.removeItem(OPEN_QR_STATE_KEY);
    } catch {
      // Ignore storage errors
    }
  }, []);

  const restaurantDishes = activeRestaurant
    ? menuItems.filter((item) => item.restaurantId === activeRestaurant.id)
    : [];

  const restaurantCategories = activeRestaurant
    ? categories.filter((c) => !c.restaurantId || c.restaurantId === activeRestaurant.id)
    : [];

  const currentCart = activeRestaurant ? getCart(activeRestaurant.id) : { items: [], orderNotes: '' };
  const cartCount = currentCart.items.reduce((sum, c) => sum + c.quantity, 0);
  const cartTotalFC = currentCart.items.reduce(
    (sum, c) => sum + c.item.priceFC * c.quantity,
    0
  );

  useEffect(() => {
    if (!activeRestaurant) {
      document.title = 'SMARTMENU QR';
      return;
    }
    document.title =
      language === 'fr'
        ? `SMARTMENU QR — ${activeRestaurant.name}`
        : `SMARTMENU QR — ${activeRestaurant.name} (Menu)`;

    if (activeRestaurant.heroImage && typeof document !== 'undefined') {
      const heroUrl = resolvePreferredImageUrl(activeRestaurant.heroImage, 'hero');
      if (heroUrl) {
        let link = document.head.querySelector<HTMLLinkElement>('link[data-hero-preload="true"]');
        if (!link) {
          link = document.createElement('link');
          link.rel = 'preload';
          link.as = 'image';
          link.setAttribute('data-hero-preload', 'true');
          document.head.appendChild(link);
        }
        if (link.getAttribute('href') !== heroUrl) {
          link.href = heroUrl;
        }
      }
    }

    // Download active restaurant's menu visuals in background for offline QR rescans
    scheduleRestaurantMediaCaching(activeRestaurant, restaurantDishes);
  }, [activeRestaurant, language, restaurantDishes]);

  const persistLocal = async (
    actionLabel: string,
    nextRestaurants: Restaurant[],
    nextCategories: Category[],
    nextItems: MenuItem[],
    nextUsers: PlatformUser[],
    skipOutbox = false,
    outboxDetails?: {
      entityType: SyncEntityType;
      entityId: string;
      operation: SyncOperation;
      isNew?: boolean;
      payload?: unknown;
    },
    entityBaseUpdatedAt?: string
  ) => {
    const now = new Date().toISOString();
    setRestaurants(nextRestaurants);
    setCategories(nextCategories);
    setMenuItems(nextItems);
    setUsers(nextUsers);
    setUpdatedAt(now);
    const nextBase = skipOutbox ? now : baseUpdatedAtRef.current;
    if (skipOutbox) {
      setBaseUpdatedAt(now);
      baseUpdatedAtRef.current = now;
      setLastSyncedAt(now);
      setLastSyncedAtState(now);
    }

    const saved = await savePlatformState({
      restaurants: nextRestaurants,
      categories: nextCategories,
      menuItems: nextItems,
      users: [],
      updatedAt: now,
      baseUpdatedAt: nextBase,
    });

    const pushLocalMirrorIfReady = async (lastCloudIso?: string) => {
      if (
        !localServerActiveRef.current ||
        activeViewRef.current !== 'pro' ||
        !canPushServerSync(currentProUserRef.current)
      ) {
        return;
      }
      if (!getLocalAuthToken()) {
        await restoreLocalServerSession().catch(() => null);
      }
      if (!getLocalAuthToken()) {
        if (!lastCloudIso) {
          setLocalAuthRequired(true);
        }
        return;
      }
      const localRes = await syncWithServer(saved, true, {
        ...(lastCloudIso ? { lastCloudSyncAt: lastCloudIso } : {}),
        pushOnlyToLocal: true,
        actor: currentProUserRef.current,
      });
      if (localRes.localAuthRequired) {
        setLocalAuthRequired(true);
      }
    };

    if (!skipOutbox) {
      const actor = currentProUserRef.current;
      const outbox = await enqueueOutboxMutation(
        actionLabel,
        entityBaseUpdatedAt || baseUpdatedAtRef.current,
        outboxDetails,
        actor
          ? {
              userId: actor.id,
              role: actor.role,
              restaurantId: actor.assignedRestaurantId ?? null,
            }
          : null
      );
      setPendingCount(outbox.length);
      if (isSupabaseEnvConfigured()) {
        await pushLocalMirrorIfReady();
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          setSyncStatus('offline');
          setAutoRetryAt(null);
        } else {
          setRetryStoppedPermanent(false);
          setAutoRetryAt(new Date(Date.now() + 8_000).toISOString());
        }
      } else {
        await runSync(saved);
      }
    } else if (isSupabaseEnvConfigured()) {
      await pushLocalMirrorIfReady(now);
    }
  };

  const handleResolveConflict = async (strategy: 'keep_local' | 'use_server') => {
    if (strategy === 'keep_local') {
      try {
        assertAuthorized(
          activeViewRef.current === 'pro' && canPushServerSync(currentProUserRef.current)
        );
      } catch (err) {
        if (err instanceof PermissionError) {
          showToast(t.toast.permissionDenied, 'error');
          return;
        }
        throw err;
      }

      const currentSnapshot: PlatformState = {
        restaurants,
        categories,
        menuItems,
        users,
        updatedAt,
        baseUpdatedAt,
      };
      setConflictServerState(null);
      setConflictDetails([]);
      setRetryStoppedPermanent(false);
      setAutoRetryAt(null);
      await runSync(currentSnapshot, true);
      showToast(t.sync.statusOnline);
    } else if (conflictServerState) {
      const existingOutbox = await loadOutbox();
      const conflictIds = new Set(conflictDetails.map((c) => c.mutationId));
      const remainingOutbox =
        conflictIds.size > 0
          ? existingOutbox.filter((m) => !conflictIds.has(m.id))
          : existingOutbox.filter(
              (m) => !canActorReplayMutation(currentProUserRef.current, m, conflictServerState)
            );
      const remainingAuthorized = remainingOutbox.filter((m) =>
        canActorReplayMutation(currentProUserRef.current, m, conflictServerState)
      );

      const mergedServerWithNonConflicting = buildNonConflictingServerMerge(
        conflictServerState,
        remainingAuthorized
      );

      const committed = await savePlatformState({
        ...mergedServerWithNonConflicting,
        users: [],
        baseUpdatedAt: conflictServerState.updatedAt,
      });

      if (remainingOutbox.length === 0) {
        await clearOutbox();
      } else {
        await replaceOutbox(remainingOutbox);
      }
      setRestaurants(committed.restaurants);
      setCategories(committed.categories);
      setMenuItems(committed.menuItems);
      setUsers(conflictServerState.users ?? []);
      setUpdatedAt(committed.updatedAt);
      setBaseUpdatedAt(committed.updatedAt);
      baseUpdatedAtRef.current = committed.updatedAt;
      setPendingCount(remainingOutbox.length);
      setConflictServerState(null);
      setConflictDetails([]);
      setRetryStoppedPermanent(false);
      setAutoRetryAt(null);

      if (remainingAuthorized.length > 0) {
        await runSync({
          ...committed,
          users: conflictServerState.users ?? [],
        });
      } else {
        setSyncStatus('online');
        showToast(t.sync.statusOnline);
      }
    }
  };

  const handleNavigateView = (view: AppView, sectionId?: string) => {
    activeViewRef.current = view;
    setActiveView(view);
    try {
      window.localStorage.setItem(ACTIVE_VIEW_KEY, view);
    } catch {
      // Ignore storage errors
    }
    if (view === 'customer' && sectionId) {
      window.setTimeout(() => {
        if (sectionId === 'top') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' });
        }
      }, 40);
    } else if (view === 'pro') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (isSupabaseEnvConfigured()) {
        refreshFromSupabase(true);
      }
    }
  };

  const handleSelectRestaurant = (restaurantId: string) => {
    setActiveRestaurantId(restaurantId);
    const found = restaurants.find((r) => r.id === restaurantId);
    if (found) {
      const url = new URL(window.location.href);
      url.searchParams.set('restaurant', found.slug);
      window.history.replaceState({}, '', url.toString());
    }
  };

  const handleAddRestaurant = async (payload: {
    name: string;
    city: string;
    phone: string;
    addressFr: string;
    addressEn: string;
    ownerName: string;
    ownerEmail?: string;
    ownerUsername: string;
    ownerPassword: string;
  }): Promise<boolean> => {
    try {
      assertAuthorized(canCreateRestaurant(currentProUserRef.current));
    } catch (err) {
      if (err instanceof PermissionError) {
        showToast(t.toast.permissionDenied, 'error');
        return false;
      }
      throw err;
    }

    const slug = `${payload.name}-${payload.city}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const restId = `${slug}-${Date.now().toString(36)}`;

    const newRest: Restaurant = {
      id: restId,
      slug: restId,
      name: payload.name,
      city: payload.city,
      country: { fr: 'RDC', en: 'DRC' },
      address: { fr: payload.addressFr, en: payload.addressEn },
      hours: {
        fr: 'Lun – Dim : 11h00 – 23h00',
        en: 'Mon – Sun: 11:00 AM – 11:00 PM',
      },
      phone: payload.phone,
      tagline: {
        fr: `Carte numérique QR propulsée par SMARTMENU QR à ${payload.city}.`,
        en: `QR digital menu powered by SMARTMENU QR in ${payload.city}.`,
      },
      description: {
        fr: `Établissement ${payload.name} géré sur la plateforme multi-restaurants SMARTMENU QR.`,
        en: `${payload.name} venue managed on the SMARTMENU QR multi-restaurant platform.`,
      },
      demoDisclaimer: {
        fr: 'Établissement géré sur SMARTMENU QR',
        en: 'Managed venue on SMARTMENU QR',
      },
      heroImage: '',
      logoUrl: '',
      primaryColor: '#DC2626',
      secondaryColor: '#F97316',
      isActive: true,
      ownerId: '',
      isDemo: false,
    };

    if (isSupabaseEnvConfigured()) {
      try {
        const sb = await loadSupabaseData();
        const createdRest = await sb.upsertRestaurantInSupabase(newRest, true);
        let ownerFailed = false;
        try {
          const createdOwner = await sb.createOwnerAccountInSupabase({
            name: payload.ownerName,
            email: payload.ownerEmail,
            username: payload.ownerUsername,
            password: payload.ownerPassword,
            restaurantId: createdRest.id,
          });
          await sb.upsertRestaurantInSupabase({ ...createdRest, ownerId: createdOwner.id }, false);
        } catch (err) {
          ownerFailed = true;
          showToast(err instanceof Error ? err.message : t.toast.supabaseError, 'error');
        }
        sb.invalidateSupabaseCatalogCache();
        await refreshFromSupabase(true);
        setActiveRestaurantId(createdRest.id);
        return !ownerFailed;
      } catch (err) {
        showToast(err instanceof Error ? err.message : t.toast.supabaseError, 'error');
        return false;
      }
    }

    if (localServerActiveRef.current) {
      const ownerRes = await createLocalServerOwner({
        username: payload.ownerUsername,
        email: payload.ownerEmail,
        name: payload.ownerName,
        password: payload.ownerPassword,
        restaurantId: restId,
      });
      if (!ownerRes.ok || !ownerRes.user) {
        showToast(ownerRes.error || t.toast.supabaseError, 'error');
        return false;
      }
      const nextRest: Restaurant = { ...newRest, ownerId: ownerRes.user.id };
      await persistLocal(
        'add_restaurant',
        [...restaurants, nextRest],
        categories,
        menuItems,
        [...users, ownerRes.user]
      );
      handleSelectRestaurant(restId);
      return true;
    }

    showToast(t.auth.noBackendBody, 'error');
    return false;
  };

  const handleUpdateRestaurant = async (updated: Restaurant) => {
    try {
      assertAuthorized(canEditRestaurant(currentProUserRef.current));
    } catch (err) {
      if (err instanceof PermissionError) {
        showToast(t.toast.permissionDenied, 'error');
        return;
      }
      throw err;
    }

    const existingRest = restaurants.find((r) => r.id === updated.id);
    const next = restaurants.map((r) => (r.id === updated.id ? updated : r));
    if (isSupabaseEnvConfigured()) {
      const hasLocalAsset = Boolean(updated.logoUrl?.startsWith('/local-uploads/'));
      if ((typeof navigator === 'undefined' || navigator.onLine) && !hasLocalAsset) {
        try {
          const sb = await loadSupabaseData();
          const saved = await sb.upsertRestaurantInSupabase(updated, false);
          sb.invalidateSupabaseCatalogCache();
          const syncedNext = restaurants.map((r) => (r.id === saved.id ? saved : r));
          await persistLocal('update_restaurant', syncedNext, categories, menuItems, users, true);
          return;
        } catch {
          // Fall back to local persistence + outbox queue so edits are never lost
        }
      }
      await persistLocal(
        'update_restaurant',
        next,
        categories,
        menuItems,
        users,
        false,
        {
          entityType: 'restaurant',
          entityId: updated.id,
          operation: 'upsert',
          isNew: false,
          payload: updated,
        },
        existingRest?.updatedAt ?? baseUpdatedAtRef.current
      );
      if (typeof navigator !== 'undefined' && navigator.onLine && hasLocalAsset) {
        await refreshFromSupabase(true);
      } else {
        showToast(t.toast.savedOfflinePending);
      }
      return;
    }

    await persistLocal('update_restaurant', next, categories, menuItems, users);
  };

  const handleToggleRestaurantStatus = async (restaurantId: string) => {
    try {
      assertAuthorized(canToggleRestaurantStatus(currentProUserRef.current));
    } catch (err) {
      if (err instanceof PermissionError) {
        showToast(t.toast.permissionDenied, 'error');
        return;
      }
      throw err;
    }

    const target = restaurants.find((r) => r.id === restaurantId);
    if (!target) return;
    const nextStatus = !target.isActive;
    const next = restaurants.map((r) =>
      r.id === restaurantId ? { ...r, isActive: nextStatus } : r
    );

    if (isSupabaseEnvConfigured()) {
      if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
          const sb = await loadSupabaseData();
          await sb.toggleRestaurantStatusInSupabase(restaurantId, nextStatus);
          sb.invalidateSupabaseCatalogCache();
          await persistLocal('toggle_restaurant_status', next, categories, menuItems, users, true);
          return;
        } catch {
          // Queue offline toggle below instead of discarding change
        }
      }
      await persistLocal(
        'toggle_restaurant_status',
        next,
        categories,
        menuItems,
        users,
        false,
        {
          entityType: 'restaurant',
          entityId: restaurantId,
          operation: 'toggle_status',
          payload: { isActive: nextStatus },
        },
        target.updatedAt ?? baseUpdatedAtRef.current
      );
      showToast(t.toast.savedOfflinePending);
      return;
    }

    await persistLocal('toggle_restaurant_status', next, categories, menuItems, users);
  };

  const handleDeleteRestaurant = async (restaurantId: string): Promise<boolean> => {
    try {
      assertAuthorized(canDeleteRestaurant(currentProUserRef.current));
    } catch (err) {
      if (err instanceof PermissionError) {
        showToast(t.toast.permissionDenied, 'error');
        return false;
      }
      throw err;
    }

    const nextRestaurants = restaurants.filter((r) => r.id !== restaurantId);
    const nextCategories = categories.filter((c) => c.restaurantId !== restaurantId);
    const nextItems = menuItems.filter((m) => m.restaurantId !== restaurantId);
    const nextUsers = users.map((u) =>
      u.assignedRestaurantId === restaurantId ? { ...u, assignedRestaurantId: null } : u
    );

    if (isSupabaseEnvConfigured()) {
      try {
        const sb = await loadSupabaseData();
        await sb.deleteRestaurantInSupabase(restaurantId);
        sb.invalidateSupabaseCatalogCache();
        await persistLocal(
          'delete_restaurant',
          nextRestaurants,
          nextCategories,
          nextItems,
          nextUsers,
          true
        );
        if (openQrSnapshot?.id === restaurantId) {
          handleCloseQr();
        }
        if (activeRestaurantId === restaurantId && nextRestaurants[0]) {
          setActiveRestaurantId(nextRestaurants[0].id);
        }
        return true;
      } catch {
        showToast(t.toast.supabaseError, 'error');
        return false;
      }
    }

    await persistLocal(
      'delete_restaurant',
      nextRestaurants,
      nextCategories,
      nextItems,
      nextUsers
    );
    if (openQrSnapshot?.id === restaurantId) {
      handleCloseQr();
    }
    if (activeRestaurantId === restaurantId && nextRestaurants[0]) {
      setActiveRestaurantId(nextRestaurants[0].id);
    }
    return true;
  };

  const handleCreateOwnerAccount = async (payload: {
    name: string;
    email?: string;
    username: string;
    password: string;
    restaurantId: string;
  }): Promise<boolean> => {
    try {
      assertAuthorized(canManageAccounts(currentProUserRef.current));
    } catch (err) {
      if (err instanceof PermissionError) {
        showToast(t.toast.permissionDenied, 'error');
        return false;
      }
      throw err;
    }

    if (isSupabaseEnvConfigured()) {
      try {
        const sb = await loadSupabaseData();
        const created = await sb.createOwnerAccountInSupabase(payload);
        sb.invalidateSupabaseCatalogCache();
        await persistLocal(
          'create_owner',
          restaurants,
          categories,
          menuItems,
          [...users, created],
          true
        );
        return true;
      } catch (err) {
        showToast(err instanceof Error ? err.message : t.toast.supabaseError, 'error');
        return false;
      }
    }

    if (localServerActiveRef.current) {
      const res = await createLocalServerOwner(payload);
      if (!res.ok || !res.user) {
        showToast(res.error || t.toast.supabaseError, 'error');
        return false;
      }
      setUsers((prev) => [...prev, res.user!]);
      return true;
    }

    showToast(t.auth.noBackendBody, 'error');
    return false;
  };

  const handleUpdateOwnerProfile = async (payload: {
    userId: string;
    username: string;
    name: string;
    email?: string;
    restaurantId: string | null;
  }): Promise<PlatformUser | null> => {
    try {
      assertAuthorized(canManageAccounts(currentProUserRef.current));
    } catch (err) {
      if (err instanceof PermissionError) {
        showToast(t.toast.permissionDenied, 'error');
        return null;
      }
      throw err;
    }

    if (isSupabaseEnvConfigured()) {
      try {
        const sb = await loadSupabaseData();
        const updated = await sb.updateOwnerProfileInSupabase(payload);
        sb.invalidateSupabaseCatalogCache();
        const nextUsers = users.map((u) => (u.id === updated.id ? updated : u));
        await persistLocal('update_owner_profile', restaurants, categories, menuItems, nextUsers, true);
        return updated;
      } catch (err) {
        showToast(err instanceof Error ? err.message : t.toast.supabaseError, 'error');
        return null;
      }
    }

    if (localServerActiveRef.current) {
      const res = await updateLocalServerUser(payload);
      if (!res.ok || !res.user) {
        showToast(res.error || t.toast.supabaseError, 'error');
        return null;
      }
      setUsers((prev) => prev.map((u) => (u.id === res.user!.id ? res.user! : u)));
      return res.user;
    }

    showToast(t.auth.noBackendBody, 'error');
    return null;
  };

  const handleToggleUserActive = async (userId: string) => {
    try {
      assertAuthorized(canManageAccounts(currentProUserRef.current));
    } catch (err) {
      if (err instanceof PermissionError) {
        showToast(t.toast.permissionDenied, 'error');
        return;
      }
      throw err;
    }

    const target = users.find((u) => u.id === userId);
    if (!target) return;
    const nextActive = !target.isActive;

    if (isSupabaseEnvConfigured()) {
      try {
        const sb = await loadSupabaseData();
        await sb.toggleUserProfileActiveInSupabase(userId, nextActive);
        sb.invalidateSupabaseCatalogCache();
        const next = users.map((u) =>
          u.id === userId ? { ...u, isActive: nextActive } : u
        );
        await persistLocal('toggle_user', restaurants, categories, menuItems, next, true);
      } catch {
        showToast(t.toast.supabaseError, 'error');
      }
      return;
    }

    if (localServerActiveRef.current) {
      const res = await toggleLocalServerUserActive(userId, nextActive);
      if (!res.ok) {
        showToast(res.error || t.toast.supabaseError, 'error');
        return;
      }
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, isActive: nextActive } : u)));
    }
  };

  const handleReassignOwner = async (
    userId: string,
    restaurantId: string | null
  ): Promise<boolean> => {
    try {
      assertAuthorized(canManageAccounts(currentProUserRef.current));
    } catch (err) {
      if (err instanceof PermissionError) {
        showToast(t.toast.permissionDenied, 'error');
        return false;
      }
      throw err;
    }

    const nextUsers = users.map((u) =>
      u.id === userId ? { ...u, assignedRestaurantId: restaurantId } : u
    );

    if (isSupabaseEnvConfigured()) {
      try {
        const sb = await loadSupabaseData();
        await sb.reassignOwnerRestaurantInSupabase(userId, restaurantId);
        sb.invalidateSupabaseCatalogCache();
        await persistLocal('reassign_owner', restaurants, categories, menuItems, nextUsers, true);
        return true;
      } catch {
        showToast(t.toast.supabaseError, 'error');
        return false;
      }
    }

    if (localServerActiveRef.current) {
      const res = await reassignLocalServerOwner(userId, restaurantId);
      if (!res.ok) {
        showToast(res.error || t.toast.supabaseError, 'error');
        return false;
      }
      setUsers(nextUsers);
      return true;
    }

    return false;
  };

  const handleResetUserPassword = async (
    userId: string,
    newPassword: string
  ): Promise<boolean> => {
    try {
      assertAuthorized(canManageAccounts(currentProUserRef.current));
    } catch (err) {
      if (err instanceof PermissionError) {
        showToast(t.toast.permissionDenied, 'error');
        return false;
      }
      throw err;
    }

    if (newPassword.length < 4) {
      showToast(t.auth.passwordTooShort, 'error');
      return false;
    }

    if (isSupabaseEnvConfigured()) {
      try {
        const sb = await loadSupabaseData();
        await sb.resetUserPasswordInSupabase(userId, newPassword);
        return true;
      } catch (err) {
        showToast(err instanceof Error ? err.message : t.toast.supabaseError, 'error');
        return false;
      }
    }

    if (localServerActiveRef.current) {
      const res = await resetLocalServerUserPassword(userId, newPassword);
      if (!res.ok) {
        showToast(res.error || t.toast.supabaseError, 'error');
        return false;
      }
      return true;
    }

    showToast(t.auth.noBackendBody, 'error');
    return false;
  };

  const handleUpdateOwnCredentials = async (payload: {
    username: string;
    email?: string;
    password?: string;
    name?: string;
  }): Promise<PlatformUser | null> => {
    try {
      assertAuthorized(canManageAccounts(currentProUserRef.current));
    } catch (err) {
      if (err instanceof PermissionError) {
        showToast(t.toast.permissionDenied, 'error');
        return null;
      }
      throw err;
    }

    if (isSupabaseEnvConfigured()) {
      try {
        const sb = await loadSupabaseData();
        const updated = await sb.updateOwnSupabaseCredentials(payload);
        sb.invalidateSupabaseCatalogCache();
        setCurrentProUser(updated);
        setUsers((prev) => {
          const exists = prev.some((u) => u.id === updated.id);
          return exists ? prev.map((u) => (u.id === updated.id ? updated : u)) : [updated, ...prev];
        });
        return updated;
      } catch (err) {
        showToast(err instanceof Error ? err.message : t.toast.supabaseError, 'error');
        return null;
      }
    }

    if (localServerActiveRef.current) {
      const res = await updateOwnLocalCredentials(payload);
      if (!res.ok || !res.user) {
        showToast(res.error || t.toast.supabaseError, 'error');
        return null;
      }
      setCurrentProUser(res.user);
      setUsers((prev) => prev.map((u) => (u.id === res.user!.id ? res.user! : u)));
      return res.user;
    }

    return null;
  };

  const handleChangeOwnPassword = async (
    currentPassword: string,
    newPassword: string
  ): Promise<boolean> => {
    try {
      assertAuthorized(Boolean(currentProUserRef.current?.isActive));
    } catch (err) {
      if (err instanceof PermissionError) {
        showToast(t.toast.permissionDenied, 'error');
        return false;
      }
      throw err;
    }

    if (newPassword.length < 4) {
      showToast(t.auth.passwordTooShort, 'error');
      return false;
    }

    if (isSupabaseEnvConfigured()) {
      try {
        const sb = await loadSupabaseData();
        await sb.changeOwnSupabasePassword(currentPassword, newPassword);
        return true;
      } catch (err) {
        showToast(err instanceof Error ? err.message : t.toast.supabaseError, 'error');
        return false;
      }
    }

    if (localServerActiveRef.current) {
      const res = await changeOwnLocalPassword(currentPassword, newPassword);
      if (!res.ok) {
        showToast(res.error || t.toast.supabaseError, 'error');
        return false;
      }
      return true;
    }

    showToast(t.auth.noBackendBody, 'error');
    return false;
  };

  const handleSaveMenuItem = async (item: MenuItem, isNew: boolean) => {
    try {
      assertAuthorized(canManageMenuForRestaurant(currentProUserRef.current, item.restaurantId));
      if (!isNew) {
        const existingItem = menuItems.find((m) => m.id === item.id);
        if (existingItem) {
          assertAuthorized(
            canManageMenuForRestaurant(currentProUserRef.current, existingItem.restaurantId)
          );
        }
      }
    } catch (err) {
      if (err instanceof PermissionError) {
        showToast(t.toast.permissionDenied, 'error');
        return;
      }
      throw err;
    }

    const existingItem = !isNew ? menuItems.find((m) => m.id === item.id) : undefined;
    const nextItems = isNew
      ? [item, ...menuItems]
      : menuItems.map((m) => (m.id === item.id ? item : m));

    if (isSupabaseEnvConfigured()) {
      const hasInlineOrLocalAsset =
        item.image.startsWith('data:') || item.image.startsWith('/local-uploads/');
      if ((typeof navigator === 'undefined' || navigator.onLine) && !hasInlineOrLocalAsset) {
        try {
          const sb = await loadSupabaseData();
          const saved = await sb.upsertMenuItemInSupabase(item, isNew);
          sb.invalidateSupabaseCatalogCache();
          const syncedItems = isNew
            ? [saved, ...menuItems]
            : menuItems.map((m) => (m.id === saved.id ? saved : m));
          await persistLocal(
            isNew ? 'add_item' : 'update_item',
            restaurants,
            categories,
            syncedItems,
            users,
            true
          );
          return;
        } catch {
          // Queue offline mutation below instead of discarding user edits
        }
      }

      await persistLocal(
        isNew ? 'add_item' : 'update_item',
        restaurants,
        categories,
        nextItems,
        users,
        false,
        {
          entityType: 'menu_item',
          entityId: item.id,
          operation: 'upsert',
          isNew,
          payload: item,
        },
        existingItem?.updatedAt ?? baseUpdatedAtRef.current
      );
      if (typeof navigator !== 'undefined' && navigator.onLine && hasInlineOrLocalAsset) {
        await refreshFromSupabase(true);
      } else {
        showToast(t.toast.savedOfflinePending);
      }
      return;
    }

    await persistLocal(isNew ? 'add_item' : 'update_item', restaurants, categories, nextItems, users);
  };

  const handleDeleteMenuItem = async (itemId: string) => {
    const target = menuItems.find((m) => m.id === itemId);
    try {
      assertAuthorized(
        Boolean(target && canManageMenuForRestaurant(currentProUserRef.current, target.restaurantId))
      );
    } catch (err) {
      if (err instanceof PermissionError) {
        showToast(t.toast.permissionDenied, 'error');
        return;
      }
      throw err;
    }

    const nextItems = menuItems.filter((m) => m.id !== itemId);
    if (isSupabaseEnvConfigured()) {
      if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
          const sb = await loadSupabaseData();
          await sb.deleteMenuItemInSupabase(itemId);
          sb.invalidateSupabaseCatalogCache();
          await persistLocal('delete_item', restaurants, categories, nextItems, users, true);
          return;
        } catch {
          // Queue offline delete below
        }
      }
      await persistLocal(
        'delete_item',
        restaurants,
        categories,
        nextItems,
        users,
        false,
        {
          entityType: 'menu_item',
          entityId: itemId,
          operation: 'delete',
        },
        target?.updatedAt ?? baseUpdatedAtRef.current
      );
      showToast(t.toast.savedOfflinePending);
      return;
    }

    await persistLocal('delete_item', restaurants, categories, nextItems, users);
  };

  const handleToggleAvailability = async (itemId: string) => {
    const target = menuItems.find((m) => m.id === itemId);
    if (!target) return;
    try {
      assertAuthorized(canManageMenuForRestaurant(currentProUserRef.current, target.restaurantId));
    } catch (err) {
      if (err instanceof PermissionError) {
        showToast(t.toast.permissionDenied, 'error');
        return;
      }
      throw err;
    }

    const nextAvail = !target.isAvailable;
    const nextItems = menuItems.map((m) =>
      m.id === itemId ? { ...m, isAvailable: nextAvail } : m
    );

    if (isSupabaseEnvConfigured()) {
      if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
          const sb = await loadSupabaseData();
          await sb.toggleMenuItemAvailabilityInSupabase(itemId, nextAvail);
          sb.invalidateSupabaseCatalogCache();
          await persistLocal('toggle_availability', restaurants, categories, nextItems, users, true);
          return;
        } catch {
          // Queue offline availability toggle below
        }
      }
      await persistLocal(
        'toggle_availability',
        restaurants,
        categories,
        nextItems,
        users,
        false,
        {
          entityType: 'menu_item',
          entityId: itemId,
          operation: 'toggle_availability',
          payload: { isAvailable: nextAvail },
        },
        target.updatedAt ?? baseUpdatedAtRef.current
      );
      showToast(t.toast.savedOfflinePending);
      return;
    }

    await persistLocal('toggle_availability', restaurants, categories, nextItems, users);
  };

  const handleAddCategory = async (category: Category) => {
    try {
      assertAuthorized(canManageCategory(currentProUserRef.current, category));
    } catch (err) {
      if (err instanceof PermissionError) {
        showToast(t.toast.permissionDenied, 'error');
        return;
      }
      throw err;
    }

    const nextCategories = [...categories, category];
    if (isSupabaseEnvConfigured()) {
      if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
          const sb = await loadSupabaseData();
          const saved = await sb.insertCategoryInSupabase(category);
          sb.invalidateSupabaseCatalogCache();
          await persistLocal('add_category', restaurants, [...categories, saved], menuItems, users, true);
          return;
        } catch {
          // Queue offline category insert below
        }
      }
      await persistLocal('add_category', restaurants, nextCategories, menuItems, users, false, {
        entityType: 'category',
        entityId: category.id,
        operation: 'upsert',
        isNew: true,
        payload: category,
      });
      showToast(t.toast.savedOfflinePending);
      return;
    }

    await persistLocal('add_category', restaurants, nextCategories, menuItems, users);
  };

  const handleUpdateCategory = async (category: Category) => {
    const existing = categories.find((c) => c.id === category.id);
    try {
      assertAuthorized(
        Boolean(
          existing &&
            canManageCategory(currentProUserRef.current, existing) &&
            canManageCategory(currentProUserRef.current, category)
        )
      );
    } catch (err) {
      if (err instanceof PermissionError) {
        showToast(t.toast.permissionDenied, 'error');
        return;
      }
      throw err;
    }

    const nextCategories = categories.map((c) => (c.id === category.id ? category : c));
    if (isSupabaseEnvConfigured()) {
      if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
          const sb = await loadSupabaseData();
          const saved = await sb.updateCategoryInSupabase(category);
          sb.invalidateSupabaseCatalogCache();
          await persistLocal(
            'update_category',
            restaurants,
            categories.map((c) => (c.id === saved.id ? saved : c)),
            menuItems,
            users,
            true
          );
          return;
        } catch {
          // Queue offline category update below
        }
      }
      await persistLocal('update_category', restaurants, nextCategories, menuItems, users, false, {
        entityType: 'category',
        entityId: category.id,
        operation: 'upsert',
        isNew: false,
        payload: category,
      });
      showToast(t.toast.savedOfflinePending);
      return;
    }

    await persistLocal('update_category', restaurants, nextCategories, menuItems, users);
  };

  const handleDeleteCategory = async (categoryId: string) => {
    const existing = categories.find((c) => c.id === categoryId);
    try {
      assertAuthorized(Boolean(existing && canManageCategory(currentProUserRef.current, existing)));
    } catch (err) {
      if (err instanceof PermissionError) {
        showToast(t.toast.permissionDenied, 'error');
        return;
      }
      throw err;
    }

    if (menuItems.some((m) => m.categoryId === categoryId)) {
      showToast(t.pro.categoryHasDishes, 'error');
      return;
    }

    const nextCategories = categories.filter((c) => c.id !== categoryId);
    if (isSupabaseEnvConfigured()) {
      if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
          const sb = await loadSupabaseData();
          await sb.deleteCategoryInSupabase(categoryId);
          sb.invalidateSupabaseCatalogCache();
          await persistLocal('delete_category', restaurants, nextCategories, menuItems, users, true);
          return;
        } catch {
          // Queue offline category delete below
        }
      }
      await persistLocal('delete_category', restaurants, nextCategories, menuItems, users, false, {
        entityType: 'category',
        entityId: categoryId,
        operation: 'delete',
      });
      showToast(t.toast.savedOfflinePending);
      return;
    }

    await persistLocal('delete_category', restaurants, nextCategories, menuItems, users);
  };

  return (
    <div className="min-h-screen bg-[#09090B] text-zinc-100 flex flex-col">
      <Navbar activeView={activeView} onNavigateView={handleNavigateView} />

      {activeView === 'customer' ? (
        !activeRestaurant ? (
          isCloudBootstrapping ? (
            <main className="flex-1" aria-busy="true">
              <div className="min-h-[420px] sm:min-h-[540px] bg-gradient-to-b from-[#141418] to-[#09090B] border-b border-zinc-800/80 px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
                <div className="mx-auto max-w-7xl space-y-4 animate-pulse">
                  <div className="h-4 w-48 rounded bg-zinc-800" />
                  <div className="h-12 w-3/4 max-w-md rounded-lg bg-zinc-800" />
                  <div className="h-5 w-2/3 max-w-lg rounded bg-zinc-800/80" />
                  <div className="pt-4 flex gap-3">
                    <div className="h-12 w-44 rounded-lg bg-red-900/40" />
                    <div className="h-12 w-36 rounded-lg bg-zinc-800" />
                  </div>
                </div>
              </div>
              <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 space-y-6 animate-pulse">
                <div className="flex gap-2 overflow-hidden">
                  {[1, 2, 3, 4].map((idx) => (
                    <div key={idx} className="h-10 w-28 rounded-lg bg-zinc-800 shrink-0" />
                  ))}
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {[1, 2, 3, 4, 5, 6].map((idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-4 rounded-2xl bg-[#141418] border border-zinc-800/80 p-3.5"
                    >
                      <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl bg-zinc-800 shrink-0" />
                      <div className="flex-1 space-y-2.5">
                        <div className="h-4 w-2/3 rounded bg-zinc-800" />
                        <div className="h-3 w-full rounded bg-zinc-800/70" />
                        <div className="h-4 w-24 rounded bg-orange-950/50" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </main>
          ) : (
            <main className="flex-1 flex items-center justify-center px-4 py-24">
              <div className="max-w-lg w-full rounded-2xl bg-[#141418] border border-zinc-800 p-8 text-center space-y-4">
                <Database className="w-10 h-10 text-orange-400 mx-auto" aria-hidden="true" />
                <h1 className="font-display text-3xl font-bold text-white">
                  {t.pro.emptyCloudTitle}
                </h1>
                <p className="text-sm text-zinc-400 leading-relaxed">{t.pro.emptyCloudBody}</p>
                <button
                  type="button"
                  onClick={() => handleNavigateView('pro')}
                  className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-xl bg-red-600 hover:bg-red-500 text-sm font-semibold text-white cursor-pointer"
                >
                  {t.nav.pro}
                </button>
              </div>
            </main>
          )
        ) : activeRestaurant.isActive ? (
          <main className="flex-1">
            <HeroSection
              restaurant={activeRestaurant}
              dishCount={restaurantDishes.length}
              categoryCount={restaurantCategories.length}
              onExploreMenu={() =>
                document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' })
              }
              onOpenQr={() => handleOpenQr(activeRestaurant)}
            />

            <SpecialtiesSection
              restaurant={activeRestaurant}
              items={restaurantDishes}
              categories={restaurantCategories}
              onSelectDish={setSelectedDish}
            />

            <PopularSection
              restaurant={activeRestaurant}
              items={restaurantDishes}
              categories={restaurantCategories}
              onSelectDish={setSelectedDish}
            />

            <MenuCatalog
              restaurant={activeRestaurant}
              items={restaurantDishes}
              categories={restaurantCategories}
              onSelectDish={setSelectedDish}
            />

            <LocationSection
              restaurant={activeRestaurant}
              syncStatus={syncStatus}
              onSyncNow={() =>
                runSync({
                  restaurants,
                  categories,
                  menuItems,
                  users,
                  updatedAt,
                  baseUpdatedAt,
                })
              }
              onOpenQr={() => handleOpenQr(activeRestaurant)}
            />
          </main>
        ) : (
          <main className="flex-1 flex items-center justify-center px-4 py-24">
            <div className="max-w-md w-full rounded-2xl bg-[#141418] border border-red-800/60 p-8 text-center space-y-4">
              <ShieldAlert className="w-10 h-10 text-red-400 mx-auto" aria-hidden="true" />
              <h1 className="font-display text-3xl font-bold text-white">
                {activeRestaurant.name}
              </h1>
              <p className="text-sm font-semibold text-red-300">{t.menu.suspendedTitle}</p>
              <p className="text-sm text-zinc-400 leading-relaxed">{t.menu.suspendedBody}</p>
            </div>
          </main>
        )
      ) : (
        <Suspense
          fallback={
            <main className="min-h-[60vh] flex items-center justify-center text-sm text-zinc-400">
              Loading...
            </main>
          }
        >
          <ProWorkspace
            restaurants={restaurants}
            categories={categories}
            menuItems={menuItems}
            users={users}
            activeRestaurantId={activeRestaurant?.id ?? activeRestaurantId}
            initialRecoveryMode={passwordRecoveryPending}
            onRecoveryComplete={() => setPasswordRecoveryPending(false)}
            onSelectRestaurant={handleSelectRestaurant}
            onAddRestaurant={handleAddRestaurant}
            onUpdateRestaurant={handleUpdateRestaurant}
            onToggleRestaurantStatus={handleToggleRestaurantStatus}
            onDeleteRestaurant={handleDeleteRestaurant}
            onCreateOwnerAccount={handleCreateOwnerAccount}
            onUpdateOwnerProfile={handleUpdateOwnerProfile}
            onToggleUserActive={handleToggleUserActive}
            onReassignOwner={handleReassignOwner}
            onResetUserPassword={handleResetUserPassword}
            onUpdateOwnCredentials={handleUpdateOwnCredentials}
            onChangeOwnPassword={handleChangeOwnPassword}
            onSaveMenuItem={handleSaveMenuItem}
            onDeleteMenuItem={handleDeleteMenuItem}
            onToggleAvailability={handleToggleAvailability}
            onAddCategory={handleAddCategory}
            onUpdateCategory={handleUpdateCategory}
            onDeleteCategory={handleDeleteCategory}
            onOpenQr={(r) => handleOpenQr(r)}
            onOpenCustomerMenu={(id) => {
              handleSelectRestaurant(id);
              handleNavigateView('customer', 'top');
            }}
            onRefreshCloud={() => refreshFromSupabase(true)}
            onAuthSessionChanged={async (user) => {
              currentProUserRef.current = user;
              setCurrentProUser(user);
              if (!user) {
                setUsers([]);
              }
              if (isSupabaseEnvConfigured()) {
                await refreshFromSupabase(true);
              } else if (localServerActiveRef.current) {
                if (user?.role === 'super_admin') {
                  const localUsers = await listLocalServerUsers();
                  setUsers(localUsers);
                } else {
                  setUsers([]);
                }
              }
            }}
            localServerActive={localServerActive}
            localAuthRequired={localAuthRequired}
            onAuthUserChange={(user) => {
              currentProUserRef.current = user;
              setCurrentProUser(user);
              if (!user) {
                setUsers([]);
              }
            }}
            onLocalAuthSuccess={async () => {
              setLocalAuthRequired(false);
              const outbox = await loadOutbox();
              if (outbox.length > 0 || !isSupabaseEnvConfigured()) {
                await runSync({
                  restaurants: restaurantsRef.current,
                  categories: categoriesRef.current,
                  menuItems: menuItemsRef.current,
                  users: usersRef.current,
                  updatedAt,
                  baseUpdatedAt,
                });
              } else if (localServerActiveRef.current) {
                await syncWithServer(
                  {
                    restaurants: restaurantsRef.current,
                    categories: categoriesRef.current,
                    menuItems: menuItemsRef.current,
                    users: usersRef.current,
                    updatedAt,
                    baseUpdatedAt,
                  },
                  true,
                  { pushOnlyToLocal: true, actor: currentProUserRef.current }
                );
              }
            }}
          />
        </Suspense>
      )}

      <Footer onNavigateView={handleNavigateView} />

      {/* Compact Floating Cart Button on Customer View */}
      {activeView === 'customer' && activeRestaurant && activeRestaurant.isActive && (
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          style={{ backgroundColor: activeRestaurant.primaryColor || '#DC2626' }}
          className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2.5 min-h-[48px] px-4 rounded-xl text-white shadow-2xl hover:brightness-110 transition cursor-pointer print:hidden"
        >
          <ShoppingBag className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="text-sm font-semibold whitespace-nowrap">
            {t.cart.buttonLabel}
            {cartCount > 0 ? ` (${cartCount})` : ''}
          </span>
          {cartCount > 0 && (
            <span className="font-mono text-xs bg-black/30 px-2 py-0.5 rounded-md tabular-nums">
              {formatFC(cartTotalFC)}
            </span>
          )}
        </button>
      )}

      <Suspense fallback={null}>
        {selectedDish && activeRestaurant && (
          <DishDetailModal
            dish={selectedDish}
            restaurant={activeRestaurant}
            categories={restaurantCategories}
            onClose={() => setSelectedDish(null)}
          />
        )}

        {cartOpen && activeRestaurant && (
          <CartDrawer
            restaurant={activeRestaurant}
            isOpen={cartOpen}
            onClose={() => setCartOpen(false)}
          />
        )}

        {qrRestaurant && (
          <QRCodeModal restaurant={qrRestaurant} onClose={handleCloseQr} />
        )}
      </Suspense>

      <OfflineIndicator
        syncStatus={syncStatus}
        pendingCount={pendingCount}
        localServerActive={localServerActive}
        allowLocalOverwrite={activeView === 'pro' && canPushServerSync(currentProUser)}
        autoRetrying={Boolean(autoRetryAt && !retryStoppedPermanent && syncStatus !== 'offline')}
        conflictItems={conflictDetails}
        lastSyncedAt={lastSyncedAt}
        onSyncNow={() => {
          setRetryStoppedPermanent(false);
          setAutoRetryAt(null);
          void runSync({
            restaurants,
            categories,
            menuItems,
            users,
            updatedAt,
            baseUpdatedAt,
          });
        }}
        onResolveConflict={handleResolveConflict}
      />
      <ToastContainer />
    </div>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <ToastProvider>
        <CartProvider>
          <SmartMenuShell />
        </CartProvider>
      </ToastProvider>
    </LanguageProvider>
  );
}
