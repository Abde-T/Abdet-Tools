import React, { useState, useRef, useEffect } from "react";
import { Clip, showResizeGuidelines } from "../../../redux/timelineSlice";
import { updateClip } from "../../../redux/timelineSlice";

/**
 * useCanvasInteraction
 *
 * Handles direct manipulation of clips on the player canvas: drag to move and
 * edge-drag to resize.  All interactions work with both mouse and touch events.
 *
 * ## Architecture
 *
 * There are two parallel state layers:
 *
 *  1. **Local `mediaTransforms` state** – updated on every mouse/touch move
 *     (via rAF) for smooth visual feedback.  This drives what the user sees.
 *
 *  2. **Redux `updateClip`** – only dispatched every `REDUX_UPDATE_INTERVAL`
 *     frames (currently 3) plus once on pointer-up so the store always has
 *     the final position.  This prevents Redux from becoming a bottleneck
 *     during a fast drag.
 *
 * ## Resize types
 *
 *  - "move"   – translate x/y; snaps to 0 %, 50 %, 100 % (±2 %) and keeps
 *               the clip center inside the canvas bounds
 *  - "width"  – resize width; maintains aspect ratio for visual media
 *  - "height" – resize height; maintains aspect ratio for visual media
 *  - "both"   – uniform scale from a corner handle; maintains aspect ratio
 *
 * ## Aspect ratio
 *
 * For video, image, and GIF clips, the aspect ratio is stored per-clip in
 * `aspectRatioByClipRef` (populated by ClipRenderer when the media loads).
 * Width resizes compute the new height as `width * (containerRatio / ar)` so
 * the clip never distorts.
 *
 * @param clips                - all clips from the Redux store
 * @param resizeGuidelines     - Redux state indicating which clip has handles visible
 * @param aspectRatioByClipRef - ref map of clipId → natural aspect ratio (width / height)
 * @param dispatch             - Redux dispatch
 */
export const useCanvasInteraction = ({
  clips,
  resizeGuidelines,
  aspectRatioByClipRef,
  dispatch,
}: {
  clips: Record<string, Clip>;
  resizeGuidelines: { isVisible: boolean; clipId: string | null };
  aspectRatioByClipRef: React.MutableRefObject<Map<string, number>>;
  dispatch: any;
}) => {
  const [isResizing, setIsResizing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0 });
  const [resizeType, setResizeType] = useState<"width" | "height" | "both" | "move" | null>(null);

  // Local transform state — drives visual position without waiting for Redux round-trips
  const [mediaTransforms, setMediaTransforms] = useState<
    Record<string, { x: number; y: number; width: number; height: number; scaleX: number; scaleY: number }>
  >({});

  const animationFrameRef    = useRef<number | null>(null);
  const containerSizeRef     = useRef<{ width: number; height: number }>({ width: 400, height: 300 });
  const reduxUpdateFrameCountRef = useRef<number>(0);

  // Dispatch to Redux every N frames rather than every move event
  const REDUX_UPDATE_INTERVAL = 3;

  // Buffers the last computed transform so we can flush it to Redux at pointer-up
  const pendingReduxUpdateRef = useRef<{
    clipId: string;
    transform: { x: number; y: number; width: number; height: number };
  } | null>(null);

  // The clip that currently has resize handles showing (null if none)
  const resizeClip = resizeGuidelines.isVisible && resizeGuidelines.clipId
    ? clips[resizeGuidelines.clipId]
    : null;

  /**
   * Returns the current canvas transform for a clip, falling back to the
   * "full-canvas, centered" default if it hasn't been moved yet.
   */
  const getClipTransform = (clipId: string) => {
    return (
      mediaTransforms[clipId] || {
        x: 50,      // center x (canvas %)
        y: 50,      // center y (canvas %)
        width: 100, // full width (canvas %)
        height: 100,
        scaleX: 1,
        scaleY: 1,
      }
    );
  };

  /**
   * handleResizeStart
   *
   * Called on mousedown / touchstart on a resize handle or the clip body.
   * Records the pointer origin and the canvas container dimensions (needed
   * to convert pixel deltas to percentage coordinates).
   *
   * @param type               - which dimension is being manipulated
   * @param aspectContainerRef - ref to the player canvas container element
   */
  const handleResizeStart = (
    e: React.MouseEvent | React.TouchEvent,
    type: "width" | "height" | "both" | "move",
    aspectContainerRef: React.RefObject<HTMLDivElement | null>,
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const clientX = "touches" in e && e.touches.length > 0 ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = "touches" in e && e.touches.length > 0 ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

    if (type === "move") {
      setIsDragging(true);
    } else {
      setIsResizing(true);
    }

    setResizeType(type);
    setResizeStart({ x: clientX, y: clientY });

    // Snapshot the container dimensions at drag start; these won't change mid-drag
    if (aspectContainerRef.current) {
      const rect = aspectContainerRef.current.getBoundingClientRect();
      containerSizeRef.current = {
        width:  rect.width  || 400,
        height: rect.height || 300,
      };
    }
  };

  /**
   * handleResizeMove
   *
   * Called on document mousemove / touchmove while a drag is in progress.
   * All DOM writes are deferred to a requestAnimationFrame callback to avoid
   * layout thrashing, and Redux is only updated every REDUX_UPDATE_INTERVAL frames.
   *
   * Snap zones (move only): the center point snaps to 0 %, 50 %, and 100 %
   * of each axis within a ±2 % threshold, and alignment guidelines are shown
   * via the Redux `showResizeGuidelines` action.
   */
  const handleResizeMove = (e: MouseEvent | TouchEvent) => {
    if ((!isResizing && !isDragging) || !resizeClip || !resizeType) return;

    const isTouch = "touches" in e && e.touches.length > 0;
    const clientX = isTouch ? e.touches[0].clientX : (e as MouseEvent).clientX;
    const clientY = isTouch ? e.touches[0].clientY : (e as MouseEvent).clientY;

    const deltaX = clientX - resizeStart.x;
    const deltaY = clientY - resizeStart.y;

    // Ignore micro-movements to prevent jitter on click
    const threshold = 0.5;
    if (Math.abs(deltaX) < threshold && Math.abs(deltaY) < threshold) return;

    // Cancel any pending frame before queuing a new one
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    // Capture loop variables so the rAF closure sees the current values
    const currentDeltaX     = deltaX;
    const currentDeltaY     = deltaY;
    const currentResizeType = resizeType;
    const currentResizeClip = resizeClip;
    const containerSize     = containerSizeRef.current;

    animationFrameRef.current = requestAnimationFrame(() => {
      if (!currentResizeClip) return;

      setMediaTransforms((prev) => {
        const existingTransform = prev[currentResizeClip.id];
        const currentTransform  = existingTransform || {
          x: 50, y: 50, width: 100, height: 100, scaleX: 1, scaleY: 1,
        };
        const newTransform = { ...currentTransform };

        if (currentResizeType === "move") {
          // Convert pixel delta to canvas-percentage delta (× 0.5 damping factor)
          const { width: containerWidth, height: containerHeight } = containerSize;
          const deltaXPercent = (currentDeltaX / containerWidth)  * 100 * 0.5;
          const deltaYPercent = (currentDeltaY / containerHeight) * 100 * 0.5;

          const halfW = currentTransform.width  / 2;
          const halfH = currentTransform.height / 2;
          let nextX   = currentTransform.x + deltaXPercent;
          let nextY   = currentTransform.y + deltaYPercent;

          // Snap to 0 %, 50 %, 100 % if within 2 % threshold
          const snapThreshold = 2;
          let snappedX: number | null = null;
          let snappedY: number | null = null;

          const snapPoints = [0, 50, 100];
          snapPoints.forEach(p => {
            if (Math.abs(nextX - p) < snapThreshold) { nextX = p; snappedX = p; }
            if (Math.abs(nextY - p) < snapThreshold) { nextY = p; snappedY = p; }
          });

          // Keep the clip fully within the canvas (can't move center beyond margin)
          newTransform.x = Math.max(halfW, Math.min(100 - halfW, nextX));
          newTransform.y = Math.max(halfH, Math.min(100 - halfH, nextY));

          // Show snap guidelines in the canvas overlay
          dispatch(showResizeGuidelines({ clipId: currentResizeClip.id, snapX: snappedX, snapY: snappedY }));

        } else if (currentResizeType === "width") {
          const { width: containerWidth, height: containerHeight } = containerSize;
          const deltaXPercent = (currentDeltaX / containerWidth) * 100 * 0.3;
          newTransform.width  = Math.max(10, Math.min(200, currentTransform.width + deltaXPercent));

          // Lock aspect ratio for visual media
          if (["video", "gif", "image"].includes(currentResizeClip.type)) {
            const ar = aspectRatioByClipRef.current.get(currentResizeClip.id);
            if (ar && ar > 0) {
              const containerRatio = containerWidth / containerHeight;
              newTransform.height  = Math.max(10, Math.min(200, newTransform.width * (containerRatio / ar)));
            }
          }
          const halfW     = newTransform.width / 2;
          newTransform.x  = Math.max(halfW, Math.min(100 - halfW, newTransform.x));

        } else if (currentResizeType === "height") {
          const { width: containerWidth, height: containerHeight } = containerSize;
          const deltaYPercent = (currentDeltaY / containerHeight) * 100 * 0.3;
          newTransform.height  = Math.max(10, Math.min(200, currentTransform.height + deltaYPercent));

          if (["video", "gif", "image"].includes(currentResizeClip.type)) {
            const ar = aspectRatioByClipRef.current.get(currentResizeClip.id);
            if (ar && ar > 0) {
              const containerRatio = containerWidth / containerHeight;
              newTransform.width   = Math.max(10, Math.min(200, newTransform.height * (ar / containerRatio)));
            }
          }
          const halfH     = newTransform.height / 2;
          newTransform.y  = Math.max(halfH, Math.min(100 - halfH, newTransform.y));

        } else if (currentResizeType === "both") {
          // Uniform scale from a corner handle
          const { width: containerWidth, height: containerHeight } = containerSize;
          const deltaXPercent = (currentDeltaX / containerWidth) * 100 * 0.2;
          const scale         = Math.max(0.1, Math.min(2, 1 + deltaXPercent / 100));
          newTransform.width  = Math.max(10, Math.min(200, currentTransform.width  * scale));

          if (["video", "gif", "image"].includes(currentResizeClip.type)) {
            const ar = aspectRatioByClipRef.current.get(currentResizeClip.id);
            if (ar && ar > 0) {
              const containerRatio = containerWidth / containerHeight;
              newTransform.height  = Math.max(10, Math.min(200, newTransform.width * (containerRatio / ar)));
            } else {
              newTransform.height  = Math.max(10, Math.min(200, currentTransform.height * scale));
            }
          } else {
            newTransform.height    = Math.max(10, Math.min(200, currentTransform.height * scale));
          }
          const halfW   = newTransform.width  / 2;
          const halfH   = newTransform.height / 2;
          newTransform.x = Math.max(halfW, Math.min(100 - halfW, newTransform.x));
          newTransform.y = Math.max(halfH, Math.min(100 - halfH, newTransform.y));
        }

        // Stage the Redux update; only flush every N frames to reduce overhead
        pendingReduxUpdateRef.current = {
          clipId:    currentResizeClip.id,
          transform: { x: newTransform.x, y: newTransform.y, width: newTransform.width, height: newTransform.height },
        };

        reduxUpdateFrameCountRef.current += 1;
        if (reduxUpdateFrameCountRef.current >= REDUX_UPDATE_INTERVAL) {
          reduxUpdateFrameCountRef.current = 0;
          if (pendingReduxUpdateRef.current) {
            dispatch(updateClip({
              clipId:  pendingReduxUpdateRef.current.clipId,
              updates: {
                position: { x: pendingReduxUpdateRef.current.transform.x, y: pendingReduxUpdateRef.current.transform.y },
                size:     { width: pendingReduxUpdateRef.current.transform.width, height: pendingReduxUpdateRef.current.transform.height },
              },
            }));
          }
        }

        return { ...prev, [currentResizeClip.id]: newTransform };
      });
    });
  };

  /**
   * handleResizeEnd
   *
   * Called on mouseup / touchend.  Flushes any pending Redux update and
   * cancels the pending animation frame.
   */
  const handleResizeEnd = () => {
    setIsResizing(false);
    setIsDragging(false);
    setResizeType(null);
    setResizeStart({ x: 0, y: 0 });
    reduxUpdateFrameCountRef.current = 0;

    // Always dispatch the final position so Redux has the accurate value
    if (pendingReduxUpdateRef.current) {
      dispatch(updateClip({
        clipId:  pendingReduxUpdateRef.current.clipId,
        updates: {
          position: { x: pendingReduxUpdateRef.current.transform.x, y: pendingReduxUpdateRef.current.transform.y },
          size:     { width: pendingReduxUpdateRef.current.transform.width, height: pendingReduxUpdateRef.current.transform.height },
        },
      }));
      pendingReduxUpdateRef.current = null;
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  };

  // ── Global pointer event listeners ────────────────────────────────────────
  // Attach to `document` (not the canvas element) so drags that leave the
  // canvas bounds still register correct move and up events.
  // `overflow: hidden` + `touchAction: none` prevent page scroll during drag.
  useEffect(() => {
    if (isResizing || isDragging) {
      const handleTouchMove = (e: TouchEvent) => {
        e.preventDefault(); // prevent scroll while dragging on touch
        handleResizeMove(e);
      };

      document.addEventListener("mousemove",   handleResizeMove);
      document.addEventListener("mouseup",     handleResizeEnd);
      document.addEventListener("touchmove",   handleTouchMove, { passive: false });
      document.addEventListener("touchend",    handleResizeEnd);
      document.addEventListener("touchcancel", handleResizeEnd);

      document.body.style.overflow    = "hidden";
      document.body.style.touchAction = "none";

      return () => {
        document.removeEventListener("mousemove",   handleResizeMove);
        document.removeEventListener("mouseup",     handleResizeEnd);
        document.removeEventListener("touchmove",   handleTouchMove);
        document.removeEventListener("touchend",    handleResizeEnd);
        document.removeEventListener("touchcancel", handleResizeEnd);
        document.body.style.overflow    = "";
        document.body.style.touchAction = "";
      };
    }
  }, [isResizing, isDragging, resizeClip, resizeType, resizeStart]);

  // ── Redux → local state sync ──────────────────────────────────────────────
  // When an external change updates a clip's position/size in Redux (e.g. from
  // the MediaStylingPanel sliders or Undo/Redo), reflect it in local transforms.
  // The active drag clip is skipped to avoid conflicting with in-progress moves.
  useEffect(() => {
    const newTransforms: Record<string, any> = { ...mediaTransforms };
    let hasChanges = false;

    Object.values(clips).forEach((clip) => {
      // Don't overwrite the clip currently being dragged (would cause jitter)
      if ((isResizing || isDragging) && clip.id === resizeGuidelines.clipId) {
        return;
      }

      const currentX = clip.position?.x ?? 50;
      const currentY = clip.position?.y ?? 50;
      const currentW = clip.size?.width  ?? 100;
      const currentH = clip.size?.height ?? 100;

      const local = mediaTransforms[clip.id];
      if (
        !local ||
        local.x !== currentX || local.y !== currentY ||
        local.width !== currentW || local.height !== currentH
      ) {
        newTransforms[clip.id] = {
          x: currentX, y: currentY,
          width: currentW, height: currentH,
          scaleX: 1, scaleY: 1,
        };
        hasChanges = true;
      }
    });

    if (hasChanges) setMediaTransforms(newTransforms);
  }, [clips, isResizing, isDragging, resizeGuidelines.clipId]);

  return {
    isResizing,
    isDragging,
    getClipTransform,
    handleResizeStart,
    handleResizeMove,
    handleResizeEnd,
    mediaTransforms,
  };
};
