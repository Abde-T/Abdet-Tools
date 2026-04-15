import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { LayoutMode } from "../Timeline";

/**
 * useTimelineLayout
 *
 * Manages the responsive dimensions and layout mode of the timeline editor.
 * The timeline has three layout modes ("default", "player_top", "library_top")
 * which rearrange the flex containers.
 *
 * Responsibilities:
 * - Listens for window resize events and tracks editor width.
 * - Computes the dynamic height of the timeline strip based on track counts.
 * - Handles the drag-split ratio for the middle library/player divider.
 * - Automatically falls back to "default" layout on narrow screens (<1024px).
 */
export function useTimelineLayout(tracks: any[]) {
  const [editorWidth, setEditorWidth] = useState<number>(1200);
  const [canvasSize, setCanvasSize] = useState({ width: 1200, height: 400 });
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("default");
  const [splitRatio, setSplitRatio] = useState<number>(30);
  const [isMobileLibraryOpen, setIsMobileLibraryOpen] = useState(false);

  const canvasContainerRef = useRef<HTMLDivElement>(null);

  const timelineHeight = useMemo(() => {
    const TRACK_GAP = 4;
    const RULER_HEIGHT = 40;
    const BOTTOM_PADDING = 60;
    const MAX_HEIGHT = window.innerWidth < 1200 ? 500 : 700;
    const MIN_HEIGHT = 320;

    const totalTrackHeight = tracks.reduce(
      (total: number, track: { height: number }) =>
        total + track.height + TRACK_GAP,
      0,
    );

    return Math.min(
      Math.max(MIN_HEIGHT, totalTrackHeight + RULER_HEIGHT + BOTTOM_PADDING),
      MAX_HEIGHT,
    );
  }, [tracks]);

  useEffect(() => {
    const updateSize = () => {
      if (canvasContainerRef.current) {
        const rect = canvasContainerRef.current.getBoundingClientRect();
        setCanvasSize({ width: rect.width, height: rect.height });
      }
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  const updateEditorWidth = useCallback(() => {
    const timerId = setTimeout(() => {
      let width = window.innerWidth;
      if (window.visualViewport) {
        width = Math.max(width, window.visualViewport.width);
      }
      setEditorWidth(Math.min(Math.max(width, 300), 1500));
    }, 100);

    return timerId;
  }, []);

  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout> | undefined;

    const debouncedUpdate = () => {
      clearTimeout(timerId);
      timerId = updateEditorWidth();
    };

    debouncedUpdate();

    window.addEventListener("resize", debouncedUpdate);
    window.addEventListener("orientationchange", debouncedUpdate);
    window.visualViewport?.addEventListener("resize", debouncedUpdate);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(debouncedUpdate);
      resizeObserver.observe(document.body);
    }

    return () => {
      clearTimeout(timerId);
      window.removeEventListener("resize", debouncedUpdate);
      window.removeEventListener("orientationchange", debouncedUpdate);
      window.visualViewport?.removeEventListener("resize", debouncedUpdate);
      resizeObserver?.disconnect();
    };
  }, [updateEditorWidth]);

  useEffect(() => {
    const resetOnSmallScreen = () => {
      if (window.innerWidth < 1024) {
        setLayoutMode((prev: LayoutMode) =>
          prev !== "default" ? "default" : prev,
        );
      }
    };
    resetOnSmallScreen();
    window.addEventListener("resize", resetOnSmallScreen);
    return () => window.removeEventListener("resize", resetOnSmallScreen);
  }, []);

  return {
    editorWidth,
    canvasSize,
    layoutMode,
    setLayoutMode,
    splitRatio,
    setSplitRatio,
    isMobileLibraryOpen,
    setIsMobileLibraryOpen,
    canvasContainerRef,
    timelineHeight,
  };
}
