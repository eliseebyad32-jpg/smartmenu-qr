import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

export type ImageVariant = 'thumb' | 'medium' | 'hero' | 'full';

interface CulinaryImageProps {
  src: string;
  alt: string;
  variant?: ImageVariant;
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
  showEmptyText?: boolean;
  sizes?: string;
}

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
}

function isConstrainedConnection(): boolean {
  if (typeof navigator === 'undefined') return false;
  const conn = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  if (!conn) return false;
  if (conn.saveData) return true;
  return conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g';
}

function isLocalDishJpg(src: string): boolean {
  return src.startsWith('/src/assets/images/') && src.endsWith('.jpg');
}

export function resolvePreferredImageUrl(src: string, variant: ImageVariant = 'medium'): string {
  if (!isLocalDishJpg(src) || variant === 'full') return src;
  if (variant === 'thumb') {
    return src.replace(/\.jpg$/, '-thumb.webp');
  }
  return src.replace(/\.jpg$/, '-md.webp');
}

const warmedUrls = new Set<string>();
const loadedImageKeys = new Set<string>();

export function warmImageCache(src: string, variant: ImageVariant = 'medium'): void {
  if (typeof window === 'undefined' || !src || isConstrainedConnection()) return;
  const target = resolvePreferredImageUrl(src, variant);
  if (warmedUrls.has(target)) return;
  warmedUrls.add(target);
  const img = new Image();
  img.decoding = 'async';
  img.src = target;
}

function buildWebpSource(
  src: string,
  variant: ImageVariant
): { srcSet: string; sizes?: string } | null {
  if (!isLocalDishJpg(src) || variant === 'full') return null;

  const thumbUrl = src.replace(/\.jpg$/, '-thumb.webp');
  const mdUrl = src.replace(/\.jpg$/, '-md.webp');

  if (variant === 'thumb') {
    // Always use the precached 280px WebP thumbnail for 96-112px cards so retina devices stay 100% offline-ready
    return { srcSet: thumbUrl };
  }

  if (variant === 'hero') {
    return {
      srcSet: `${mdUrl} 800w`,
      sizes: '100vw',
    };
  }

  // 'medium' (DishDetailModal, cards) -> crisp 800px WebP
  return { srcSet: mdUrl };
}

export const CulinaryImage: React.FC<CulinaryImageProps> = ({
  src,
  alt,
  variant = 'medium',
  width,
  height,
  className = 'w-full h-full object-cover',
  priority = false,
  showEmptyText = true,
  sizes,
}) => {
  const { t } = useLanguage();
  const imgRef = useRef<HTMLImageElement | null>(null);
  const cacheKey = `${src}|${variant}`;
  // Fallback ladder:
  // 0 = primary preferred variant
  // 1 = precached -thumb.webp (for local dish JPGs)
  // 2 = original .jpg (for local dish JPGs)
  // 3 = local server /api/cached-image mirror (for http or /local-uploads/)
  // 4 = exhausted -> ImageOff placeholder
  const [fallbackStep, setFallbackStep] = useState(0);
  const [isLoaded, setIsLoaded] = useState(() => loadedImageKeys.has(cacheKey));

  useEffect(() => {
    setFallbackStep(0);
    if (loadedImageKeys.has(cacheKey)) {
      setIsLoaded(true);
    } else {
      setIsLoaded(false);
    }
  }, [cacheKey]);

  useLayoutEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0) {
      loadedImageKeys.add(cacheKey);
      setIsLoaded(true);
    }
  }, [cacheKey, fallbackStep]);

  if (fallbackStep >= 4 || !src) {
    return (
      <div
        role="img"
        aria-label={alt || t.pro.noPhotoAdded}
        className="w-full h-full flex flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-zinc-900 via-[#121217] to-zinc-900 border border-dashed border-zinc-800 text-zinc-400 p-2 text-center select-none"
      >
        <ImageOff className="w-5 h-5 text-zinc-500 shrink-0" aria-hidden="true" />
        {showEmptyText && (
          <span className="text-[10px] leading-tight font-medium text-zinc-400 max-w-[120px]">
            {t.pro.noPhotoAdded}
          </span>
        )}
      </div>
    );
  }

  const webpSource = fallbackStep === 0 ? buildWebpSource(src, variant) : null;

  let effectiveSrc = src;
  if (fallbackStep === 0) {
    effectiveSrc =
      variant === 'hero' && !isConstrainedConnection()
        ? src
        : resolvePreferredImageUrl(src, variant);
  } else if (fallbackStep === 1 && isLocalDishJpg(src)) {
    effectiveSrc = resolvePreferredImageUrl(src, 'thumb');
  } else if (fallbackStep === 2 && isLocalDishJpg(src)) {
    effectiveSrc = src;
  } else if (fallbackStep === 3 && (src.startsWith('http') || src.startsWith('/local-uploads/'))) {
    effectiveSrc = `/api/cached-image?url=${encodeURIComponent(src)}`;
  }

  const handleImageError = () => {
    if (fallbackStep === 0) {
      if (isLocalDishJpg(src)) {
        const primaryUrl = resolvePreferredImageUrl(src, variant);
        const thumbUrl = resolvePreferredImageUrl(src, 'thumb');
        if (primaryUrl !== thumbUrl) {
          setFallbackStep(1);
          return;
        }
        setFallbackStep(2);
        return;
      }
      if (src.startsWith('http') || src.startsWith('/local-uploads/')) {
        setFallbackStep(3);
        return;
      }
      setFallbackStep(4);
      return;
    }

    if (fallbackStep === 1) {
      setFallbackStep(2);
      return;
    }

    if (fallbackStep === 2) {
      setFallbackStep(4);
      return;
    }

    setFallbackStep(4);
  };

  return (
    <div className="relative z-0 w-full h-full overflow-hidden bg-zinc-900">
      {!isLoaded && (
        <div
          aria-hidden="true"
          className="absolute inset-0 z-0 bg-gradient-to-br from-zinc-900 via-zinc-800/70 to-zinc-900 animate-pulse pointer-events-none"
        />
      )}
      <picture className="relative z-[1] block w-full h-full">
        {webpSource && (
          <source
            type="image/webp"
            srcSet={webpSource.srcSet}
            sizes={sizes ?? webpSource.sizes}
          />
        )}
        <img
          ref={imgRef}
          src={effectiveSrc}
          alt={alt}
          width={width}
          height={height}
          loading="eager"
          decoding="async"
          fetchPriority={priority ? 'high' : 'auto'}
          referrerPolicy="no-referrer"
          onLoad={() => {
            loadedImageKeys.add(cacheKey);
            setIsLoaded(true);
          }}
          onError={handleImageError}
          className={`${className} opacity-100`}
        />
      </picture>
    </div>
  );
};
