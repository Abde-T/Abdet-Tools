import React, {
  useEffect,
  useState,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { Image as KonvaImage, Group, Rect } from "react-konva";

/**
 * VideoPreview.tsx
 *
 * Renders a strip of thumbnails for a video clip on the timeline.
 * Operates by loading the video into a hidden `<video>` element, seeking
 * through it at interval steps, drawing the frame to an offscreen canvas,
 * and saving it as an image blob.
 *
 * Uses `zoom` to dynamically determine how many thumbnails to generate.
 */
interface VideoPreviewProps {
  videoUrl: string | File | Blob;
  width: number;
  height: number;
  zoom?: number; // timeline zoom level
  clipDuration?: number;
  frames?: number;
}

const thumbnailsCache = new Map<string, HTMLImageElement[]>();
const objectUrlRegistry = new Map<string, string[]>();
const videoCache = new Map<string, HTMLVideoElement>();

const VideoPreview: React.FC<VideoPreviewProps> = ({
  videoUrl,
  width,
  height,
  zoom = 1,
  clipDuration,
  frames,
}) => {
  const [internalUrl, setInternalUrl] = useState<string>("");
  const [images, setImages] = useState<HTMLImageElement[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const generationIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let url = "";
    let isBlob = false;
    if (videoUrl instanceof File || videoUrl instanceof Blob) {
      url = URL.createObjectURL(videoUrl);
      isBlob = true;
    } else {
      url = videoUrl as string;
    }
    setInternalUrl(url);

    return () => {
      if (isBlob) {
        URL.revokeObjectURL(url);
      }
    };
  }, [videoUrl]);

  // Dynamically calculate frames based on zoom — higher zoom = more thumbnails
  const calculatedFrames = useMemo(() => {
    if (frames !== undefined) return frames;
    // Improved frame calculation for better performance
    const base = Math.max(1, Math.min(16, Math.ceil(width / 100)));
    const zoomMultiplier = Math.min(2.5, Math.max(1, zoom / 30));
    return Math.round(base * zoomMultiplier);
  }, [width, zoom, frames]);

  const cacheKey = useMemo(() => {
    return `${internalUrl}-${width}-${height}-${calculatedFrames}`;
  }, [internalUrl, width, height, calculatedFrames]);

  // Memoize thumbnail dimensions to avoid recalculation
  const { thumbWidth, thumbHeight, spacing } = useMemo(() => {
    const spacing = Math.max(0.5, width / (calculatedFrames * 50));
    const thumbWidth =
      (width - (calculatedFrames - 1) * spacing) / calculatedFrames;
    const thumbHeight = height * 0.88;
    return { thumbWidth, thumbHeight, spacing };
  }, [width, height, calculatedFrames]);

  const generateThumbnails = useCallback(async () => {
    if (width < 20) {
      setImages([]);
      return;
    }

    // Serve from cache
    if (thumbnailsCache.has(cacheKey)) {
      setImages(thumbnailsCache.get(cacheKey) || []);
      return;
    }

    // Cancel any previous generation
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setIsGenerating(true);
    setImages([]);

    if (!internalUrl) return;

    // Reuse or create video element
    let video = videoCache.get(internalUrl);
    if (!video) {
      video = document.createElement("video");
      video.src = internalUrl;
      const isLocal = internalUrl.startsWith("blob:") || internalUrl.startsWith("data:") || internalUrl.startsWith("file:");
      if (!isLocal) {
        video.crossOrigin = "anonymous";
      }
      video.muted = true;
      video.preload = "metadata";
      videoCache.set(internalUrl, video);
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", {
      alpha: false,
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
    ctx.scale(scale, scale);

    const myGenerationId = ++generationIdRef.current;

    try {
      // Wait for video metadata
      if (video.readyState < 1) {
        await new Promise<void>((resolve, reject) => {
          video!.onloadedmetadata = () => resolve();
          video!.onerror = () => reject(new Error("Failed to load video"));
          setTimeout(() => reject(new Error("Video load timeout")), 10000);
        });
      }

      const thumbnails: HTMLImageElement[] = [];
      const duration = clipDuration || video.duration;
      const step = duration / calculatedFrames;

      // Generate thumbnails in batches for better performance
      const batchSize = 3;
      for (let i = 0; i < calculatedFrames; i += batchSize) {
        if (
          generationIdRef.current !== myGenerationId ||
          abortControllerRef.current?.signal.aborted
        ) {
          return;
        }

        const batch = [];
        for (let j = i; j < Math.min(i + batchSize, calculatedFrames); j++) {
          batch.push(
            new Promise<HTMLImageElement | null>((resolve) => {
              video!.currentTime = j * step;

              const onSeeked = () => {
                video!.removeEventListener("seeked", onSeeked);

                try {
                  ctx.clearRect(0, 0, thumbWidth, thumbHeight);

                  const aspect = video!.videoWidth / video!.videoHeight;
                  let drawW = thumbWidth;
                  let drawH = drawW / aspect;
                  if (drawH > thumbHeight) {
                    drawH = thumbHeight;
                    drawW = drawH * aspect;
                  }
                  const dx = (thumbWidth - drawW) / 2;
                  const dy = (thumbHeight - drawH) / 2;

                  ctx.drawImage(video!, dx, dy, drawW, drawH);

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
                    "image/jpeg",
                    0.85
                  );
                } catch (error) {
                  console.warn("Error generating thumbnail:", error);
                  resolve(null);
                }
              };

              video!.addEventListener("seeked", onSeeked, { once: true });
            })
          );
        }

        const batchResults = await Promise.all(batch);
        thumbnails.push(
          ...batchResults.filter((img): img is HTMLImageElement => img !== null)
        );

        // Progressive rendering: update images after each batch
        if (generationIdRef.current === myGenerationId) {
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
    } catch (error) {
      console.warn("Failed to generate thumbnails:", error);
      setImages([]);
    } finally {
      if (generationIdRef.current === myGenerationId) {
        setIsGenerating(false);
      }
    }
  }, [
    cacheKey,
    calculatedFrames,
    width,
    height,
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
        x={0}
        y={0}
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
          x={i * (thumbWidth + spacing) + spacing / 2}
          y={(height - thumbHeight) / 2}
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
          x={width / 2 - 20}
          y={height / 2 - 10}
          width={40}
          height={20}
          fill="rgba(255, 255, 255, 0.1)"
          cornerRadius={4}
        />
      )}
    </Group>
  );
};

export default VideoPreview;
