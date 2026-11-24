export interface OptimizedImageResult {
  blob: Blob;
  dataUrl: string;
  extension: string;
  contentType: string;
}

const ALLOWED_RASTER_DATA_PREFIXES = [
  'data:image/jpeg;base64,',
  'data:image/jpg;base64,',
  'data:image/png;base64,',
  'data:image/webp;base64,',
];

export const MAX_INLINE_IMAGE_DATA_URL_LENGTH = 260_000;

export function isSafeRasterDataUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    value.length <= MAX_INLINE_IMAGE_DATA_URL_LENGTH &&
    ALLOWED_RASTER_DATA_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}

function encodeCanvasToBoundedJpeg(
  canvas: HTMLCanvasElement,
  initialQuality = 0.82
): Promise<{ blob: Blob; dataUrl: string }> {
  return new Promise((resolve) => {
    let quality = initialQuality;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    while (dataUrl.length > MAX_INLINE_IMAGE_DATA_URL_LENGTH && quality > 0.42) {
      quality = Math.max(0.4, Number((quality - 0.1).toFixed(2)));
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve({ blob, dataUrl });
        } else {
          fetch(dataUrl)
            .then((r) => r.blob())
            .then((fallbackBlob) => resolve({ blob: fallbackBlob, dataUrl }))
            .catch(() => resolve({ blob: new Blob(), dataUrl }));
        }
      },
      'image/jpeg',
      quality
    );
  });
}

export async function optimizeBlobToBoundedImage(
  inputBlob: Blob,
  maxDimension = 800
): Promise<OptimizedImageResult> {
  const objectUrl = URL.createObjectURL(inputBlob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Invalid image file'));
      el.src = objectUrl;
    });

    let dim = maxDimension;
    let encoded: { blob: Blob; dataUrl: string } | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const ratio = Math.min(1, dim / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * ratio));
      const height = Math.max(1, Math.round(img.height * ratio));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Canvas unavailable');
      }
      ctx.drawImage(img, 0, 0, width, height);
      encoded = await encodeCanvasToBoundedJpeg(canvas, attempt === 0 ? 0.82 : 0.72);
      if (encoded.dataUrl.length <= MAX_INLINE_IMAGE_DATA_URL_LENGTH) {
        break;
      }
      dim = Math.max(320, Math.round(dim * 0.75));
    }

    if (!encoded) {
      throw new Error('Image optimization failed');
    }

    return {
      blob: encoded.blob,
      dataUrl: encoded.dataUrl,
      extension: 'jpg',
      contentType: 'image/jpeg',
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function readAndOptimizeImageBlob(
  file: File,
  maxDimension = 900
): Promise<OptimizedImageResult> {
  return optimizeBlobToBoundedImage(file, maxDimension);
}

export async function readAndOptimizeImage(file: File, maxDimension = 800): Promise<string> {
  const result = await readAndOptimizeImageBlob(file, maxDimension);
  return result.dataUrl;
}
