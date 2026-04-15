import React, { useMemo } from "react";
import { useSelector, useDispatch, shallowEqual, useStore } from "react-redux";
import {
  setZoom,
  togglePlayback,
  updateClip,
  setCurrentTime,
  addClip,
  removeClip,
  saveToHistory,
  undo,
  redo,
  setAspectRatio,
} from "../../../redux/timelineSlice";
import { Button } from "../../ui/button";
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Clock,
  AlignHorizontalSpaceAround,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  Undo,
  Redo,
} from "lucide-react";
import AspectRatioSettings from "./AspectRatioSettings";
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from "../../ui/tooltip";
import { RootState } from "../../../redux/store";

/**
 * Controls
 *
 * The toolbar rendered above the timeline canvas.  It contains:
 *
 *  **Top row:**
 *   • Play / Pause button
 *   • Undo / Redo buttons
 *   • Cut tools (cut at playhead, cut before, cut after)
 *   • Aspect ratio selector
 *
 *  **Bottom row:**
 *   • Zoom controls (zoom in/out, fit-to-screen, center on playhead)
 *   • Keyboard shortcut hints (desktop only)
 *
 * ## Zoom model
 *
 * The Redux `zoom` value is a pixels-per-second ratio.  `fitZoom` is derived
 * from the available timeline width and total clip duration so that setting
 * `zoom = fitZoom` makes all clips fill the timeline exactly.  The `zoomPercent`
 * label shows the current zoom relative to `fitZoom` (100 % = fit-to-screen).
 *
 * ## Cut model
 *
 * All three cut operations target the *selected* clip if one is selected,
 * otherwise they fall back to any clip under the playhead.  `useStore` is
 * used to read `currentTime` inside handlers without subscribing to it at the
 * component level (which would cause 60 fps re-renders of the toolbar).
 */

interface ControlsProps {
  className?: string;
}

const Controls: React.FC<ControlsProps> = ({ className = "" }) => {
  const dispatch = useDispatch();

  // useStore lets us read currentTime directly in event handlers without
  // subscribing to it here (which would cause 60fps re-renders of the toolbar).
  const store = useStore<RootState>();

  // ─── Redux State ─────────────────────────────────────────────────────────────
  const { zoom, isPlaying, clips, selectedClipId, aspectRatio, timelineWidth, history, historyIndex } =
    useSelector(
      (state: RootState) => ({
        zoom: state.timeline.zoom,
        isPlaying: state.timeline.isPlaying,
        clips: state.timeline.clips,
        selectedClipId: state.timeline.selectedClipId,
        aspectRatio: state.timeline.aspectRatio,
        timelineWidth: state.timeline.timelineWidth,
        history: state.timeline.history,
        historyIndex: state.timeline.historyIndex,
      }),
      shallowEqual,
    );

  // ─── Derived Values ───────────────────────────────────────────────────────────

  /**
   * The total duration of all clips combined (end of the last clip).
   * Used to calculate the "fit to screen" zoom level.
   */
  const totalDuration = useMemo(() => {
    let maxEnd = 0;
    Object.values(clips).forEach((c) => {
      const end = (c?.start || 0) + (c?.duration || 0);
      if (end > maxEnd) maxEnd = end;
    });
    return maxEnd;
  }, [clips]);

  /**
   * The zoom level that makes all clips fit exactly within the visible timeline width.
   * This is "100%" from the user's perspective.
   */
  const fitZoom = useMemo(() => {
    if (!totalDuration || totalDuration <= 0) return 50;  // default when timeline is empty
    if (!timelineWidth || timelineWidth <= 0) return 50;  // fallback before layout is measured
    const fit = timelineWidth / totalDuration;
    return Math.max(3, Math.min(200, fit)); // clamp to reducer bounds
  }, [totalDuration, timelineWidth]);

  /** Current zoom shown as a percentage relative to the fit-to-screen baseline */
  const zoomPercent = Math.round((zoom / (fitZoom || 50)) * 100);

  const canUndo = history.length > 0 && historyIndex >= 0;
  const canRedo = historyIndex < history.length - 1;

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Returns the clip that should be affected by a cut operation.
   * Priority: the selected clip (if any) → any clip currently under the playhead.
   */
  const getClipUnderPlayhead = (currentTime: number) => {
    if (selectedClipId && clips[selectedClipId]) return clips[selectedClipId];
    return (
      Object.values(clips).find(
        (c) => currentTime > c.start && currentTime < c.start + c.duration,
      ) || null
    );
  };

  // ─── Playback ─────────────────────────────────────────────────────────────────

  const handlePlayPause = () => dispatch(togglePlayback());

  // ─── Zoom ─────────────────────────────────────────────────────────────────────

  const handleZoomIn = () => {
    const maxZoom = (fitZoom || 50) * 10; // cap at 1000% of fit zoom
    dispatch(setZoom(Math.min(zoom * 1.5, maxZoom)));
  };

  const handleZoomOut = () => {
    // Lower bound: don't zoom out so far that the timeline represents more than one hour
    const minZoom = timelineWidth > 0 ? timelineWidth / 3600 : 0.1;
    dispatch(setZoom(Math.max(zoom / 1.5, minZoom)));
  };

  /** Reset zoom so all clips fit within the visible area */
  const handleResetZoom = () => dispatch(setZoom(fitZoom));

  /**
   * Centers the view on the current playhead position.
   * Currently snaps back to fit-zoom if over-zoomed; full scroll centering
   * would require a timeline offset state which isn't implemented yet.
   */
  const handleCenterOnPlayhead = () => {
    if (zoom > fitZoom) dispatch(setZoom(fitZoom));
  };

  // ─── Cut Operations ───────────────────────────────────────────────────────────

  /** Split the clip under the playhead into two clips at the exact playhead position */
  const handleCut = () => {
    const { currentTime } = store.getState().timeline;
    const target = getClipUnderPlayhead(currentTime);
    if (!target) return;

    const clipEnd = target.start + target.duration;

    // Don't cut at the very start or very end — it would produce a zero-length clip
    if (currentTime <= target.start + 0.001 || currentTime >= clipEnd - 0.001) return;

    dispatch(saveToHistory());

    const leftDuration = currentTime - target.start;
    const rightDuration = clipEnd - currentTime;

    // Shrink the existing clip to form the left half
    dispatch(updateClip({ clipId: target.id, updates: { duration: leftDuration } }));

    // Create a new clip for the right half
    dispatch(
      addClip({
        trackId: target.trackId,
        clip: {
          type: target.type as any,
          start: currentTime,
          duration: rightDuration,
          trackId: target.trackId,
          name: target.name,
          color: target.color,
          zIndex: target.zIndex,
          volume: target.volume,
          thumbnails: target.thumbnails,
          thumbnailInterval: target.thumbnailInterval,
          position: target.position,
          size: target.size,
          styling: target.styling,
          isEffect: target.isEffect,
          effectType: target.effectType,
          mediaId: target.mediaId,
          url: target.url,
          // Advance the in-source offset by the left portion that was cut off
          sourceStart: (target.sourceStart || 0) + leftDuration,
        } as any,
      }),
    );

    dispatch(setCurrentTime(currentTime));
  };

  /** Remove everything in the clip after the playhead (trim the right side) */
  const handleCutAfter = () => {
    const { currentTime } = store.getState().timeline;
    const target = getClipUnderPlayhead(currentTime);
    if (!target) return;

    const clipStart = target.start;
    const clipEnd = clipStart + target.duration;

    if (currentTime <= clipStart) return; // playhead is before or at clip start — nothing to trim

    dispatch(saveToHistory());

    if (currentTime >= clipEnd) {
      // Playhead is past the end — remove the entire clip
      dispatch(removeClip(target.id));
      return;
    }

    const newDuration = currentTime - clipStart;
    if (newDuration > 0.0005) {
      dispatch(updateClip({ clipId: target.id, updates: { duration: newDuration } }));
    } else {
      dispatch(removeClip(target.id));
    }
  };

  /** Remove everything in the clip before the playhead (trim the left side) */
  const handleCutBefore = () => {
    const { currentTime } = store.getState().timeline;
    const target = getClipUnderPlayhead(currentTime);
    if (!target) return;

    const clipStart = target.start;
    const clipEnd = clipStart + target.duration;

    if (currentTime >= clipEnd) return; // playhead is past clip end — nothing to trim

    dispatch(saveToHistory());

    if (currentTime <= clipStart) {
      // Playhead is before clip start — remove the entire clip
      dispatch(removeClip(target.id));
      return;
    }

    const leftTrim = currentTime - clipStart;
    const newDuration = clipEnd - currentTime;
    const newSourceStart = (target.sourceStart || 0) + leftTrim;

    if (newDuration > 0.0005) {
      dispatch(
        updateClip({
          clipId: target.id,
          updates: { start: currentTime, duration: newDuration, sourceStart: newSourceStart },
        }),
      );
    } else {
      dispatch(removeClip(target.id));
    }
  };

  // ─── Aspect Ratio ─────────────────────────────────────────────────────────────

  const handleAspectRatioChange = (ratio: string) => dispatch(setAspectRatio(ratio));

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className={`bg-card border-b border-border rounded-t-lg px-2 sm:px-4 py-2 sm:py-3 relative ${className}`}>
      <div className="flex flex-col gap-3">

        {/* ── Top row: Playback, Undo/Redo, Cut, Aspect Ratio ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">

          {/* Left group: play/pause + undo/redo + cut tools */}
          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">

            {/* Play / Pause */}
            <Button
              onClick={handlePlayPause}
              className="px-3 sm:px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-2"
              size="sm"
            >
              {isPlaying ? (
                /* Pause icon */
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              ) : (
                /* Play icon */
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                </svg>
              )}
              <span className="inline">{isPlaying ? "Pause" : "Play"}</span>
            </Button>

            <div className="block w-px h-8 bg-border" />

            {/* Undo / Redo */}
            <TooltipProvider>
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button onClick={() => dispatch(undo())} aria-label="Undo" variant="outline" size="sm" className="px-2 sm:px-3" disabled={!canUndo}>
                      <Undo className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button onClick={() => dispatch(redo())} aria-label="Redo" variant="outline" size="sm" className="px-2 sm:px-3" disabled={!canRedo}>
                      <Redo className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Redo (Ctrl+Y)</TooltipContent>
                </Tooltip>
              </div>

              <div className="hidden sm:block w-px h-8 bg-border" />

              {/* Cut tools */}
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button onClick={handleCutBefore} aria-label="Cut all before" variant="outline" size="sm" className="px-2 sm:px-3">
                      <AlignHorizontalJustifyEnd className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Cut everything before playhead</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button onClick={handleCut} aria-label="Cut at playhead" variant="outline" size="sm" className="px-2 sm:px-3">
                      <AlignHorizontalSpaceAround className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Cut clip at playhead</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button onClick={handleCutAfter} aria-label="Cut all after" variant="outline" size="sm" className="px-2 sm:px-3">
                      <AlignHorizontalJustifyStart className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Cut everything after playhead</TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
          </div>

          {/* Right group: aspect ratio selector */}
          <div className="w-full sm:w-auto">
            <AspectRatioSettings
              currentRatio={aspectRatio}
              onRatioChange={handleAspectRatioChange}
            />
          </div>
        </div>

        {/* ── Bottom row: Zoom controls + keyboard shortcut hints ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2 border-t border-border/50">

          {/* Zoom controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground font-medium">Zoom:</span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={handleZoomOut} title="Zoom Out (Ctrl+Scroll)" className="px-2 sm:px-3">
                <ZoomOut className="w-4 h-4" />
              </Button>

              {/* Current zoom percentage badge */}
              <span className="text-xs bg-primary/20 text-primary px-2 py-1 rounded min-w-[3.5rem] text-center font-medium">
                {zoomPercent}%
              </span>

              <Button variant="outline" size="sm" onClick={handleZoomIn} title="Zoom In (Ctrl+Scroll)" className="px-2 sm:px-3">
                <ZoomIn className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={handleResetZoom} title="Fit to screen (Ctrl+0)" className="px-2 sm:px-3">
                <RotateCcw className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={handleCenterOnPlayhead} title="Center on playhead" className="px-2 sm:px-3 hidden sm:flex">
                <Clock className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Keyboard shortcut hints (desktop only) */}
          <div className="hidden lg:flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <kbd className="px-2 py-0.5 bg-muted rounded text-foreground text-[10px] font-mono">Ctrl</kbd>
              <span>+</span>
              <kbd className="px-2 py-0.5 bg-muted rounded text-foreground text-[10px] font-mono">Scroll</kbd>
              <span className="ml-1">Zoom</span>
            </div>
            <div className="flex items-center gap-2">
              <kbd className="px-2 py-0.5 bg-muted rounded text-foreground text-[10px] font-mono">Alt</kbd>
              <span>+</span>
              <kbd className="px-2 py-0.5 bg-muted rounded text-foreground text-[10px] font-mono">Scroll</kbd>
              <span className="ml-1">Scroll</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(Controls);
