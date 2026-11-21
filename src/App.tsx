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
  INITIAL_USERS,
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
  resetPlatformState,
  savePlatformState,
  setLastSyncedAt,
  SyncEntityType,
  SyncOperation,
} from './services/offlineStore';
import {
  fetchLocalServerInfo,
  syncPendingOutboxWithSupabase,
  SyncStatus,
  syncWithServer,
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
    supabaseEnabled ? loadCachedSnapshotSync(false) : null
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
  const [users, setUsers] = useState<PlatformUser[]>(
    supabaseEnabled ? initialCachedSnapshot?.users ?? [] : INITIAL_USERS
  );
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
  const [selectedDish, setSelectedDish] = useState<MenuItem | null>(null);
  const [openQrSnapshot, setOpenQrSnapshot] = useState<Restaurant | null>(() => readStoredOpenQr());
  const [cartOpen, setCartOpen] = useState(false);

  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'online'
  );
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [localServerActive, setLocalServerActive] = useState<boolean>(false);
  const [lastSyncedAt, setLastSyncedAtState] = useState<string | null>(() => getLastSyncedAt());
  const [conflictServerState, setConflictServerState] = useState<PlatformState | null>(null);
  const lastCloudSyncRef = useRef<number>(0);

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
        users: nextUsers ?? usersRef.current,
        updatedAt: now,
        baseUpdatedAt: now,
      });

      // Mirror fresh cloud snapshot onto local PC LAN server when running locally
      if (localServerActiveRef.current && nextRestaurants.length > 0) {
        void syncWithServer(saved, true, {
          lastCloudSyncAt: now,
          pushOnlyToLocal: true,
        });
      }
    },
    []
  );

  const refreshFromSupabase = useCallback(
    async (force = false, forceOverwriteConflicts = false) => {
      if (!isSupabaseEnvConfigured()) return;

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
            baseUpdatedAt,
          },
          false
        );
        if (localProbe.localServerActive) {
          setLocalServerActive(true);
          if (localProbe.mergedState && localProbe.mergedState.restaurants.length > 0) {
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
        // Replay queued offline mutations before pulling fresh cloud data so edits are never lost
        if (outbox.length > 0) {
          const replayResult = await syncPendingOutboxWithSupabase(
            {
              restaurants: restaurantsRef.current,
              categories: categoriesRef.current,
              menuItems: menuItemsRef.current,
              users: usersRef.current,
              updatedAt: new Date().toISOString(),
              baseUpdatedAt,
            },
            forceOverwriteConflicts
          );
          setPendingCount(replayResult.pendingCount);

          if (replayResult.status === 'conflict' && replayResult.serverConflictState) {
            setConflictServerState(replayResult.serverConflictState);
            setSyncStatus('conflict');
            setIsCloudBootstrapping(false);
            return;
          }

          if (replayResult.status === 'error') {
            setSyncStatus('error');
            setIsCloudBootstrapping(false);
            return;
          }

          if (replayResult.mergedState) {
            await applyAndCacheCloudState(
              replayResult.mergedState.restaurants,
              replayResult.mergedState.categories,
              replayResult.mergedState.menuItems,
              replayResult.mergedState.users
            );
            lastCloudSyncRef.current = Date.now();
            setSyncStatus('online');
            setPendingCount(0);
            setIsCloudBootstrapping(false);
            return;
          }
        }

        const sb = await loadSupabaseData();
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
            setPendingCount(0);
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
        setPendingCount(0);
      } catch {
        setSyncStatus(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error');
      } finally {
        setIsCloudBootstrapping(false);
      }
    },
    [applyAndCacheCloudState, baseUpdatedAt]
  );

  const runSync = useCallback(
    async (stateSnapshot: PlatformState, forceOverwrite = false) => {
      if (isSupabaseEnvConfigured()) {
        await refreshFromSupabase(true, forceOverwrite);
        return;
      }

      setSyncStatus('syncing');
      const result = await syncWithServer(stateSnapshot, forceOverwrite);
      if (result.localServerActive !== undefined) {
        setLocalServerActive(result.localServerActive);
      }
      setPendingCount(result.pendingCount);
      setSyncStatus(result.status);
      if (result.lastSyncedAt) {
        setLastSyncedAtState(result.lastSyncedAt);
      }

      if (result.status === 'conflict' && result.serverConflictState) {
        setConflictServerState(result.serverConflictState);
      } else if (result.mergedState) {
        setRestaurants(result.mergedState.restaurants);
        setCategories(result.mergedState.categories);
        setMenuItems(result.mergedState.menuItems);
        setUsers(result.mergedState.users);
        setUpdatedAt(result.mergedState.updatedAt);
        setBaseUpdatedAt(result.mergedState.baseUpdatedAt || result.mergedState.updatedAt);
      }
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
        // Hydrate from IndexedDB if localStorage snapshot wasn't available, then refresh Supabase
        if (!initialCachedSnapshot || initialCachedSnapshot.restaurants.length === 0) {
          const cached = await loadPlatformState(false).catch(() => null);
          if (mounted && cached && cached.restaurants.length > 0) {
            setRestaurants(cached.restaurants);
            setCategories(cached.categories);
            setMenuItems(cached.menuItems);
            setUsers(cached.users);
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
        await refreshFromSupabase(true);
        return;
      }

      const state = await loadPlatformState(true);
      if (!mounted) return;
      setRestaurants(state.restaurants);
      setCategories(state.categories);
      setMenuItems(state.menuItems);
      setUsers(state.users);
      setUpdatedAt(state.updatedAt);
      setBaseUpdatedAt(state.baseUpdatedAt || state.updatedAt);

      const urlSlug = getInitialRestaurantSlug();
      if (urlSlug) {
        const matched = state.restaurants.find((r) => r.slug === urlSlug);
        if (matched) {
          setActiveRestaurantId(matched.id);
        }
      }

      runSync(state);
    };

    init();

    const handleOnline = () => {
      if (isSupabaseEnvConfigured()) {
        refreshFromSupabase(true);
      } else {
        loadPlatformState(true).then((latest) => runSync(latest));
      }
    };
    const handleOffline = () => {
      setSyncStatus('offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      mounted = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [initialCachedSnapshot, refreshFromSupabase, runSync]);

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
    }
  ) => {
    const now = new Date().toISOString();
    setRestaurants(nextRestaurants);
    setCategories(nextCategories);
    setMenuItems(nextItems);
    setUsers(nextUsers);
    setUpdatedAt(now);

    const saved = await savePlatformState({
      restaurants: nextRestaurants,
      categories: nextCategories,
      menuItems: nextItems,
      users: nextUsers,
      updatedAt: now,
      baseUpdatedAt,
    });

    if (!skipOutbox) {
      const outbox = await enqueueOutboxMutation(actionLabel, baseUpdatedAt, outboxDetails);
      setPendingCount(outbox.length);
      if (isSupabaseEnvConfigured()) {
        if (localServerActiveRef.current) {
          await syncWithServer(saved, true, { pushOnlyToLocal: true });
        }
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          setSyncStatus('offline');
        }
      } else {
        await runSync(saved);
      }
    } else if (isSupabaseEnvConfigured() && localServerActiveRef.current) {
      await syncWithServer(saved, true, {
        lastCloudSyncAt: now,
        pushOnlyToLocal: true,
      });
    }
  };

  const handleResolveConflict = async (strategy: 'keep_local' | 'use_server') => {
    if (strategy === 'keep_local') {
      const currentSnapshot: PlatformState = {
        restaurants,
        categories,
        menuItems,
        users,
        updatedAt,
        baseUpdatedAt,
      };
      setConflictServerState(null);
      await runSync(currentSnapshot, true);
      showToast(t.sync.statusOnline);
    } else if (conflictServerState) {
      const committed = await savePlatformState({
        ...conflictServerState,
        baseUpdatedAt: conflictServerState.updatedAt,
      });
      await clearOutbox();
      setRestaurants(committed.restaurants);
      setCategories(committed.categories);
      setMenuItems(committed.menuItems);
      setUsers(committed.users);
      setUpdatedAt(committed.updatedAt);
      setBaseUpdatedAt(committed.updatedAt);
      setPendingCount(0);
      setConflictServerState(null);
      setSyncStatus('online');
      showToast(t.sync.statusOnline);
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
    ownerEmail: string;
    ownerPassword: string;
  }): Promise<boolean> => {
    const slug = `${payload.name}-${payload.city}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const restId = `${slug}-${Date.now().toString(36)}`;
    const ownerId = `user-${Date.now().toString(36)}`;

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
      ownerId,
      isDemo: false,
    };

    if (isSupabaseEnvConfigured()) {
      try {
        const sb = await loadSupabaseData();
        const createdRest = await sb.upsertRestaurantInSupabase(newRest, true);
        let createdOwner: PlatformUser | null = null;
        try {
          createdOwner = await sb.createOwnerAccountInSupabase({
            name: payload.ownerName,
            email: payload.ownerEmail,
            password: payload.ownerPassword,
            restaurantId: createdRest.id,
          });
          await sb.upsertRestaurantInSupabase({ ...createdRest, ownerId: createdOwner.id }, false);
        } catch {
          showToast(t.toast.supabaseError, 'error');
        }
        sb.invalidateSupabaseCatalogCache();
        await refreshFromSupabase(true);
        setActiveRestaurantId(createdRest.id);
        return true;
      } catch {
        showToast(t.toast.supabaseError, 'error');
        return false;
      }
    }

    const newOwner: PlatformUser = {
      id: ownerId,
      name: payload.ownerName,
      email: payload.ownerEmail,
      password: payload.ownerPassword,
      role: 'restaurateur',
      assignedRestaurantId: restId,
      isActive: true,
    };

    await persistLocal('add_restaurant', [...restaurants, newRest], categories, menuItems, [
      ...users,
      newOwner,
    ]);
    handleSelectRestaurant(restId);
    return true;
  };

  const handleUpdateRestaurant = async (updated: Restaurant) => {
    const next = restaurants.map((r) => (r.id === updated.id ? updated : r));
    if (isSupabaseEnvConfigured()) {
      if (typeof navigator === 'undefined' || navigator.onLine) {
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
      await persistLocal('update_restaurant', next, categories, menuItems, users, false, {
        entityType: 'restaurant',
        entityId: updated.id,
        operation: 'upsert',
        isNew: false,
        payload: updated,
      });
      showToast(t.toast.savedOfflinePending);
      return;
    }

    await persistLocal('update_restaurant', next, categories, menuItems, users);
  };

  const handleToggleRestaurantStatus = async (restaurantId: string) => {
    const target = restaurants.find((r) => r.id === restaurantId);
    if (!target) return;
    const nextStatus = !target.isActive;

    if (isSupabaseEnvConfigured()) {
      try {
        const sb = await loadSupabaseData();
        await sb.toggleRestaurantStatusInSupabase(restaurantId, nextStatus);
        sb.invalidateSupabaseCatalogCache();
        const next = restaurants.map((r) =>
          r.id === restaurantId ? { ...r, isActive: nextStatus } : r
        );
        await persistLocal('toggle_restaurant_status', next, categories, menuItems, users, true);
      } catch {
        showToast(t.toast.supabaseError, 'error');
      }
      return;
    }

    const next = restaurants.map((r) =>
      r.id === restaurantId ? { ...r, isActive: nextStatus } : r
    );
    await persistLocal('toggle_restaurant_status', next, categories, menuItems, users);
  };

  const handleCreateOwnerAccount = async (payload: {
    name: string;
    email: string;
    password: string;
    restaurantId: string;
  }): Promise<boolean> => {
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
      } catch {
        showToast(t.toast.supabaseError, 'error');
        return false;
      }
    }

    const newOwner: PlatformUser = {
      id: `user-${Date.now().toString(36)}`,
      name: payload.name,
      email: payload.email,
      password: payload.password,
      role: 'restaurateur',
      assignedRestaurantId: payload.restaurantId,
      isActive: true,
    };
    await persistLocal('create_owner', restaurants, categories, menuItems, [...users, newOwner]);
    return true;
  };

  const handleToggleUserActive = async (userId: string) => {
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

    const next = users.map((u) => (u.id === userId ? { ...u, isActive: nextActive } : u));
    await persistLocal('toggle_user', restaurants, categories, menuItems, next);
  };

  const handleSaveMenuItem = async (item: MenuItem, isNew: boolean) => {
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
        }
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
      await persistLocal('delete_item', restaurants, categories, nextItems, users, false, {
        entityType: 'menu_item',
        entityId: itemId,
        operation: 'delete',
      });
      showToast(t.toast.savedOfflinePending);
      return;
    }

    await persistLocal('delete_item', restaurants, categories, nextItems, users);
  };

  const handleToggleAvailability = async (itemId: string) => {
    const target = menuItems.find((m) => m.id === itemId);
    if (!target) return;
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
      await persistLocal('toggle_availability', restaurants, categories, nextItems, users, false, {
        entityType: 'menu_item',
        entityId: itemId,
        operation: 'toggle_availability',
        payload: { isAvailable: nextAvail },
      });
      showToast(t.toast.savedOfflinePending);
      return;
    }

    await persistLocal('toggle_availability', restaurants, categories, nextItems, users);
  };

  const handleAddCategory = async (category: Category) => {
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

  const handleResetDemo = async () => {
    if (isSupabaseEnvConfigured()) {
      await refreshFromSupabase(true);
      return;
    }
    const fresh = await resetPlatformState();
    setRestaurants(fresh.restaurants);
    setCategories(fresh.categories);
    setMenuItems(fresh.menuItems);
    setUsers(fresh.users);
    setUpdatedAt(fresh.updatedAt);
    setBaseUpdatedAt(fresh.updatedAt);
    setPendingCount(0);
    setConflictServerState(null);
    handleSelectRestaurant('rocomamas-lubumbashi');
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
            onSelectRestaurant={handleSelectRestaurant}
            onAddRestaurant={handleAddRestaurant}
            onUpdateRestaurant={handleUpdateRestaurant}
            onToggleRestaurantStatus={handleToggleRestaurantStatus}
            onCreateOwnerAccount={handleCreateOwnerAccount}
            onToggleUserActive={handleToggleUserActive}
            onSaveMenuItem={handleSaveMenuItem}
            onDeleteMenuItem={handleDeleteMenuItem}
            onToggleAvailability={handleToggleAvailability}
            onAddCategory={handleAddCategory}
            onOpenQr={(r) => handleOpenQr(r)}
            onOpenCustomerMenu={(id) => {
              handleSelectRestaurant(id);
              handleNavigateView('customer', 'top');
            }}
            onResetDemo={handleResetDemo}
            onRefreshCloud={() => refreshFromSupabase(true)}
            onAuthSessionChanged={() => refreshFromSupabase(true)}
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
        lastSyncedAt={lastSyncedAt}
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
