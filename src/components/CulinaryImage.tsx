import React, { useEffect, useRef, useState } from 'react';
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
  const constrained = isConstrainedConnection();

  if (variant === 'thumb') {
    if (constrained) {
      return { srcSet: thumbUrl };
    }
    return {
      srcSet: `${thumbUrl} 280w, ${mdUrl} 800w`,
      sizes: '(max-width: 640px) 112px, 128px',
    };
  }

  if (variant === 'hero') {
    if (constrained) {
      return { srcSet: mdUrl };
    }
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
  const [hasError, setHasError] = useState(false);
  const [useServerMirror, setUseServerMirror] = useState(false);
  const [useLocalWebpFallback, setUseLocalWebpFallback] = useState(false);
  const [isLoaded, setIsLoaded] = useState(() => loadedImageKeys.has(cacheKey));

  useEffect(() => {
    setHasError(false);
    setUseServerMirror(false);
    setUseLocalWebpFallback(false);
    if (loadedImageKeys.has(cacheKey) || (imgRef.current?.complete && imgRef.current.naturalWidth > 0)) {
      loadedImageKeys.add(cacheKey);
      setIsLoaded(true);
    } else {
      setIsLoaded(false);
    }
  }, [cacheKey]);

  if (hasError || !src) {
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

  const webpSource = useServerMirror ? null : buildWebpSource(src, variant);
  const effectiveSrc = useServerMirror
    ? `/api/cached-image?url=${encodeURIComponent(src)}`
    : useLocalWebpFallback
    ? resolvePreferredImageUrl(src, variant === 'thumb' ? 'thumb' : 'medium')
    : variant === 'hero' && !isConstrainedConnection()
    ? src
    : resolvePreferredImageUrl(src, variant);

  return (
    <div className="relative w-full h-full overflow-hidden bg-zinc-900">
      {!isLoaded && (
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-br from-zinc-900 via-zinc-800/70 to-zinc-900 animate-pulse"
        />
      )}
      <picture className="block w-full h-full">
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
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? 'high' : 'low'}
          referrerPolicy="no-referrer"
          onLoad={() => {
            loadedImageKeys.add(cacheKey);
            setIsLoaded(true);
          }}
          onError={() => {
            if (!useLocalWebpFallback && isLocalDishJpg(src)) {
              setUseLocalWebpFallback(true);
              return;
            }
            if (!useServerMirror && src.startsWith('http')) {
              setUseServerMirror(true);
              return;
            }
            setHasError(true);
          }}
          className={`${className} transition-opacity duration-200 ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </picture>
    </div>
  );
};
