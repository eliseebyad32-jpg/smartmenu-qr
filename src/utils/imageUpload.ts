export interface OptimizedImageResult {
  blob: Blob;
  dataUrl: string;
  extension: string;
  contentType: string;
}

export function readAndOptimizeImageBlob(
  file: File,
  maxDimension = 900
): Promise<OptimizedImageResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('File read error'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file'));
      img.onload = () => {
        const ratio = Math.min(1, maxDimension / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * ratio));
        const height = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({
            blob: file,
            dataUrl: String(reader.result),
            extension: 'jpg',
            contentType: file.type || 'image/jpeg',
          });
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        canvas.toBlob(
          (blob) => {
            resolve({
              blob: blob || file,
              dataUrl,
              extension: 'jpg',
              contentType: 'image/jpeg',
            });
          },
          'image/jpeg',
          0.82
        );
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export async function readAndOptimizeImage(file: File, maxDimension = 800): Promise<string> {
  const result = await readAndOptimizeImageBlob(file, maxDimension);
  return result.dataUrl;
}
