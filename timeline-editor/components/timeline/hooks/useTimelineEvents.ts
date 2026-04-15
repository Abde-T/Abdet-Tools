import { useEffect, useRef } from "react";
import {
  togglePlayback,
  updateVideoClipThumbnails,
} from "../../../redux/timelineSlice";
import type { AppDispatch } from "../../../redux/store";

/**
 * useTimelineEvents
 *
 * Centralises global event listeners for the timeline interface:
 *
 * 1. Custom DOM Events:
 *    Listens for events dispatched from the canvas (e.g. `open-media-styling`)
 *    and switches the active panel tab to the appropriate styling panel.
 *
 * 2. Keyboard Shortcuts:
 *    Listens for "Space" bar to toggle playback, ignoring inputs if the user
 *    is currently typing in a text field or contenteditable element.
 *
 * 3. Thumbnail Regeneration:
 *    Monitors the zoom level. If the zoom changes by more than 20%, it dispatches
 *    Redux actions to regenerate video/GIF thumbnails at the new resolution.
 */
interface UseTimelineEventsProps {
  dispatch: AppDispatch;
  setSelectedTextClipId: (id: string | null) => void;
  setShowSubtitleStyling: (show: boolean) => void;
  setShowTextStyling: (show: boolean) => void;
  setShowMediaStyling: (show: boolean) => void;
  setActiveTab: (tab: any) => void;
  setSelectedMediaClipId: (id: string | null) => void;
  setIsMobileLibraryOpen: (show: boolean) => void;

  // Thumbnail regen dependencies
  zoom: number;
  clips: Record<string, any>;
  mediaItems: any[];
  tracks: any[];
}

export function useTimelineEvents({
  dispatch,
  setSelectedTextClipId,
  setShowSubtitleStyling,
  setShowTextStyling,
  setShowMediaStyling,
  setActiveTab,
  setSelectedMediaClipId,
  setIsMobileLibraryOpen,
  zoom,
  clips,
  mediaItems,
  tracks,
}: UseTimelineEventsProps) {
  /**
   * Listen for custom DOM events indicating a styling panel should be opened.
   */
  useEffect(() => {
    const onOpenSubtitleStyling = (e: any) => {
      const clipId = e?.detail?.clipId as string | undefined;
      if (clipId) setSelectedTextClipId(clipId);
      setShowSubtitleStyling(true);
      setShowTextStyling(false);
      setShowMediaStyling(false);
      setActiveTab("subtitle-styling");
    };

    const onOpenTextStyling = (e: any) => {
      const clipId = e?.detail?.clipId as string | undefined;
      if (clipId) setSelectedTextClipId(clipId);
      setShowTextStyling(true);
      setShowSubtitleStyling(false);
      setShowMediaStyling(false);
      setActiveTab("text-styling");
    };

    const onOpenMediaStyling = (e: any) => {
      const clipId = e?.detail?.clipId as string | undefined;
      if (clipId) setSelectedMediaClipId(clipId);
      setShowMediaStyling(true);
      setShowTextStyling(false);
      setShowSubtitleStyling(false);
      setActiveTab("media-styling");
    };

    const onToggleMediaLibrary = () => setIsMobileLibraryOpen(true);

    window.addEventListener(
      "open-subtitle-styling",
      onOpenSubtitleStyling as any,
    );
    window.addEventListener("open-text-styling", onOpenTextStyling as any);
    window.addEventListener("open-media-styling", onOpenMediaStyling as any);
    document.addEventListener(
      "toggle-media-library",
      onToggleMediaLibrary as any,
    );

    return () => {
      window.removeEventListener(
        "open-subtitle-styling",
        onOpenSubtitleStyling as any,
      );
      window.removeEventListener("open-text-styling", onOpenTextStyling as any);
      window.removeEventListener(
        "open-media-styling",
        onOpenMediaStyling as any,
      );
      document.removeEventListener(
        "toggle-media-library",
        onToggleMediaLibrary as any,
      );
    };
  }, [
    setSelectedTextClipId,
    setShowSubtitleStyling,
    setShowTextStyling,
    setShowMediaStyling,
    setActiveTab,
    setSelectedMediaClipId,
    setIsMobileLibraryOpen,
  ]);

  /**
   * Keyboard shortcuts (Space = Play/Pause)
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable
      ) {
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        dispatch(togglePlayback());
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dispatch]);

  /**
   * Watch the zoom level and automatically request thumbnail regeneration
   * if the zoom level changes by more than 20%.
   */
  const lastZoomRef = useRef(zoom);

  useEffect(() => {
    const ZOOM_THRESHOLD = 0.2; // 20% change required to trigger refresh
    const zoomChangeFraction =
      Math.abs(zoom - lastZoomRef.current) / lastZoomRef.current;

    if (zoomChangeFraction > ZOOM_THRESHOLD) {
      Object.values(clips).forEach((clip: any) => {
        if ((clip.type === "video" || clip.type === "gif") && clip.thumbnails) {
          const mediaItem = mediaItems.find(
            (m) =>
              m.id === clip.mediaId ||
              (m.name === clip.name && m.type === clip.type),
          );

          if (mediaItem) {
            const duration = clip.duration; // Or pass liveDurationOverrides if needed
            dispatch(
              updateVideoClipThumbnails({
                clipId: clip.id,
                videoUrl: mediaItem.url,
                zoom,
                duration,
              }),
            );
          }
        }
      });
      lastZoomRef.current = zoom;
    }
  }, [zoom, clips, mediaItems, tracks, dispatch]);
}
