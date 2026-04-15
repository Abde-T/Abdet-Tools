import React, { useRef, useCallback } from "react";
import { useDispatch } from "react-redux";
import { setDraggingType } from "../../../redux/timelineSlice";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Represents a single draggable transition effect shown in the library grid */
interface Effect {
  id: string;
  name: string;
  /** The xfade filter name passed to FFmpeg (e.g. "fade", "wipeleft") */
  effectType: string;
  /** Default duration in seconds applied when the effect is dropped on the timeline */
  duration: number;
  description: string;
}

// ─── Transition Catalogue ─────────────────────────────────────────────────────
// Maps each FFmpeg xfade filter name to a human-readable label and description.
// Preview assets are stored alongside this file:
//   img/  → static thumbnail  (shown on idle)
//   gif/  → animated preview  (shown on hover)

const TRANSITION_INFO: Record<string, { name: string; description: string }> = {
  fade:        { name: "Fade",         description: "Standard crossfade" },
  dissolve:    { name: "Dissolve",     description: "Smooth pixel blend" },
  wipeleft:    { name: "Wipe Left",    description: "Slide from right to left" },
  wiperight:   { name: "Wipe Right",   description: "Slide from left to right" },
  wipeup:      { name: "Wipe Up",      description: "Slide from bottom to top" },
  wipedown:    { name: "Wipe Down",    description: "Slide from top to bottom" },
  slideleft:   { name: "Slide Left",   description: "Push old video left, new comes from right" },
  slideright:  { name: "Slide Right",  description: "Push old video right, new comes from left" },
  slideup:     { name: "Slide Up",     description: "Push old video up, new comes from bottom" },
  slidedown:   { name: "Slide Down",   description: "Push old video down, new comes from top" },
  circleopen:  { name: "Circle Open",  description: "Circular opening reveal" },
  circleclose: { name: "Circle Close", description: "Circular closing wipe" },
  rectcrop:    { name: "Rect Crop",    description: "Rectangular crop transition" },
  distance:    { name: "Distance",     description: "Distance-based fade" },
  fadeblack:   { name: "Fade Black",   description: "Fade to black then fade in" },
  fadewhite:   { name: "Fade White",   description: "Fade to white then fade in" },
};

/** Derive the flat EFFECTS array from the catalogue above */
const EFFECTS: Effect[] = Object.entries(TRANSITION_INFO).map(
  ([effectType, info]) => ({
    id: effectType,
    name: info.name,
    effectType,
    duration: 1.0, // default transition length in seconds
    description: info.description,
  }),
);

// ─── EffectsLibrary ───────────────────────────────────────────────────────────
/**
 * EffectsLibrary
 *
 * Renders a grid of draggable transition effect cards.  The user can drag any
 * card onto the timeline canvas (between two clips) to apply the transition.
 *
 * Drag support works on two surfaces:
 * - **Mouse**: uses the browser's native Drag-and-Drop API (DataTransfer)
 * - **Touch** (mobile): uses a floating DOM clone + synthetic `DragEvent`
 *   because the native drag API is unreliable on touch devices
 *
 * The effect payload is serialised as JSON and passed via `dataTransfer` so
 * the timeline canvas handler (`onDrop`) can read it consistently regardless
 * of whether it came from mouse or touch.
 */
const EffectsLibrary: React.FC = () => {
  const dispatch = useDispatch();

  // ─── Hover state ────────────────────────────────────────────────────────────
  // Tracks which effect card is being hovered so we can swap its still
  // thumbnail for the animated GIF preview.
  const [hoveredEffectId, setHoveredEffectId] = React.useState<string | null>(
    null,
  );

  // ─── Touch drag refs ─────────────────────────────────────────────────────────
  // Refs instead of state so DOM updates don't trigger re-renders mid-drag.
  const dragCloneRef = useRef<HTMLElement | null>(null);       // floating clone element
  const dragEffectRef = useRef<Effect | null>(null);           // data for the effect being dragged
  const animationFrameRef = useRef<number | null>(null);       // pending rAF id
  const lastTouchPosRef = useRef<{ x: number; y: number } | null>(null); // latest touch coords

  // ─── Mouse drag ──────────────────────────────────────────────────────────────

  /**
   * Serialise the effect and attach it to the browser's DataTransfer object
   * so the timeline drop handler can identify it as a transition (not a media clip).
   */
  const handleMouseDragStart = (effect: Effect, e: React.DragEvent) => {
    const payload = JSON.stringify({
      ...effect,
      isEffect: true,   // sentinel: tells the canvas this is a transition effect
      trackType: "video",
    });
    e.dataTransfer.setData("application/json", payload);
    e.dataTransfer.setData("text/plain", payload);
    dispatch(setDraggingType("video")); // highlight compatible drop zones
  };

  // ─── Touch drag ──────────────────────────────────────────────────────────────

  /**
   * Touch start: record which effect is being dragged and create a floating
   * clone of the card so the user gets visual drag feedback.
   */
  const handleTouchStart = useCallback(
    (effect: Effect, e: React.TouchEvent) => {
      // Ignore taps on child interactive elements (e.g. future action buttons)
      if ((e.target as HTMLElement).closest("button")) return;

      const touch = e.touches[0];
      const card = e.currentTarget as HTMLElement;

      dispatch(setDraggingType("video"));
      dragEffectRef.current = effect;

      // Clone the card and pin it to the finger position
      const clone = card.cloneNode(true) as HTMLElement;
      clone.style.cssText = `
        position: fixed;
        pointer-events: none;
        opacity: 0.8;
        z-index: 9999;
        width: ${card.offsetWidth}px;
        left: ${touch.clientX - card.offsetWidth / 2}px;
        top: ${touch.clientY - card.offsetHeight / 2}px;
      `;
      clone.id = "touch-drag-clone";
      document.body.appendChild(clone);
      dragCloneRef.current = clone;
      lastTouchPosRef.current = { x: touch.clientX, y: touch.clientY };
    },
    [dispatch],
  );

  /**
   * Touch move: update the clone position using rAF to batch DOM writes and
   * avoid layout thrashing during fast finger movements.
   */
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragCloneRef.current) return;

    const touch = e.touches[0];
    lastTouchPosRef.current = { x: touch.clientX, y: touch.clientY };

    // Only schedule one rAF per frame; reuse the same frame if already queued
    if (animationFrameRef.current === null) {
      animationFrameRef.current = requestAnimationFrame(() => {
        if (dragCloneRef.current && lastTouchPosRef.current) {
          const { x, y } = lastTouchPosRef.current;
          dragCloneRef.current.style.left = `${x - dragCloneRef.current.offsetWidth / 2}px`;
          dragCloneRef.current.style.top  = `${y - dragCloneRef.current.offsetHeight / 2}px`;
        }
        animationFrameRef.current = null;
      });
    }
  }, []);

  /**
   * Shared cleanup: cancels any pending animation frame, removes the
   * floating clone from the DOM, and resets all drag-related refs.
   */
  const cleanupTouchDrag = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Try the ref first; fall back to a DOM query in case the ref was lost
    if (dragCloneRef.current) {
      dragCloneRef.current.remove();
      dragCloneRef.current = null;
    } else {
      document.getElementById("touch-drag-clone")?.remove();
    }

    dispatch(setDraggingType(null));
    dragEffectRef.current = null;
    lastTouchPosRef.current = null;
  }, [dispatch]);

  /**
   * Touch end: determine which element is under the lifted finger.  If it's
   * inside the timeline scroll area, synthesise a `drop` DragEvent so the
   * existing mouse-drop handler can process it without any special-casing.
   */
  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!dragEffectRef.current) return;

      const touch = e.changedTouches[0];
      const effect = dragEffectRef.current;
      const elementUnderFinger = document.elementFromPoint(
        touch.clientX,
        touch.clientY,
      );

      if (elementUnderFinger && effect) {
        try {
          // Only dispatch a drop if the finger lifted inside the timeline canvas
          const timelineContainer = elementUnderFinger.closest(
            '[data-timeline-scroll="true"]',
          ) as HTMLElement | null;

          if (timelineContainer) {
            const payload = JSON.stringify({
              ...effect,
              isEffect: true,
              trackType: "video",
            });

            // Build a synthetic DragEvent that carries the effect payload
            const dropEvent = new DragEvent("drop", {
              bubbles: true,
              cancelable: true,
              clientX: touch.clientX,
              clientY: touch.clientY,
            });

            // Polyfill dataTransfer so the drop handler can call getData()
            Object.defineProperty(dropEvent, "dataTransfer", {
              value: {
                getData: (type: string) =>
                  type === "application/json" || type === "text/plain"
                    ? payload
                    : "",
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
        } catch (err) {
          console.error("Touch drop error:", err);
        }
      }

      cleanupTouchDrag();
    },
    [cleanupTouchDrag],
  );

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex-col justify-between h-full border border-border rounded-lg flex overflow-y-auto">
      {/* Grid of draggable effect cards */}
      <div className="flex w-full overflow-y-auto py-6">
        <div className="w-full overflow-y-auto pt-0 px-4">
          <div className="flex flex-wrap gap-2 justify-center p-1 overflow-x-hidden">
            {EFFECTS.map((effect) => (
              <div
                key={effect.id}
                draggable
                onDragStart={(e) => handleMouseDragStart(effect, e)}
                onMouseEnter={() => setHoveredEffectId(effect.id)}
                onMouseLeave={() => setHoveredEffectId(null)}
                onTouchStart={(e) => handleTouchStart(effect, e)}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={cleanupTouchDrag}
                className="group relative p-2 rounded-md border-2 border-secondary cursor-move hover:shadow-md transition-all duration-200 hover:scale-[1.02] bg-muted/30 border-1 border-muted/30 hover:bg-muted/50 touch-none"
              >
                {/*
                 * Preview image:
                 *   - Idle   → static .jpg thumbnail   (fast to load, no CPU cost)
                 *   - Hover  → animated .gif preview   (shows the actual motion)
                 */}
                <div className="relative flex items-center w-[95px] h-[50px] overflow-hidden border border-secondary/30 rounded-md">
                  <img
                    src={
                      hoveredEffectId === effect.id
                        ? `timeline-editor/components/mediahub/transitions/gif/${effect.effectType}.gif`
                        : `timeline-editor/components/mediahub/transitions/img/${effect.effectType}.jpg`
                    }
                    className="w-full h-full scale-[200%] object-contain"
                    alt={effect.name}
                    draggable={false} // prevent browser from trying to drag the <img> itself
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Disclaimer: browser preview ≠ final FFmpeg render */}
      <div className="p-3 border-t border-border bg-muted/20">
        <div className="flex items-start space-x-2">
          <svg
            className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="text-[10px] text-muted-foreground leading-snug">
            Effects are simulated in the browser preview and may look slightly
            different from the final render.
          </p>
        </div>
      </div>
    </div>
  );
};

export default EffectsLibrary;
