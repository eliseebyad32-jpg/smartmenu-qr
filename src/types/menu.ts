export type Language = 'fr' | 'en';

export interface LocalizedText {
  fr: string;
  en: string;
}

export type CategoryId = string;

export interface Category {
  id: CategoryId;
  restaurantId?: string; // undefined = global base category, string = custom restaurant category
  name: LocalizedText;
  description: LocalizedText;
  order: number;
}

export interface MenuItem {
  id: string;
  restaurantId: string;
  categoryId: CategoryId;
  name: LocalizedText;
  description: LocalizedText;
  ingredients: LocalizedText;
  priceFC: number;
  image: string;
  isAvailable: boolean;
  isPopular?: boolean;
  isSpecialty?: boolean;
  spiceLevel?: 0 | 1 | 2 | 3;
  prepMinutes?: number;
  updatedAt?: string;
}

export interface Restaurant {
  id: string;
  slug: string;
  name: string;
  city: string;
  country: LocalizedText;
  address: LocalizedText;
  hours: LocalizedText;
  phone: string;
  tagline: LocalizedText;
  description: LocalizedText;
  demoDisclaimer: LocalizedText;
  heroImage: string;
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  isActive: boolean;
  ownerId: string;
  isDemo: boolean;
  updatedAt?: string;
}

export type UserRole = 'super_admin' | 'restaurateur';

export interface PlatformUser {
  id: string;
  name: string;
  email: string;
  password: string; // Used only for local demo authentication when Supabase is not configured
  role: UserRole;
  assignedRestaurantId: string | null;
  isActive: boolean;
}

export interface CartItem {
  item: MenuItem;
  quantity: number;
  note?: string;
}

export type AppView = 'customer' | 'pro';
