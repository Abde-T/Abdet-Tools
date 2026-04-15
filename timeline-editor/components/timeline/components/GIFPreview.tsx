import React, {
  useEffect,
  useState,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { Image as KonvaImage, Group, Rect } from "react-konva";
import { parseGIF, decompressFrames } from "gifuct-js";

/**
 * GIFPreview.tsx
 *
 * Renders a strip of thumbnails for a GIF clip on the timeline.
 * Parses the raw GIF buffer using `gifuct-js`, extracts evenly spaced
 * frames, renders them onto an offscreen canvas, and displays them as Konva
 * images. Generation is progressive and batched to prevent UI locks.
 */
interface GIFPreviewProps {
  gifUrl: string | File | Blob;
  width: number;
  height: number;
  x?: number;
  y?: number;
  zoom?: number;
}

const thumbnailsCache = new Map<string, HTMLImageElement[]>();
const objectUrlRegistry = new Map<string, string[]>();

const GIFPreview: React.FC<GIFPreviewProps> = ({
  gifUrl,
  width,
  height,
  x = 0,
  y = 0,
  zoom = 1,
}) => {
  const [internalUrl, setInternalUrl] = useState<string>("");
  const [images, setImages] = useState<HTMLImageElement[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const generationIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let url = "";
    let isBlob = false;
    if (gifUrl instanceof File || gifUrl instanceof Blob) {
      url = URL.createObjectURL(gifUrl);
      isBlob = true;
    } else {
      url = gifUrl as string;
    }
    setInternalUrl(url);

    return () => {
      if (isBlob) {
        URL.revokeObjectURL(url);
      }
    };
  }, [gifUrl]);

  // Calculate optimal number of frames
  const calculatedFrames = useMemo(() => {
    const base = Math.max(1, Math.min(16, Math.ceil(width / 100)));
    const zoomMultiplier = Math.min(2.5, Math.max(1, zoom / 30));
    return Math.round(base * zoomMultiplier);
  }, [width, zoom]);

  const cacheKey = useMemo(
    () => `${internalUrl}-${width}-${height}-${calculatedFrames}`,
    [internalUrl, width, height, calculatedFrames]
  );

  // Memoize thumbnail dimensions
  const { thumbWidth, thumbHeight, spacing } = useMemo(() => {
    const spacing = Math.max(0.5, width / (calculatedFrames * 50));
    const thumbWidth =
      (width - (calculatedFrames - 1) * spacing) / calculatedFrames;
    const thumbHeight = height * 0.88;
    return { thumbWidth, thumbHeight, spacing };
  }, [width, height, calculatedFrames]);

  const generateThumbnails = useCallback(async () => {
    if (!internalUrl || width < 5) {
      setImages([]);
      return;
    }

    // Serve from cache if available
    if (thumbnailsCache.has(cacheKey)) {
      setImages(thumbnailsCache.get(cacheKey)!);
      return;
    }

    // Cancel any previous generation
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setIsGenerating(true);
    setImages([]);

    const myGenerationId = ++generationIdRef.current;

    try {
      const isLocal =
        internalUrl.startsWith("blob:") ||
        internalUrl.startsWith("data:") ||
        internalUrl.startsWith("file:");

      const fetchUrl = isLocal
        ? internalUrl
        : internalUrl.includes("?")
        ? `${internalUrl}&preview=1`
        : `${internalUrl}?preview=1`;

      const fetchOptions: RequestInit = {
        signal: abortControllerRef.current.signal,
      };

      if (!isLocal) {
        fetchOptions.mode = "cors";
        fetchOptions.credentials = "omit";
      }

      const response = await fetch(fetchUrl, fetchOptions);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const buffer = await response.arrayBuffer();

      if (
        generationIdRef.current !== myGenerationId ||
        abortControllerRef.current?.signal.aborted
      ) {
        return;
      }

      const gif = parseGIF(buffer);
      const frames = decompressFrames(gif, true);

      if (!frames || frames.length === 0) {
        console.warn("No frames found in GIF");
        setImages([]);
        setIsGenerating(false);
        return;
      }

      // Calculate step to extract evenly distributed frames
      const step = Math.max(1, Math.floor(frames.length / calculatedFrames));

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", {
        alpha: true,
        willReadFrequently: false,
      });

      if (!ctx) {
        setIsGenerating(false);
        return;
      }

      // Use higher resolution for better quality
      const scale = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = thumbWidth * scale;
      canvas.height = thumbHeight * scale;

      const thumbnails: HTMLImageElement[] = [];
      const batchSize = 3;

      // Process frames in batches
      for (
        let i = 0;
        i < frames.length && thumbnails.length < calculatedFrames;
        i += step
      ) {
        if (
          generationIdRef.current !== myGenerationId ||
          abortControllerRef.current?.signal.aborted
        ) {
          return;
        }

        const batch: Promise<HTMLImageElement | null>[] = [];

        for (
          let j = i;
          j < Math.min(i + step * batchSize, frames.length) &&
          thumbnails.length + batch.length < calculatedFrames;
          j += step
        ) {
          const frame = frames[j];

          batch.push(
            new Promise<HTMLImageElement | null>((resolve) => {
              try {
                // Create temporary canvas for this frame
                const tempCanvas = document.createElement("canvas");
                const tempCtx = tempCanvas.getContext("2d");
                if (!tempCtx) {
                  resolve(null);
                  return;
                }

                tempCanvas.width = frame.dims.width;
                tempCanvas.height = frame.dims.height;

                const imageData = tempCtx.createImageData(
                  frame.dims.width,
                  frame.dims.height
                );
                imageData.data.set(frame.patch);
                tempCtx.putImageData(imageData, 0, 0);

                // Scale and draw to main canvas
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                // Calculate aspect ratio fit
                const aspect = frame.dims.width / frame.dims.height;
                let drawW = thumbWidth * scale;
                let drawH = drawW / aspect;

                if (drawH > thumbHeight * scale) {
                  drawH = thumbHeight * scale;
                  drawW = drawH * aspect;
                }

                const dx = (canvas.width - drawW) / 2;
                const dy = (canvas.height - drawH) / 2;

                ctx.drawImage(tempCanvas, dx, dy, drawW, drawH);

                canvas.toBlob(
                  (blob) => {
                    if (!blob) {
                      resolve(null);
                      return;
                    }
                    const url = URL.createObjectURL(blob);
                    const img = new Image();
                    img.onload = () => {
                      const urls = objectUrlRegistry.get(cacheKey) || [];
                      urls.push(url);
                      objectUrlRegistry.set(cacheKey, urls);
                      resolve(img);
                    };
                    img.onerror = () => resolve(null);
                    img.src = url;
                  },
                  "image/png",
                  0.9
                );
              } catch (error) {
                console.warn("Error processing GIF frame:", error);
                resolve(null);
              }
            })
          );
        }

        const batchResults = await Promise.all(batch);
        const validResults = batchResults.filter(
          (img): img is HTMLImageElement => img !== null
        );
        thumbnails.push(...validResults);

        // Progressive rendering
        if (
          generationIdRef.current === myGenerationId &&
          !abortControllerRef.current?.signal.aborted
        ) {
          setImages([...thumbnails]);
        }
      }

      if (
        generationIdRef.current !== myGenerationId ||
        abortControllerRef.current?.signal.aborted
      ) {
        return;
      }

      thumbnailsCache.set(cacheKey, thumbnails);
      setImages(thumbnails);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error("Failed to generate GIF thumbnails:", err);
      }
      setImages([]);
    } finally {
      if (generationIdRef.current === myGenerationId) {
        setIsGenerating(false);
      }
    }
  }, [
    cacheKey,
    thumbHeight,
    internalUrl,
  ]);

  useEffect(() => {
    generateThumbnails();

    return () => {
      generationIdRef.current++;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [generateThumbnails]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const urls = objectUrlRegistry.get(cacheKey);
      if (urls) {
        urls.forEach((url) => URL.revokeObjectURL(url));
        objectUrlRegistry.delete(cacheKey);
      }
    };
  }, [cacheKey]);

  return (
    <Group>
      {/* Background subtle gradient */}
      <Rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="rgba(30, 58, 138, 0.15)"
        cornerRadius={4}
      />

      {/* Render thumbnails */}
      {images.map((img, i) => (
        <KonvaImage
          key={i}
          image={img}
          x={x + i * (thumbWidth + spacing) + spacing / 2}
          y={y + (height - thumbHeight) / 2}
          width={thumbWidth}
          height={thumbHeight}
          cornerRadius={4}
          shadowColor="rgba(0, 0, 0, 0.3)"
          shadowBlur={2}
          shadowOffsetY={1}
        />
      ))}

      {/* Loading indicator */}
      {isGenerating && images.length === 0 && (
        <Rect
          x={x + width / 2 - 20}
          y={y + height / 2 - 10}
          width={40}
          height={20}
          fill="rgba(255, 255, 255, 0.1)"
          cornerRadius={4}
        />
      )}
    </Group>
  );
};

export default GIFPreview;
