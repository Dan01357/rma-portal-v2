/**
 * Client-Side Image Compressor using HTML5 Canvas
 * Reduces high-resolution smartphone camera photos (5-15MB) to ~300-500KB
 * preserving sharp details for warranty inspection while saving Supabase Free Tier storage.
 */

export function formatBytes(bytes, decimals = 1) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export async function compressImage(file, options = {}) {
  const {
    maxWidth = 1600,
    maxHeight = 1600,
    quality = 0.75,
    mimeType = 'image/jpeg'
  } = options;

  return new Promise((resolve, reject) => {
    // If not an image, pass through
    if (!file.type.startsWith('image/')) {
      reject(new Error('File is not a supported image format.'));
      return;
    }

    const originalSize = file.size;
    const reader = new FileReader();

    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.onload = (event) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to parse image data'));
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // Calculate aspect-ratio preserving dimensions
        if (width > maxWidth || height > maxHeight) {
          if (width / height > maxWidth / maxHeight) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D context unavailable'));
          return;
        }

        // Clean white background for transparent PNG converted to JPEG
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);

        // High quality rendering
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Canvas image compression failed'));
              return;
            }

            const compressedSize = blob.size;
            const savingsPercent = Math.max(
              0,
              Math.round(((originalSize - compressedSize) / originalSize) * 100)
            );

            // Create compressed File object
            const cleanFileName = (file.name || 'defect_evidence.jpg')
              .replace(/\.[^/.]+$/, '') + '.jpg';

            const compressedFile = new File([blob], cleanFileName, {
              type: mimeType,
              lastModified: Date.now()
            });

            // Base64 Data URL for instant live preview
            const previewUrl = canvas.toDataURL(mimeType, quality);

            resolve({
              file: compressedFile,
              blob,
              previewUrl,
              originalSize,
              compressedSize,
              savingsPercent,
              formattedOriginal: formatBytes(originalSize),
              formattedCompressed: formatBytes(compressedSize),
              width,
              height
            });
          },
          mimeType,
          quality
        );
      };

      img.src = event.target.result;
    };

    reader.readAsDataURL(file);
  });
}
