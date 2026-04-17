/**
 * MediaHub.tsx
 *
 * The media library panel for the timeline editor.  It lets the user:
 *  - Upload local files (video, audio, image, GIF, subtitle .srt/.vtt)
 *  - Add manual text clips via the TextModal
 *  - Browse and filter uploaded assets by type
 *  - Drag assets (mouse or touch) onto the timeline canvas to create clips
 *  - Delete assets (also removes any corresponding clips from the timeline)
 *
 * All media is handled client-side using Blob URLs — no backend upload is
 * performed.  A simulated progress animation gives users visual feedback
 * after files are processed.
 */
import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  memo,
} from "react";
import { useSelector, useDispatch } from "react-redux";
import {
  MediaItem,
  setDraggingType,
  addMediaItem,
  removeMediaItem,
  updateMediaItem,
  removeClipsByMediaItem,
} from "../../../redux/timelineSlice";

import ConfirmationDialog from "../../ui/ConfirmationDialog";
import TextModal from "../../timeline/components/TextModal";
import AlertModal from "../../ui/AlertModal";
import { v4 as uuidv4 } from "uuid";
import Masonry from "react-masonry-css";
import { RootState } from "../../../redux/store";
import { parseSrt, parseVtt } from "../../timeline/utils/subtitleParsing";

/** Props accepted by the top-level MediaHub component */
interface MediaHubProps {
  /** Called after a media item and its timeline clips have been removed */
  onDeleteMedia?: (name: string, type: string, id: string) => void;
}

/** Filter options for the media sidebar; "OTHERS" is reserved for future types */
type MediaFilter = "ALL" | "VIDEOS" | "AUDIO" | "IMAGES" | "TEXT" | "OTHERS";

// ─── Pure helpers (hoisted so they can be used inside the component) ─────────

/**
 * Maps a MediaItem type to the track type it should be dropped onto.
 * Audio → "audio" track, text/subtitles → "subtitle" track, everything else → "video".
 */
const mapToTrackType = (t: MediaItem["type"]) => {
  if (t === "audio") return "audio";
  if (t === "text") return "subtitle";
  return "video";
};

/** Returns an SVG icon element that visually represents the media type in the library card */
const getMediaIcon = (type: string) => {
  switch (type) {
    case "video":
      return (
        <svg
          className="w-6 h-6 text-slate-600 dark:text-slate-400"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
        </svg>
      );
    case "audio":
      return (
        <svg
          className="w-6 h-6 text-slate-600 dark:text-slate-400"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.617.816L4.383 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.383l4-3.816a1 1 0 011-.108zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z"
            clipRule="evenodd"
          />
        </svg>
      );
    case "image":
    case "gif":
      return (
        <svg
          className="w-6 h-6 text-slate-600 dark:text-slate-400"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
            clipRule="evenodd"
          />
        </svg>
      );
    case "text":
      return (
        <svg
          className="w-6 h-6 text-slate-600 dark:text-slate-400"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
            clipRule="evenodd"
          />
        </svg>
      );
    default:
      return (
        <svg
          className="w-6 h-6 text-slate-600 dark:text-slate-400"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
            clipRule="evenodd"
          />
        </svg>
      );
  }
};

/**
 * Returns a Tailwind class string for the background/border colour of a
 * library card.  Each media type gets a distinct subtle tint.
 * Note: some custom colour tokens (sage, taupe) may fall back to defaults
 * if they are not defined in the Tailwind config.
 */
const getMediaColor = (type: string) => {
  switch (type) {
    case "video":
      return "bg-sage-50 dark:bg-sage-900/50 border-sage-200 dark:border-sage-700 hover:bg-sage-100 dark:hover:bg-sage-800/50";
    case "audio":
      return "bg-taupe-50 dark:bg-taupe-900/50 border-taupe-200 dark:border-taupe-700 hover:bg-taupe-100 dark:hover:bg-taupe-800/50";
    case "image":
      return "bg-secondary-50 dark:bg-secondary-900/50 border-secondary-200 dark:border-secondary-700 hover:bg-secondary-100 dark:hover:bg-secondary-800/50";
    case "gif":
      return "bg-sage-50 dark:bg-sage-900/50 border-sage-200 dark:border-sage-700 hover:bg-sage-100 dark:hover:bg-sage-800/50";
    case "text":
      return "bg-accent-50 dark:bg-accent-900/50 border-accent-200 dark:border-accent-700 hover:bg-accent-100 dark:hover:bg-accent-800/50";
    default:
      return "bg-muted border-border hover:bg-muted/80";
  }
};

/**
 * Props for the individual card shown in the media library grid.
 * All drag/touch handlers are passed down from the parent so they share
 * the same refs and avoid creating new closures per item.
 */
interface MediaHubItemProps {
  media: MediaItem;
  /** Live upload progress entry; present while the file is being "uploaded" */
  uploadData: { progress: number; cloudinaryUrl?: string } | undefined;
  onDragStart: (media: MediaItem, e: React.DragEvent) => void;
  onTouchStart: (media: MediaItem, e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
  onTouchCancel: (e: React.TouchEvent) => void;
  onDelete: (mediaId: string, e: React.MouseEvent) => void;
  /** Optional DOM id used by the onboarding guide to reference the first item */
  id?: string;
}

/**
 * MediaHubItem
 *
 * A single draggable card in the media library.  Wraps the media in a
 * draggable container and overlays an upload-progress bar while the file
 * is being processed.
 *
 * Memoised so the masonry grid only re-renders cards whose data changed.
 */
const MediaHubItem: React.FC<MediaHubItemProps> = memo(
  ({
    media,
    uploadData,
    onDragStart,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
    onDelete,
    id,
  }) => {
    const isUploading = media.isUploading || uploadData;
    const itemRef = useRef<HTMLDivElement>(null);
    return (
      <div
        id={id}
        ref={itemRef}
        draggable={true}
        onDragStart={(e) => onDragStart(media, e)}
        onTouchStart={(e) => onTouchStart(media, e)}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
        style={{ touchAction: "none" }}
        className={` group p-2 rounded-lg border-2 cursor-move hover:shadow-md transition-all duration-200 hover:scale-[1.02] relative ${getMediaColor(
          media.type,
        )}`}
      >
        {isUploading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-background/80 backdrop-blur-sm border border-border shadow-sm px-3 z-[60]">
            <div className="w-full bg-muted rounded-full h-1.5 mb-2 overflow-hidden">
              <div
                className="bg-primary h-1.5 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${uploadData?.progress || 0}%` }}
              ></div>
            </div>
            <p className="text-[10px] font-bold text-primary uppercase tracking-wider">
              {uploadData?.progress && uploadData.progress < 100
                ? `${Math.round(uploadData.progress)}%`
                : "Processing..."}
            </p>
          </div>
        )}

        <div className="flex flex-col items-center">
          <button
            onClick={(e) => !isUploading && onDelete(media.id, e)}
            className={`absolute z-50 -top-2 left-[90%] -translate-x-1/2 -mb-8 transition-opacity duration-200 p-2 rounded-lg border-1 hidden group-hover:inline border-red-500 bg-red-900 hover:bg-red-800 text-red-500 hover:text-red-500 ${
              isUploading ? "opacity-0" : "opacity-0 group-hover:opacity-100"
            }`}
            title="Delete media"
            disabled={!!isUploading}
          >
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>

          {media.url ? (
            media.type === "image" || media.type === "gif" ? (
              <img
                src={media.url}
                alt={media.name}
                className="object-cover rounded"
              />
            ) : media.type === "video" ? (
              <video src={media.url} className="object-cover rounded" />
            ) : (
              <div className="w-6 h-8 flex items-center justify-center">
                {getMediaIcon(media.type)}
              </div>
            )
          ) : (
            <div className="w-6 h-8 flex items-center justify-center">
              {getMediaIcon(media.type)}
            </div>
          )}
          <p className="text-sm font-medium text-foreground truncate">
            {media.name.length > 15
              ? media.name.substring(0, 10) + "..."
              : media.name}
          </p>
        </div>
      </div>
    );
  },
);

/**
 * MediaHub
 *
 * Root component for the media library panel.  Connects to the Redux store
 * for the list of `mediaItems` and orchestrates:
 *  - File input + validation + processing (thumbnail generation, metadata)
 *  - Simulated upload progress (purely client-side, no network request)
 *  - Filtering the grid by media type
 *  - Mouse + touch drag-and-drop to the timeline canvas
 *  - Deletion with confirmation (also removes clips from the timeline)
 */
const MediaHub: React.FC<MediaHubProps> = ({ onDeleteMedia }) => {
  const dispatch = useDispatch();
  const { mediaItems } = useSelector((state: RootState) => state.timeline);

  // Active sidebar filter category
  const [activeFilter, setActiveFilter] = useState<MediaFilter>("ALL");

  // Global upload busy flag (used to disable the upload button during processing)
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Delete confirmation dialog state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [mediaToDelete, setMediaToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Text clip creation modal
  const [showTextModal, setShowTextModal] = useState(false);

  // Hidden <input type="file"> driven programmatically
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Per-item upload progress map: mediaId → { progress: 0-100 }
  // Drives the progress bar overlay on each MediaHubItem card
  const [uploadingFiles, setUploadingFiles] = useState<
    Map<string, { progress: number }>
  >(new Map());

  // Error alert modal state
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertMessage, setAlertMessage] = useState<string>("");
  const [alertTitle, setAlertTitle] = useState<string>("");

  // Upload confirmation modal (shows format info before opening file picker)
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Controls whether the filter sidebar is visible (auto-collapsed on small screens)
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Container ref used by the ResizeObserver to compute responsive masonry columns
  const masonryContainerRef = useRef<HTMLDivElement | null>(null);
  const [masonryCols, setMasonryCols] = useState<number>(3);

  // ─── Touch drag refs ──────────────────────────────────────────────────────────
  // Using refs (not state) so DOM mutations during drag don't trigger re-renders
  const dragCloneRef = useRef<HTMLElement | null>(null);                      // floating card clone
  const dragMediaRef = useRef<MediaItem | null>(null);                        // item being dragged
  const dragAnimationFrameRef = useRef<number | null>(null);                  // pending rAF id
  const lastTouchPosRef = useRef<{ x: number; y: number } | null>(null);      // latest finger coords

  const openErrorAlert = (message: string, title: string = "Upload failed") => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertOpen(true);
  };

  // Set sidebar state based on screen size
  useEffect(() => {
    const checkScreenSize = () => {
      if (window.innerWidth >= 550) {
        setSidebarOpen(true);
      } else {
        setSidebarOpen(false);
      }
    };

    // Check on mount
    checkScreenSize();

    // Add resize listener
    window.addEventListener("resize", checkScreenSize);

    // Cleanup
    return () => window.removeEventListener("resize", checkScreenSize);
  }, []);


  /** Returns the number of uploaded items of a specific type (used for filter badges) */
  const getMediaCountByType = (type: MediaItem["type"]): number => {
    return mediaItems.filter((item) => item.type === type).length;
  };

  // Compute Masonry columns based on parent container width, not viewport width
  useEffect(() => {
    const element = masonryContainerRef.current;
    if (!element) return;

    const computeColumns = () => {
      const width = element.clientWidth;
      let cols = 2;
      if (width >= 900) cols = 7;
      else if (width >= 600) cols = 5;
      else if (width >= 500) cols = 4;
      else if (width > 350) cols = 3;
      else if (width > 250) cols = 2;
      else cols = 1;
      setMasonryCols(cols);
    };

    computeColumns();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        computeColumns();
      });
      resizeObserver.observe(element);
    }

    const onWindowResize = () => computeColumns();
    window.addEventListener("resize", onWindowResize);

    return () => {
      window.removeEventListener("resize", onWindowResize);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, [sidebarOpen]);

  // ─── File Processing Pipeline ────────────────────────────────────────────────
  // Files flow through: validateFile → getMediaType → generateThumbnail +
  // getMediaMetadata (parallel) → processFile → handleFileUpload

  /**
   * Validates a file before processing.
   * Rejects files above 2 GB or with unsupported MIME types.
   * Subtitle files (.srt, .vtt) bypass the MIME check.
   */
  const validateFile = (file: File): { isValid: boolean; error?: string } => {
    const maxSize = 1024 * 1024 * 1024 * 2; // 2 GB
    const allowedTypes = {
      video: ["video/mp4", "video/webm", "video/ogg", "video/avi", "video/mov"],
      audio: [
        "audio/mp3",
        "audio/mpeg",
        "audio/wav",
        "audio/ogg",
        "audio/m4a",
        "audio/mp4",
      ],
      image: ["image/jpeg", "image/png", "image/gif", "image/webp"],
    };

    if (file.size > maxSize) {
      return { isValid: false, error: "file to large" };
    }

    // Allow subtitles by extension or MIME
    if (isSubtitleFile(file)) {
      return { isValid: true };
    }

    // Check MIME type
    const allAllowedTypes = [
      ...allowedTypes.video,
      ...allowedTypes.audio,
      ...allowedTypes.image,
    ];
    const isValidMimeType = allAllowedTypes.includes(file.type);

    // Additional check for MP3 files by extension (some browsers report different MIME types)
    const isMp3ByExtension =
      file.name.toLowerCase().endsWith(".mp3") &&
      file.type.startsWith("audio/");

    if (!isValidMimeType && !isMp3ByExtension) {
      console.log("File validation failed:", {
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
      });
      return {
        isValid: false,
        error: `Unsupported file type: ${file.type}. Supported types: video, audio (MP3, WAV, OGG, M4A), images (JPEG, PNG, GIF, WebP), subtitles (.srt, .vtt)`,
      };
    }

    return { isValid: true };
  };

  /** Returns true if the file is a subtitle file based on its extension or MIME type */
  const isSubtitleFile = (file: File) => {
    const name = file.name.toLowerCase();
    return (
      name.endsWith(".srt") ||
      name.endsWith(".vtt") ||
      file.type === "text/vtt" ||
      file.type === "application/x-subrip"
    );
  };

  /** Infers the MediaItem type from the file's MIME type or extension */
  const getMediaType = (file: File): MediaItem["type"] => {
    if (isSubtitleFile(file)) {
      return "text";
    }
    if (file.type.startsWith("video/")) {
      return file.type === "image/gif" ? "gif" : "video";
    }
    if (file.type.startsWith("audio/")) {
      return "audio";
    }
    if (file.type.startsWith("image/")) {
      return file.type === "image/gif" ? "gif" : "image";
    }
    return "image"; // fallback
  };

  /**
   * Generates a JPEG thumbnail data-URL for video and image files.
   * - Video: seeks to the midpoint (or 1 s max) and captures a frame via <canvas>
   * - Image: draws the image onto a <canvas> and exports at 70% quality
   * - Audio: resolves with an empty string (no thumbnail)
   *
   * All thumbnails are resized to a max width of 320 px to keep memory usage low.
   */
  const generateThumbnail = (
    file: File,
    type: MediaItem["type"],
  ): Promise<string> => {
    return new Promise((resolve) => {
      const MAX_WIDTH = 320;

      const resizeAndDraw = (
        source: CanvasImageSource,
        width: number,
        height: number,
        ctx: CanvasRenderingContext2D,
        canvas: HTMLCanvasElement,
      ) => {
        let newWidth = width;
        let newHeight = height;

        if (width > MAX_WIDTH) {
          const ratio = MAX_WIDTH / width;
          newWidth = MAX_WIDTH;
          newHeight = height * ratio;
        }

        canvas.width = newWidth;
        canvas.height = newHeight;
        ctx.drawImage(source, 0, 0, newWidth, newHeight);
        return canvas.toDataURL("image/jpeg", 0.7);
      };

      if (type === "video") {
        const video = document.createElement("video");
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        // Essential for programmatic access without user interaction
        video.muted = true;
        video.playsInline = true;
        video.crossOrigin = "anonymous";
        video.preload = "metadata";

        const onThumbnailReady = () => {
          video.onseeked = null;
          video.onerror = null;
          video.onloadeddata = null;

          if (ctx && video.videoWidth > 0 && video.videoHeight > 0) {
            resolve(
              resizeAndDraw(
                video,
                video.videoWidth,
                video.videoHeight,
                ctx,
                canvas,
              ),
            );
          } else {
            resolve("");
          }
        };

        video.onloadeddata = () => {
          // If video is loaded, try to seek
          video.currentTime = Math.min(
            1,
            video.duration > 0 ? video.duration / 2 : 0,
          );
        };

        video.onseeked = onThumbnailReady;

        video.onerror = (e) => {
          console.error("Error generating thumbnail for video:", e);
          resolve("");
        };

        // Timeout fallback
        setTimeout(() => {
          resolve("");
        }, 3000);

        video.src = URL.createObjectURL(file);
        video.load();
      } else if (type === "image" || type === "gif") {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (ctx) {
            resolve(resizeAndDraw(img, img.width, img.height, ctx, canvas));
          } else {
            resolve("");
          }
        };
        img.onerror = () => resolve("");
        img.src = URL.createObjectURL(file);
      } else {
        resolve(""); // No thumbnail for audio
      }
    });
  };

  /**
   * Extracts duration and audio-track information from a video or audio file.
   *
   * Audio detection for video files tries multiple APIs in priority order:
   *  1. captureStream() — most reliable modern method
   *  2. mozHasAudio     — Firefox legacy
   *  3. audioTracks     — IE/Edge legacy
   *  4. webkitAudioDecodedByteCount — WebKit/Blink positive signal
   *
   * Returns `hasAudio: undefined` if detection is inconclusive.
   */
  const getMediaMetadata = (
    file: File,
    type: MediaItem["type"],
  ): Promise<{ duration: number; hasAudio?: boolean; isAnimated: boolean }> => {
    return new Promise((resolve) => {
      const isAnimated = type === "video" || type === "gif";

      if (type === "video" || type === "audio") {
        const media = document.createElement(
          type === "video" ? "video" : "audio",
        );
        media.onloadedmetadata = () => {
          let hasAudio: boolean | undefined;

          if (type === "video") {
            const video = media as HTMLVideoElement;

            // Enhanced audio detection using captureStream (Option 2)
            // This is the most reliable modern method for checking audio tracks
            let detected = false;

            // 1. Try captureStream (Standard)
            const v = video as any;
            if (v.captureStream || v.mozCaptureStream) {
              try {
                const stream = v.captureStream
                  ? v.captureStream()
                  : v.mozCaptureStream();
                if (stream.getAudioTracks().length > 0) {
                  hasAudio = true;
                  detected = true;
                } else {
                  hasAudio = false; // Explicitly no audio found
                  detected = true;
                }
              } catch (e) {
                console.warn("Audio detection via captureStream failed:", e);
              }
            }

            // 2. Fallback to mozHasAudio (Firefox legacy)
            if (
              !detected &&
              typeof (video as any).mozHasAudio !== "undefined"
            ) {
              hasAudio = (video as any).mozHasAudio;
              detected = true;
            }
            // 3. Fallback to audioTracks (IE/Edge legacy or specific implementation)
            else if (
              !detected &&
              (video as any).audioTracks &&
              typeof (video as any).audioTracks.length === "number"
            ) {
              hasAudio = (video as any).audioTracks.length > 0;
              detected = true;
            }
            // 4. WebKit/Blink byte count (Strong positive signal)
            else if (
              !detected &&
              (video as any).webkitAudioDecodedByteCount > 0
            ) {
              hasAudio = true;
              detected = true;
            }

            // Default to undefined if we couldn't detect anything suitable for boolean
            // (TimelineEditor logic handles undefined by checking backend)
          } else {
            // Audio files definitely have audio
            hasAudio = true;
          }

          resolve({
            duration: media.duration,
            hasAudio,
            isAnimated: isAnimated,
          });
        };
        media.onerror = () => {
          resolve({
            duration: 0,
            hasAudio: type === "audio" ? true : undefined,
            isAnimated,
          });
        };
        media.src = URL.createObjectURL(file);
      } else {
        resolve({
          duration: 0,
          hasAudio: false,
          isAnimated: type === "gif",
        });
      }
    });
  };

  /**
   * Validates a file, extracts metadata, and builds a MediaItem object ready
   * to be added to the Redux store.  For subtitles, parses the SRT/VTT content
   * into a structured cues array and assigns a shared subtitleGroupId.
   *
   * Throws an Error if the file fails validation or exceeds the 3-hour limit.
   */
  const processFile = async (file: File): Promise<MediaItem> => {
    const validation = validateFile(file);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    const type = getMediaType(file);

    if (isSubtitleFile(file)) {
      const text = await file.text();
      const cues = file.name.toLowerCase().endsWith(".vtt")
        ? parseVtt(text)
        : parseSrt(text);
      const mediaItem: MediaItem = {
        id: `media-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: "text",
        name: `${uuidv4()}`,
        url: "",
        duration: undefined,
        thumbnail: undefined,
        isUploading: false,
        subtitles: cues,
        subtitleGroupId: uuidv4(), // Unique group ID per SRT/VTT file
      };
      return mediaItem;
    }

    const [thumbnail, metadata] = await Promise.all([
      generateThumbnail(file, type),
      getMediaMetadata(file, type),
    ]);

    if (metadata.duration > 10800) {
      throw new Error("video too long 3 hours");
    }
    const fileExtension = file.name.split(".").pop() || "bin";
    const safeName = `${uuidv4()}.${fileExtension}`;

    const mediaItem: MediaItem = {
      id: `media-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      name: safeName,
      url: URL.createObjectURL(file),
      duration:
        metadata.duration > 0 ? Math.round(metadata.duration) : undefined,
      thumbnail: thumbnail || undefined,
      isUploading: true,
      isAnimated: metadata.isAnimated,
      hasAudio: metadata.hasAudio,
    };

    return mediaItem;
  };

  /**
   * Entry point for file uploads.  Iterates over the FileList, processes each
   * file into a MediaItem (dispatching it to Redux immediately), then runs a
   * simulated progress animation (10 steps × 150 ms) before marking the item
   * as fully "uploaded" and clearing the progress overlay.
   */
  const handleFileUpload = async (files: FileList) => {
    setIsUploading(true);
    setUploadProgress(0);

    try {
      const fileArray = Array.from(files);
      const totalFiles = fileArray.length;

      // Process and add files
      const mediaItems: MediaItem[] = [];
      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        const mediaItem = await processFile(file);

        // Add to Redux store
        dispatch(addMediaItem(mediaItem));
        mediaItems.push(mediaItem);

        // Track this file for simulated progress
        if (!isSubtitleFile(file)) {
          setUploadingFiles(
            (prev) => new Map(prev.set(mediaItem.id, { progress: 0 })),
          );
        }
      }

      // Simulate upload progress for each media item
      for (const mediaItem of mediaItems) {
        if (mediaItem.type === "text") continue;

        // Simulate progress increments
        const steps = 10;
        for (let j = 1; j <= steps; j++) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          const progress = (j / steps) * 100;

          setUploadingFiles((prev) => {
            const newMap = new Map(prev);
            newMap.set(mediaItem.id, { progress });
            return newMap;
          });
        }

        // Finalize "upload"
        dispatch(
          updateMediaItem({
            id: mediaItem.id,
            updates: {
              isUploading: false,
            },
          }),
        );

        setUploadingFiles((prev) => {
          const newMap = new Map(prev);
          newMap.delete(mediaItem.id);
          return newMap;
        });
      }

      console.log("All local file 'uploads' completed");
    } catch (error) {
      console.error("Local upload error:", error);
      openErrorAlert(
        error instanceof Error ? error.message : "Error processing files",
      );
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  // Click to upload
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileUpload(files);
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  /**
   * Opens the delete confirmation dialog for the given media item.
   * Stops the click event from propagating to the draggable card.
   */
  const handleDeleteMedia = (mediaId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    setMediaToDelete(mediaId);
    setShowDeleteConfirm(true);
  };

  /**
   * Confirmed deletion flow:
   *  1. Revoke the Blob URL to free memory
   *  2. Remove all timeline clips referencing this media
   *  3. Remove the media item from the Redux store
   *  4. Call the optional onDeleteMedia callback (for parent-level cleanup)
   */
  const handleConfirmDelete = async () => {
    if (mediaToDelete) {
      setIsDeleting(true);

      const mediaItem = mediaItems.find((item) => item.id === mediaToDelete);

      if (mediaItem) {
        // If the media was using a blob URL, revoke it to free memory
        if (mediaItem.url && mediaItem.url.startsWith("blob:")) {
          URL.revokeObjectURL(mediaItem.url);
        }

        // Remove clips from timeline first
        dispatch(
          removeClipsByMediaItem({
            name: mediaItem.name,
            type: mediaItem.type,
            mediaId: mediaItem.id,
          }),
        );

        // Remove media item from library
        dispatch(removeMediaItem(mediaToDelete));

        if (onDeleteMedia) {
          onDeleteMedia(mediaItem.name, mediaItem.type, mediaItem.id);
        }
      }

      setMediaToDelete(null);
      setIsDeleting(false);
    }
    setShowDeleteConfirm(false);
  };

  const handleCancelDelete = () => {
    setMediaToDelete(null);
    setShowDeleteConfirm(false);
  };

  /**
   * Creates a plain text MediaItem from the content typed in TextModal.
   * Defaults to 10 s duration so it immediately gets a reasonable clip length
   * when dropped on the subtitle track.
   */
  const handleAddText = (textContent: string) => {
    const textItem: MediaItem = {
      id: `text-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: "text",
      name: `${textContent.substring(0, 20)}${
        textContent.length > 20 ? "..." : ""
      }`,
      url: "", // Text items don't have URLs
      textContent: textContent,
      duration: 10, // Default duration for text
    };
    dispatch(addMediaItem(textItem));
  };

  const handleTextModalOpen = () => {
    setShowTextModal(true);
  };

  const handleTextModalClose = () => {
    setShowTextModal(false);
  };

  const handleUploadModalOpen = () => {
    setShowUploadModal(true);
  };

  const handleUploadModalClose = () => {
    setShowUploadModal(false);
  };

  const handleUploadFromModal = () => {
    fileInputRef.current?.click();
    setShowUploadModal(false);
  };

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  /** Filters the mediaItems array to only those matching the active filter category */
  const filterMediaItems = (
    items: MediaItem[],
    filter: MediaFilter,
  ): MediaItem[] => {
    if (filter === "ALL") return items;

    switch (filter) {
      case "VIDEOS":
        return items.filter(
          (item) => item.type === "video" || item.type === "gif",
        );
      case "AUDIO":
        return items.filter((item) => item.type === "audio");
      case "IMAGES":
        return items.filter((item) => item.type === "image");
      case "TEXT":
        return items.filter((item) => item.type === "text");
      case "OTHERS":
        // Currently all types are covered, return empty array
        return [];
      default:
        return items;
    }
  };
  /**
   * Deduplicates the filtered list so that the same file URL or name is never
   * shown twice (e.g. after a Redux hot-reload or duplicate dispatch).
   * Subtitle items without a URL are keyed by name instead.
   */
  const filteredMediaItems = useMemo(() => {
    const items = filterMediaItems(mediaItems, activeFilter);
    const seen = new Set<string>();
    const result: MediaItem[] = [];
    for (const item of items) {
      // Use URL as primary key, fallback to name for items without URL (like subtitles)
      const key = (item.url || "").trim() || item.name;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
    return result;
  }, [mediaItems, activeFilter]);

  const filterButtons: { label: MediaFilter; icon: React.ReactNode }[] = [
    {
      label: "ALL",
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
            clipRule="evenodd"
          />
        </svg>
      ),
    },
    {
      label: "VIDEOS",
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
        </svg>
      ),
    },
    {
      label: "AUDIO",
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.617.816L4.383 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.383l4-3.816a1 1 0 011-.108zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z"
            clipRule="evenodd"
          />
        </svg>
      ),
    },
    {
      label: "IMAGES",
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
            clipRule="evenodd"
          />
        </svg>
      ),
    },
    {
      label: "TEXT",
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
            clipRule="evenodd"
          />
        </svg>
      ),
    },
    {
      label: "OTHERS",
      icon: (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
            clipRule="evenodd"
          />
        </svg>
      ),
    },
  ];

  /**
   * Mouse drag start: serialise the MediaItem as JSON on the DataTransfer object
   * and tell Redux which track type is being dragged (to highlight valid drop zones).
   */
  const handleMediaDrag = (media: MediaItem, e: React.DragEvent) => {
    const payload = JSON.stringify(media);
    e.dataTransfer.setData("application/json", payload);
    e.dataTransfer.setData("text/plain", payload);
    dispatch(setDraggingType(mapToTrackType(media.type)));
  };

  // ─── Touch drag handlers ─────────────────────────────────────────────────────
  // Touch dragging uses a floating DOM clone + synthetic DragEvent because the
  // native Drag-and-Drop API does not fire on touch devices.

  /**
   * Touch start: record the dragged item in a ref and create a floating clone
   * of the card that tracks the finger position.
   */
  const handleTouchStart = useCallback(
    (media: MediaItem, e: React.TouchEvent) => {
      const target = e.target as HTMLElement;

      // Allow interaction with buttons (like delete) without triggering drag
      if (target.closest("button")) {
        return;
      }

      // touch-action: none on the element handles preventing default scroll/zoom

      const touch = e.touches[0];
      const currentTarget = e.currentTarget as HTMLElement;

      // Set dragging type in Redux
      dispatch(setDraggingType(mapToTrackType(media.type)));

      // Store media data in ref instead of DOM attribute for performance
      dragMediaRef.current = media;

      // Create a visual clone for dragging feedback
      const clone = currentTarget.cloneNode(true) as HTMLElement;
      clone.style.position = "fixed";
      clone.style.pointerEvents = "none";
      clone.style.opacity = "0.8";
      clone.style.zIndex = "9999";
      // Center the clone on the touch point
      clone.style.left = `${touch.clientX - currentTarget.offsetWidth / 2}px`;
      clone.style.top = `${touch.clientY - currentTarget.offsetHeight / 2}px`;
      clone.style.width = `${currentTarget.offsetWidth}px`;
      clone.id = "touch-drag-clone"; // Keep ID for debugging/fallback

      document.body.appendChild(clone);
      dragCloneRef.current = clone;
      lastTouchPosRef.current = { x: touch.clientX, y: touch.clientY };
    },
    [dispatch],
  );

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    // If we're not dragging (e.g. user touched a button), don't prevent default
    if (!dragCloneRef.current) return;

    // touch-action: none handles preventing scroll

    const touch = e.touches[0];
    lastTouchPosRef.current = { x: touch.clientX, y: touch.clientY };

    // Use requestAnimationFrame for smooth visual updates
    if (dragAnimationFrameRef.current === null) {
      dragAnimationFrameRef.current = requestAnimationFrame(() => {
        if (dragCloneRef.current && lastTouchPosRef.current) {
          const clone = dragCloneRef.current;
          const { x, y } = lastTouchPosRef.current;
          clone.style.left = `${x - clone.offsetWidth / 2}px`;
          clone.style.top = `${y - clone.offsetHeight / 2}px`;
        }
        dragAnimationFrameRef.current = null;
      });
    }
  }, []);

  const cleanupDrag = useCallback(() => {
    // Cancel any pending animation frame
    if (dragAnimationFrameRef.current !== null) {
      cancelAnimationFrame(dragAnimationFrameRef.current);
      dragAnimationFrameRef.current = null;
    }

    // Remove the visual clone
    if (dragCloneRef.current) {
      dragCloneRef.current.remove();
      dragCloneRef.current = null;
    } else {
      // Fallback cleanup in case ref was lost but element exists
      const clone = document.getElementById("touch-drag-clone");
      if (clone) clone.remove();
    }

    // Clear dragging type
    dispatch(setDraggingType(null));
    dragMediaRef.current = null;
    lastTouchPosRef.current = null;
  }, [dispatch]);

  /**
   * Touch end: look up the element under the lifted finger.  If it is within
   * the timeline scroll container, dispatch a synthetic `drop` event that the
   * existing mouse-drop handler can process without special-casing touch.
   */
  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      // If not dragging (e.g. the user tapped a button), bail out early
      if (!dragMediaRef.current) return;

      const touch = e.changedTouches[0];
      const media = dragMediaRef.current;

      // Find the element at the touch position before cleanup
      const elementAtPoint = document.elementFromPoint(
        touch.clientX,
        touch.clientY,
      );

      if (elementAtPoint && media) {
        try {
          // Find the timeline container - look for the element with data-timeline-scroll attribute
          const timelineContainer = elementAtPoint.closest(
            '[data-timeline-scroll="true"]',
          ) as HTMLElement;

          if (timelineContainer) {
            // Create a synthetic drop event that the timeline can handle
            const dropEvent = new DragEvent("drop", {
              bubbles: true,
              cancelable: true,
              clientX: touch.clientX,
              clientY: touch.clientY,
            });

            // Set the data on the dataTransfer object
            Object.defineProperty(dropEvent, "dataTransfer", {
              value: {
                getData: (type: string) => {
                  if (type === "application/json" || type === "text/plain") {
                    return JSON.stringify(media);
                  }
                  return "";
                },
                setData: () => {},
                clearData: () => {},
                items: [],
                types: ["application/json", "text/plain"],
                files: [],
                dropEffect: "none",
                effectAllowed: "all",
              },
              writable: false,
              configurable: true,
            });

            timelineContainer.dispatchEvent(dropEvent);
          }
        } catch (error) {
          console.error("Error handling touch drop:", error);
        }
      }

      cleanupDrag();
    },
    [cleanupDrag],
  );

  const handleTouchCancel = useCallback(
    (e: React.TouchEvent) => {
      cleanupDrag();
    },
    [cleanupDrag],
  );

  return (
    <div className="h-full bg-card border border-border rounded-b-lg flex flex-col">
      {/* Media library content */}
      <div className=" flex-1 flex sm:flex-row overflow-y-auto">
        {/* Sidebar with filter buttons */}
        {sidebarOpen && (
          <div className="w-[30%] sm:w-[38%] bg-muted/30 border-b sm:border-b-0 sm:border-r border-border flex flex-col">
            <div className="flex-1 sm:p-2 ">
              <div className="flex flex-col overflow-x-auto">
                {filterButtons.map((button, index) => (
                  <button
                    key={button.label}
                    onClick={() => setActiveFilter(button.label)}
                    className={`w-full whitespace-nowrap flex-shrink-0 flex items-center h-[56px] sm:h-[53px] border-x-1 space-x-3 px-4 text-sm font-medium transition-all duration-200 ${
                      index === 0
                        ? " border-t-1"
                        : index === filterButtons.length - 1
                          ? "rounded-bl-lg border-b-1"
                          : "rounded-none"
                    } ${
                      activeFilter === button.label
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    }`}
                  >
                    {button.icon}
                    <span>{button.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Main content area */}
        <div className=" relative flex-1 flex flex-col mb-2">
          {/* Header with toggle button */}
          <div className="flex items-center justify-between px-2 py-2 border-b border-border">
            <div className="flex items-center space-x-2">
              <button
                onClick={toggleSidebar}
                className="p-2 hidden md:block rounded-md hover:bg-muted transition-colors"
                title={sidebarOpen ? "Hide filters" : "Show filters"}
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              </button>
              <span className="text-sm font-medium text-muted-foreground">
                {activeFilter} Media
              </span>
            </div>
            {!sidebarOpen && (
              <div className="flex space-x-1">
                {filterButtons.map((button) => (
                  <button
                    key={button.label}
                    onClick={() => setActiveFilter(button.label)}
                    className={`p-2 rounded-md text-xs font-medium transition-colors ${
                      activeFilter === button.label
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                    title={button.label}
                  >
                    {button.icon}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div
            ref={masonryContainerRef}
            className="flex-1 pt-4 px-2 overflow-y-hidden transition-colors"
          >
            <div className="h-full overflow-y-auto mb overflow-x-hidden">
              <Masonry
                breakpointCols={masonryCols}
                className="flex gap-1 p-1 mb-20"
                columnClassName="space-y-2"
              >
                {filteredMediaItems.map((media, index) => (
                  <MediaHubItem
                    key={media.id}
                    id={index === 0 ? "media-item-0" : undefined}
                    media={media}
                    uploadData={uploadingFiles.get(media.id)}
                    onDragStart={handleMediaDrag}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    onTouchCancel={handleTouchCancel}
                    onDelete={handleDeleteMedia}
                  />
                ))}
              </Masonry>
              {filteredMediaItems.length === 0 && !isUploading && (
                <div className="text-center w-full py-4 text-muted-foreground">
                  <p className="text-sm">
                    {activeFilter === "ALL"
                      ? "No media files uploaded"
                      : `No ${activeFilter.toLowerCase()} files found`}
                  </p>
                  <p className="text-xs mt-1">
                    {activeFilter === "ALL"
                      ? "Click Upload Media to add files"
                      : "Try uploading some media files or switch to a different category"}
                  </p>
                </div>
              )}
            </div>

            {/* Upload area or Add Text button */}
            {activeFilter === "TEXT" ? (
              <div className="absolute bottom-0 w-[95%] translate-x-[-50%] left-1/2 mt-2">
                <button
                  onClick={handleTextModalOpen}
                  className=" w-full px-2 py-1 border-2 border-dashed rounded-lg text-center transition-colors cursor-pointer border-border hover:border-primary/50 bg-muted hover:border-primary"
                >
                  <div className="flex items-center justify-center space-x-2">
                    <svg
                      className="w-8 h-8 text-slate-600 dark:text-slate-400"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <p className="text-sm text-foreground font-medium">
                      Add Text
                    </p>
                  </div>
                </button>
              </div>
            ) : (
              <div
                className="absolute bottom-0 z-10 w-[95%] translate-x-[-50%] left-1/2 mt-1 px-2 py-3 border-2 border-dashed rounded-lg text-center transition-colors cursor-pointer border-border hover:border-primary/50 bg-muted hover:border-primary"
                onClick={handleUploadModalOpen}
              >
                <div className="flex items-center justify-center space-x-2">
                  <svg
                    className="w-5 h-5 text-muted-foreground"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                  <p className="text-sm text-foreground">Upload Media</p>
                </div>
              </div>
            )}

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="video/*,audio/*,image/*,.mp3,.wav,.ogg,.m4a,.srt,.vtt,text/vtt,application/x-subrip"
              onChange={handleFileInputChange}
              className="hidden"
            />
          </div>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={showDeleteConfirm}
        onClose={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        title="Delete Media"
        message="Are you sure you want to delete this media file? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        isLoading={isDeleting}
      />

      {/* Text Modal */}
      <TextModal
        isOpen={showTextModal}
        onClose={handleTextModalClose}
        onAddText={handleAddText}
      />

      {/* Alert Modal */}
      <AlertModal
        open={alertOpen}
        onClose={() => setAlertOpen(false)}
        title={alertTitle}
        description={alertMessage}
        variant="error"
        actions={[
          {
            label: "OK",
            variant: "primary",
            onClick: () => setAlertOpen(false),
            autoFocus: true,
          },
        ]}
      />

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center">
          <div className="bg-background rounded-[40px] border-2 border-border p-6 max-w-md w-full mx-4 shadow-xl ">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">
                Upload Media Files
              </h3>
              <button
                onClick={handleUploadModalClose}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                <p className="mb-2">
                  Supports video, audio, images, GIFs, and subtitles (.srt,
                  .vtt)
                </p>
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={handleUploadModalClose}
                  className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUploadFromModal}
                  className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                >
                  Upload Files
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(MediaHub);
