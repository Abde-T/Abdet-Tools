import React, { useRef, useMemo, useCallback, useEffect } from "react";
import { hexToRgb } from "../utils/PlayerMath";

/**
 * ChromaKeyCanvas
 *
 * Renders a video frame or static image with a software chroma-key (green
 * screen) effect applied in real time on a 2D canvas.
 *
 * Algorithm (per-pixel):
 *  1. Draw the source (image or current video frame) onto a canvas
 *  2. Read back the pixel data with `getImageData`
 *  3. For each pixel, compute the Euclidean distance in RGB space from the
 *     chosen key colour
 *  4. Normalise the distance against the maximum possible (√3 × 255)
 *  5. Pixels within `similarity` → fully transparent (alpha = 0)
 *     Pixels in the narrow `blend` fringe → partially transparent (smooth edge)
 *     All other pixels → fully opaque (alpha = 255)
 *
 * For **images**: processes once on load, then repaints on every animation
 * frame so live changes to `color`/`similarity`/`blend` take effect instantly.
 *
 * For **videos**: taps into the existing <video> element via a ref and repaints
 * every frame as the video plays.
 *
 * > Note: `getImageData` requires same-origin media (or CORS headers).
 * > A SecurityError is caught and logged if cross-origin access fails.
 *
 * @param src        - image URL (ignored when `isVideo` is true)
 * @param isVideo    - true when processing a <video> element
 * @param videoRef   - ref to the <video> element (required when `isVideo` is true)
 * @param color      - hex key colour (e.g. "#00ff00" for green screen)
 * @param similarity - colour match threshold 0.0–0.5; maps to FFmpeg chromakey `similarity`
 * @param blend      - edge feathering width 0.0–1.0; maps to FFmpeg chromakey `blend`
 */
export const ChromaKeyCanvas: React.FC<{
  src: string;
  isVideo?: boolean;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  color: string;
  similarity: number;
  blend: number;
  style?: React.CSSProperties;
  className?: string;
  onLoad?: () => void;
}> = ({
  src,
  isVideo = false,
  videoRef,
  color,
  similarity,
  blend,
  style,
  className,
  onLoad,
}) => {
  const canvasRef         = useRef<HTMLCanvasElement>(null);
  const imageRef          = useRef<HTMLImageElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Parse the hex key colour once; recalculate only when the colour prop changes
  const keyColor = useMemo(() => {
    const rgb = hexToRgb(color);
    return rgb || { r: 0, g: 255, b: 0 }; // default: pure green
  }, [color]);

  /**
   * applyChromaKey
   *
   * Core pixel-processing function.  Draws the source element onto the canvas,
   * reads the pixel buffer, and sets the alpha channel of keyed pixels.
   * Re-created via `useCallback` only when `keyColor`, `similarity`, or `blend` change.
   */
  const applyChromaKey = useCallback(
    (image: HTMLImageElement | HTMLVideoElement) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      // `willReadFrequently: true` hints to the browser to optimise for repeated
      // `getImageData` calls (uses a CPU-readable pixel buffer path)
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      const width =
        (image as HTMLVideoElement).videoWidth ||
        image.width ||
        (image as HTMLImageElement).naturalWidth ||
        0;
      const height =
        (image as HTMLVideoElement).videoHeight ||
        image.height ||
        (image as HTMLImageElement).naturalHeight ||
        0;

      if (width === 0 || height === 0) return;

      // Resize the canvas to match the source resolution (only when it changes)
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width  = width;
        canvas.height = height;
      }

      ctx.drawImage(image, 0, 0, width, height);

      try {
        const imageData = ctx.getImageData(0, 0, width, height);
        const data      = imageData.data;

        const maxDist = Math.sqrt(3 * 255 * 255); // theoretical maximum RGB distance
        const sim     = Math.max(0, Math.min(1, similarity));
        const bl      = Math.max(0, Math.min(1, blend));
        const keyR    = keyColor.r;
        const keyG    = keyColor.g;
        const keyB    = keyColor.b;

        // Process each pixel (4 bytes: R, G, B, A)
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          // Euclidean distance from the key colour in RGB space
          const distance = Math.sqrt(
            (r - keyR) * (r - keyR) +
            (g - keyG) * (g - keyG) +
            (b - keyB) * (b - keyB),
          );
          const dNorm = distance / maxDist; // normalise to 0–1

          if (dNorm <= sim) {
            // Fully inside the key zone → transparent
            data[i + 3] = 0;
          } else if (bl > 0 && dNorm <= sim + bl) {
            // In the blend fringe → partially transparent (linear ramp)
            const t       = (dNorm - sim) / bl;
            const alpha   = Math.max(0, Math.min(255, t * 255));
            data[i + 3]  = alpha;
          } else {
            // Outside the key zone → fully opaque
            data[i + 3] = 255;
          }
        }

        ctx.putImageData(imageData, 0, 0);
      } catch (error) {
        if (error instanceof DOMException && error.name === "SecurityError") {
          console.warn(
            "ChromaKey: CORS error - cannot read pixel data from cross-origin media.",
          );
        } else {
          console.error("ChromaKey error:", error);
        }
        return;
      }
    },
    [keyColor, similarity, blend],
  );

  // ── Image mode: load once, repaint on every animation frame ───────────────
  useEffect(() => {
    if (isVideo) return;

    const img        = new window.Image();
    img.crossOrigin  = "anonymous"; // required for getImageData to work
    img.onload       = () => {
      imageRef.current = img;
      const loop = () => {
        if (!imageRef.current) return;
        applyChromaKey(imageRef.current);
        animationFrameRef.current = requestAnimationFrame(loop);
      };
      loop();
      onLoad?.();
    };
    img.src = src;

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      imageRef.current = null;
    };
  }, [src, isVideo, applyChromaKey, onLoad]);

  // ── Video mode: repaint on every animation frame as the video plays ───────
  useEffect(() => {
    if (!isVideo || !videoRef?.current) return;

    const video = videoRef.current;

    const updateFrame = () => {
      // `readyState >= 2` means the browser has enough data to render a frame
      if (video.readyState >= 2) {
        applyChromaKey(video);
      }
      animationFrameRef.current = requestAnimationFrame(updateFrame);
    };

    // Also kick off the loop when video data becomes ready (handles late-loading videos)
    const handleLoadedData = () => { updateFrame(); };
    video.addEventListener("loadeddata", handleLoadedData);
    updateFrame();

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      video.removeEventListener("loadeddata", handleLoadedData);
    };
  }, [isVideo, videoRef, applyChromaKey]);

  return (
    <canvas
      ref={canvasRef}
      data-clip-id={isVideo ? undefined : src}
      style={{
        ...style,
        width: "100%",
        height: "100%",
        objectFit: "fill",
      }}
      className={className}
    />
  );
};
