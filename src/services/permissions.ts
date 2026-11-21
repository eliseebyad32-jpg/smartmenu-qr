import { Category, PlatformUser } from '../types/menu';

export class PermissionError extends Error {
  constructor(message = 'Action non autorisée pour ce rôle.') {
    super(message);
    this.name = 'PermissionError';
  }
}

export function isSuperAdmin(user: PlatformUser | null | undefined): boolean {
  return Boolean(user && user.isActive && user.role === 'super_admin');
}

export function isActiveRestaurateur(user: PlatformUser | null | undefined): boolean {
  return Boolean(
    user &&
      user.isActive &&
      user.role === 'restaurateur' &&
      typeof user.assignedRestaurantId === 'string' &&
      user.assignedRestaurantId.length > 0
  );
}

export function canCreateRestaurant(user: PlatformUser | null | undefined): boolean {
  return isSuperAdmin(user);
}

export function canEditRestaurant(user: PlatformUser | null | undefined): boolean {
  return isSuperAdmin(user);
}

export function canPersonalizeRestaurant(user: PlatformUser | null | undefined): boolean {
  return isSuperAdmin(user);
}

export function canToggleRestaurantStatus(user: PlatformUser | null | undefined): boolean {
  return isSuperAdmin(user);
}

export function canDeleteRestaurant(user: PlatformUser | null | undefined): boolean {
  return isSuperAdmin(user);
}

export function canManageAccounts(user: PlatformUser | null | undefined): boolean {
  return isSuperAdmin(user);
}

export function canManageMenuForRestaurant(
  user: PlatformUser | null | undefined,
  restaurantId: string | null | undefined
): boolean {
  if (!restaurantId) return false;
  if (isSuperAdmin(user)) return true;
  if (isActiveRestaurateur(user)) {
    return user?.assignedRestaurantId === restaurantId;
  }
  return false;
}

export function canManageCategory(
  user: PlatformUser | null | undefined,
  category: Pick<Category, 'restaurantId'> | null | undefined
): boolean {
  if (!category) return false;
  if (isSuperAdmin(user)) return true;
  if (isActiveRestaurateur(user)) {
    // Restaurateur can only add/edit/delete categories belonging strictly to their own restaurant
    return Boolean(category.restaurantId && category.restaurantId === user?.assignedRestaurantId);
  }
  return false;
}

export function canPushServerSync(user: PlatformUser | null | undefined): boolean {
  return isSuperAdmin(user) || isActiveRestaurateur(user);
}

export function assertAuthorized(condition: boolean, message?: string): void {
  if (!condition) {
    throw new PermissionError(message);
  }
}
