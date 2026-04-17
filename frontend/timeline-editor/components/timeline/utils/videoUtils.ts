/**
 * videoUtils.ts
 * 
 * High-performance video frame extraction and stitching utilities.
 * Used for generating timeline thumbnails and preview strips.
 */

export interface VideoFrameExtractionOptions {
  interval: number; // seconds between frames
  maxFrames?: number; // maximum number of frames to extract
  quality?: number; // JPEG quality (0-1)
  width?: number; // target width for frames
  height?: number; // target height for frames
}

export interface VideoFrameData {
  timestamp: number; // time in seconds
  dataUrl: string; // base64 data URL
}

/**
 * Extract thumbnail frames from a video at specified intervals
 * @param src - Video source URL
 * @param options - Extraction options
 * @returns Promise<VideoFrameData[]> - Array of frame data with timestamps
 */
export async function extractVideoFrames(
  src: string,
  options: VideoFrameExtractionOptions,
): Promise<VideoFrameData[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "metadata";
    video.muted = true; // Mute to avoid audio issues

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Could not get canvas context"));
      return;
    }

    const frames: VideoFrameData[] = [];
    const {
      interval,
      maxFrames = 50,
      quality = 0.8,
      width = 160,
      height = 90,
    } = options;

    video.onloadedmetadata = () => {
      const duration = video.duration;
      if (!isFinite(duration) || duration <= 0) {
        reject(new Error("Invalid video duration"));
        return;
      }

      // Calculate frame extraction points
      const extractionPoints: number[] = [];
      for (let time = 0; time < duration; time += interval) {
        extractionPoints.push(Math.min(time, duration - 0.1)); // Ensure we don't exceed duration
        if (extractionPoints.length >= maxFrames) break;
      }

      // If we have very few frames, add some at the end
      if (extractionPoints.length < 3 && duration > 0) {
        extractionPoints.push(duration * 0.5);
        extractionPoints.push(duration * 0.9);
      }

      let currentFrameIndex = 0;

      const extractFrame = () => {
        if (currentFrameIndex >= extractionPoints.length) {
          resolve(frames);
          return;
        }

        const targetTime = extractionPoints[currentFrameIndex];
        video.currentTime = targetTime;
      };

      video.onseeked = () => {
        // Set canvas dimensions
        canvas.width = width;
        canvas.height = height;

        // Draw video frame to canvas
        ctx.drawImage(video, 0, 0, width, height);

        // Convert to base64
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        frames.push({
          timestamp: video.currentTime,
          dataUrl,
        });

        currentFrameIndex++;
        extractFrame();
      };

      video.onerror = () => {
        reject(new Error("Failed to load video"));
      };

      // Start extraction
      extractFrame();
    };

    video.onerror = () => {
      reject(new Error("Failed to load video metadata"));
    };

    video.src = src;
  });
}

/**
 * Calculate optimal frame extraction interval based on zoom level and clip duration
 * @param zoom - Timeline zoom level (pixels per second)
 * @param duration - Clip duration in seconds
 * @param minInterval - Minimum interval between frames (default: 0.5s)
 * @param maxInterval - Maximum interval between frames (default: 5s)
 * @returns Optimal interval in seconds
 */
export function calculateFrameInterval(
  zoom: number,
  duration: number,
  minInterval: number = 0.5,
  maxInterval: number = 5,
): number {
  // Base interval on zoom level - more zoomed in = more frames
  const baseInterval = Math.max(0.1, 100 / zoom); // 100 pixels = 1 second at 100px/s zoom

  // Clamp to min/max bounds
  const interval = Math.max(minInterval, Math.min(maxInterval, baseInterval));

  // Ensure we don't extract too many frames for very long videos
  const maxFrames = Math.min(50, Math.ceil(duration / interval));
  const adjustedInterval = duration / maxFrames;

  return Math.max(minInterval, adjustedInterval);
}

/**
 * Create a single stitched image from multiple video frames
 * @param frames - Array of frame data
 * @param targetWidth - Target width for the stitched image
 * @param targetHeight - Target height for the stitched image
 * @returns Promise<string> - Base64 data URL of stitched image
 */
export async function stitchVideoFrames(
  frames: VideoFrameData[],
  targetWidth: number,
  targetHeight: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (frames.length === 0) {
      reject(new Error("No frames to stitch"));
      return;
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Could not get canvas context"));
      return;
    }

    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const frameWidth = targetWidth / frames.length;
    let loadedFrames = 0;

    const onFrameLoad = () => {
      loadedFrames++;
      if (loadedFrames === frames.length) {
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      }
    };

    frames.forEach((frame, index) => {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, index * frameWidth, 0, frameWidth, targetHeight);
        onFrameLoad();
      };
      img.onerror = () => {
        // Draw a placeholder for failed frames
        ctx.fillStyle = "#333";
        ctx.fillRect(index * frameWidth, 0, frameWidth, targetHeight);
        onFrameLoad();
      };
      img.src = frame.dataUrl;
    });
  });
}

/**
 * Cache for storing extracted video frames
 */
class VideoFrameCache {
  private cache = new Map<string, VideoFrameData[]>();
  private maxSize = 100; // Maximum number of videos to cache

  set(src: string, frames: VideoFrameData[]): void {
    // Remove oldest entries if cache is full
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(src, frames);
  }

  get(src: string): VideoFrameData[] | undefined {
    return this.cache.get(src);
  }

  has(src: string): boolean {
    return this.cache.has(src);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

export const videoFrameCache = new VideoFrameCache();

export const extractPublicId = (input: string): string | null => {
  if (!input) {
    return null;
  }

  try {
    const url = new URL(input);
    let path = url.pathname.replace(/^\/+/, "");

    // Backblaze URLs include /file/<bucket>/<key>
    if (path.startsWith("file/")) {
      const [, , ...keyParts] = path.split("/");
      path = keyParts.join("/");
    }

    return path || null;
  } catch {
    // Fallback if input is already a key (no protocol)
    const normalized = input.replace(/^\/+/, "");
    return normalized || null;
  }
};

/**
 * Checks if a video has an audio track using browser APIs
 * @param src - Video source URL
 * @returns Promise<boolean> - True if audio track exists
 */
export async function checkVideoHasAudio(src: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "metadata";
    video.muted = true;

    video.onloadedmetadata = () => {
      // Option 2: Use captureStream or mozHasAudio/webkitAudioDecodedByteCount
      const v = video as any;
      if (v.mozHasAudio !== undefined) {
        resolve(v.mozHasAudio);
        return;
      }

      if (v.webkitAudioDecodedByteCount !== undefined) {
        // This might require playing a bit, so robust checks usually prefer captureStream for immediate check
        // But captureStream is standard.
      }

      if (v.captureStream || v.mozCaptureStream) {
        try {
          const stream = v.captureStream
            ? v.captureStream()
            : v.mozCaptureStream();
          const audioTracks = stream.getAudioTracks();
          resolve(audioTracks.length > 0);
        } catch (e) {
          console.warn("captureStream failed", e);
          resolve(false); // Fallback assumption
        }
      } else {
        // Fallback for very old browsers (unlikely in this stack)
        resolve(false);
      }
    };

    video.src = src;
  });
}

/**
 * Get duration of media (video or audio) using browser APIs
 * @param src - Media source URL
 * @returns Promise<number> - Duration in seconds
 */
export async function getMediaDuration(src: string): Promise<number> {
  return new Promise((resolve) => {
    const isAudio =
      src.match(/\.(mp3|wav|ogg|m4a|aac)$/i) || src.includes("audio");
    const media = isAudio
      ? document.createElement("audio")
      : document.createElement("video");

    media.crossOrigin = "anonymous";
    media.preload = "metadata";
    media.onloadedmetadata = () => {
      resolve(media.duration || 0);
    };
    media.onerror = () => {
      console.warn("Failed to get media duration for:", src);
      resolve(0);
    };
    media.src = src;

    // Safety timeout
    setTimeout(() => resolve(0), 10000);
  });
}
