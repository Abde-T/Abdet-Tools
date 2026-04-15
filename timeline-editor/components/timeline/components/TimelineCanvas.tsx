/**
 * TimelineCanvas.tsx
 *
 * The core visualization layer of the timeline editor, powered by `react-konva`.
 * 
 * This component is responsible for orchestrating the drawing of tracks, clips,
 * and the time ruler. It acts as the primary interaction hub for:
 * 1. **Temporal Navigation**: Zooming (Ctrl+Wheel) and Panning (Alt+Wheel).
 * 2. **Playback Indicators**: Real-time rendering of the Playhead and current time.
 * 3. **Drag-and-Drop Operations**: 
 *    - Accepting new media items from the library.
 *    - Automatic discovery and creation of tracks when hovering near boundaries.
 *    - Dynamic insertion indicators (drop zones).
 * 4. **Virtualization**: While not using a literal virtual list, it optimizes 
 *    rendering via memoization and granular Redux selectors.
 */
import React, {
  useRef,
  useEffect,
  useState,
  useMemo,
  useCallback,
  memo,
} from "react";
import { Stage, Layer, Rect, Line, Text, Group } from "react-konva";
import { useSelector, useDispatch, shallowEqual } from "react-redux";
import { RootState } from "../../../redux/store";
import {
  setTimelineSize,
  setCurrentTime,
  setZoom,
  addClip,
  batchAddClips,
  addTrack,
  setInsertionIndicator,
  Clip as ClipType,
} from "../../../redux/timelineSlice";
import { THEME } from "../../../utils/themeConstants";

import { ReactReduxContext } from "react-redux";
import { calculateTimelineDuration } from "../utils/timelineDuration";
import Track from "./Track";
import TimeRuler from "./TimeRuler";
import Playhead from "./Playhead";
import Clip from "./Clip";

/**
 * Utility function to find the nearest valid position for a clip
 * ensuring it doesn't collide with existing clips on the same track.
 */
const findNearestValidPosition = (
  targetStart: number,
  targetDuration: number,
  otherClips: ClipType[],
  currentClipId?: string,
): number => {
  if (otherClips.length === 0) return targetStart;

  // Filter out the current clip and sort by start time
  const sortedClips = [...otherClips]
    .filter((clip) => clip.id !== currentClipId)
    .sort((a, b) => a.start - b.start);

  if (sortedClips.length === 0) return targetStart;

  // Check if the target position is valid
  const isValidPosition = (start: number) => {
    const end = start + targetDuration;
    return !sortedClips.some((clip) => {
      const clipEnd = clip.start + clip.duration;
      return start < clipEnd && end > clip.start;
    });
  };

  if (isValidPosition(targetStart)) {
    return targetStart;
  }

  // Find the nearest valid position
  let bestPosition = targetStart;
  let minDistance = Infinity;

  // Check positions before and after each existing clip
  for (const clip of sortedClips) {
    const positions = [
      clip.start - targetDuration, // Just before this clip
      clip.start + clip.duration, // Just after this clip
    ];

    for (const pos of positions) {
      if (pos >= 0 && isValidPosition(pos)) {
        const distance = Math.abs(pos - targetStart);
        if (distance < minDistance) {
          minDistance = distance;
          bestPosition = pos;
        }
      }
    }
  }

  return bestPosition;
};

interface TimelineCanvasProps {
  width: number;
  height: number;
}

const TimelineCanvas: React.FC<TimelineCanvasProps> = memo(
  ({ width, height }) => {
    const dispatch = useDispatch();

    // Optimized selector: only select what's needed for the structure
    // currentTime is extracted separately to avoid re-rendering the whole component on every frame
    const {
      tracks,
      clips,
      zoom,
      timelineWidth,
      draggingType,
      liveDurationOverrides,
    } = useSelector(
      (state: RootState) => ({
        tracks: state.timeline.tracks,
        clips: state.timeline.clips,
        zoom: state.timeline.zoom,
        timelineWidth: state.timeline.timelineWidth,
        draggingType: state.timeline.draggingType,
        liveDurationOverrides: state.timeline.liveDurationOverrides,
      }),
      shallowEqual,
    );

    // Separate selector for currentTime if needed by children that are NOT memoized
    // But TimelineCanvas itself shouldn't re-render just because of currentTime if possible.
    // Playhead should probably handle its own position or we pass it down.
    const currentTime = useSelector(
      (state: RootState) => state.timeline.currentTime,
    );

    const stageRef = useRef<any>(null);
    const [stagePosition, setStagePosition] = useState({ x: 0, y: 0 });
    const [scrollX, setScrollX] = useState(0);
    const [scrollTop, setScrollTop] = useState(0);

    // Update timeline size in Redux when props change
    useEffect(() => {
      dispatch(setTimelineSize({ width, height }));
    }, [width, height, dispatch]);

    /**
     * Temporal Calculations
     * We determine the virtual length of the timeline to ensure the horizontal
     * scrollbar always has enough "tail" for the user to work with.
     */
    const totalDurationSec = useMemo(
      () => calculateTimelineDuration(clips, liveDurationOverrides),
      [clips, liveDurationOverrides],
    );

    // Calculate total timeline width based on zoom and total duration
    // Fit behavior: at baseline zoom (width / totalDurationSec), width equals container width
    // Fallback to a small virtual duration when no clips
    const virtualDuration = useMemo(
      () => (totalDurationSec > 0 ? totalDurationSec * 4 : 60),
      [totalDurationSec],
    ); // keep some space when empty
    const totalTimelineWidth = useMemo(
      () => Math.max(timelineWidth, virtualDuration * zoom),
      [timelineWidth, virtualDuration, zoom],
    );
    const rulerHeight = 40;
    const trackGap = 4;

    // Precompute cumulative tops for tracks so spacing is consistent even with different heights
    const trackTops: number[] = useMemo(() => {
      const tops: number[] = [];
      let y = 0; // start at 0 since ruler is separate
      for (let i = 0; i < tracks.length; i++) {
        tops.push(y);
        y += tracks[i].height + trackGap;
      }
      return tops;
    }, [tracks]);

    const contentHeight = useMemo(
      () =>
        tracks.length
          ? trackTops[tracks.length - 1] + tracks[tracks.length - 1].height
          : 0,
      [tracks, trackTops],
    );

    const availableHeight = height - rulerHeight;
    const scrollableHeight = useMemo(
      () => Math.max(contentHeight, availableHeight),
      [contentHeight, availableHeight],
    );

    const handleStageClick = useCallback(
      (e: any) => {
        // If clicking on empty space, deselect all clips
        if (e.target === e.target.getStage()) {
          dispatch(setCurrentTime((e.evt.offsetX + scrollX) / zoom));
        }
      },
      [dispatch, scrollX, zoom],
    );

    const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
      setScrollTop(e.currentTarget.scrollTop);
    }, []);

    // Dragging playhead state
    const isDraggingPlayheadRef = useRef(false);

    const handlePlayheadPointerDown = useCallback(
      (e: any) => {
        isDraggingPlayheadRef.current = true;
        const stage = e.target.getStage();
        if (!stage) return;
        const pointerPosition = stage.getPointerPosition();
        if (!pointerPosition) return;
        const newTime = Math.max(0, (pointerPosition.x + scrollX) / zoom);
        dispatch(setCurrentTime(newTime));

        const container = stage.container();
        if (!container) return;

        let lastMoveTime = 0;
        const onMove = (ev: MouseEvent | TouchEvent) => {
          const now = performance.now();
          if (now - lastMoveTime < 16) return; // ~60fps throttle
          lastMoveTime = now;

          // Use stage pointer to be robust across input types
          const pos = stage.getPointerPosition();
          if (!pos) return;
          const t = Math.max(0, (pos.x + scrollX) / zoom);
          dispatch(setCurrentTime(t));
        };

        const onUp = () => {
          isDraggingPlayheadRef.current = false;
          document.removeEventListener("mousemove", onMove as any);
          document.removeEventListener("touchmove", onMove as any);
          document.removeEventListener("mouseup", onUp);
          document.removeEventListener("touchend", onUp);
          document.removeEventListener("touchcancel", onUp);
        };

        document.addEventListener("mousemove", onMove as any);
        document.addEventListener(
          "touchmove",
          onMove as any,
          { passive: true } as any,
        );
        document.addEventListener("mouseup", onUp);
        document.addEventListener("touchend", onUp);
        document.addEventListener("touchcancel", onUp);
      },
      [dispatch, scrollX, zoom],
    );

    /**
     * Interaction Handlers: Panning & Zooming
     * 
     * - Ctrl + Scroll: Zooms in/out on the time axis.
     * - Alt + Scroll: Pans the timeline horizontally.
     * 
     * Includes a 60ms throttle to maintain high performance during wheel events.
     */
    const handleWheel = useCallback(
      (e: any) => {
        // Alt + Wheel = horizontal scroll (pan)
        if (e.evt.altKey && !e.evt.ctrlKey) {
          e.evt.preventDefault();
          const maxScroll = Math.max(0, totalTimelineWidth - width);
          const deltaX = e.evt.deltaX;
          const deltaY = e.evt.deltaY;
          // Prefer horizontal delta when available; otherwise use vertical to emulate horizontal pan
          const effectiveDelta =
            Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
          const next = Math.max(
            0,
            Math.min(maxScroll, scrollX + effectiveDelta),
          );
          setScrollX(next);
          return;
        }

        // Ctrl + Wheel = zoom
        if (!e.evt.ctrlKey) {
          return;
        }

        e.evt.preventDefault();
        const now = performance.now();
        // simple throttle to ~60ms
        // store lastWheel on stage instance
        const stage: any = stageRef.current;
        const last = stage?.attrs.__lastWheelTs || 0;
        if (now - last < 60) return;
        if (stage) stage.attrs.__lastWheelTs = now;

        const delta = e.evt.deltaY;
        const zoomStep = 5; // pixels per second per wheel notch
        const direction = delta > 0 ? -1 : 1; // up = zoom in
        // Compute min zoom so max visible duration is 60:00 (1h)
        const minZoomByHourCap = width > 0 ? width / 3600 : 0.1;
        // Compute baseline (fit) zoom to cap max at 1000%
        const currentClips = Object.values(clips);
        const totalDurationSecLocal = (() => {
          let maxEnd = 0;
          currentClips.forEach((c: any) => {
            const end = (c?.start || 0) + (c?.duration || 0);
            if (end > maxEnd) maxEnd = end;
          });
          return maxEnd;
        })();
        const baselineZoom =
          totalDurationSecLocal > 0 && width > 0
            ? Math.max(3, Math.min(200, width / totalDurationSecLocal))
            : 50;
        const maxZoomByPercent = baselineZoom * 10; // 1000%
        const nextZoom = Math.max(
          minZoomByHourCap,
          Math.min(maxZoomByPercent, zoom + direction * zoomStep),
        );
        dispatch(setZoom(nextZoom));
      },
      [dispatch, width, scrollX, zoom, totalTimelineWidth, clips],
    );

    const containerRef = useRef<HTMLDivElement>(null);

    const getTrackIdAtY = useCallback(
      (y: number): string | null => {
        const container = containerRef.current;
        if (!container) return null;
        const localY = y + container.scrollTop; // Add scroll offset
        for (let i = 0; i < tracks.length; i++) {
          const top = trackTops[i];
          const bottom = top + tracks[i].height;
          if (localY >= top && localY <= bottom) return tracks[i].id;
        }
        return null;
      },
      [tracks, trackTops],
    );

    const [dragType, setDragType] = useState<string | null>(null);
    const [highlightTrackId, setHighlightTrackId] = useState<string | null>(
      null,
    );

    const mediaTypeToTrackType = useCallback((t: string) => {
      if (t === "audio") return "audio";
      if (t === "text" || t === "subtitle") return "subtitle";
      return "video";
    }, []);

    /**
     * Drag-and-Drop: External Media Hub Support
     * 
     * Handles `onDragOver` from the Media Hub. This logic includes:
     * 1. **Track Detection**: Identifying which track the user is hovering over.
     * 2. **Auto-Track Creation**: If the user hovers near the bottom of a track
     *    group for >250ms, a new track of requested type is automatically inserted.
     */
    const handleDragOver = useCallback(
      (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const localY = e.clientY - rect.top;

        // read type from drag payload (plain for quick access)
        let mtLocal: string | null = null;
        const stage = stageRef.current as any;

        // Cache the parsed drag data on the stage to avoid JSON parsing on every move
        if (stage && stage.attrs.__currentDragData) {
          mtLocal = stage.attrs.__currentDragData.mt;
        } else {
          const plain = e.dataTransfer.getData("text/plain");
          if (plain) {
            try {
              const parsed = JSON.parse(plain);
              if (parsed?.type) {
                setDragType(parsed.type);
                mtLocal = mediaTypeToTrackType(parsed.type);
                if (stage)
                  stage.attrs.__currentDragData = {
                    type: parsed.type,
                    mt: mtLocal,
                  };
              }
            } catch {}
          }
        }

        const trackId = getTrackIdAtY(localY);
        const mt =
          mtLocal ?? (dragType ? mediaTypeToTrackType(dragType) : null);
        const now = performance.now();
        const cooldownMs = 250;

        if (trackId) {
          const track = tracks.find((t) => t.id === trackId);
          if (!track) {
            setHighlightTrackId(null);
            return;
          }
          const acceptType = track.type;
          if (mt && mt === acceptType) setHighlightTrackId(trackId);
          else setHighlightTrackId(null);

          // Trigger when hovering near the bottom INSIDE any track of that type
          if (mt && track.type === mt) {
            const idx = tracks.findIndex((t) => t.id === trackId);
            const top = trackTops[idx];
            const bottom = top + tracks[idx].height;
            const nearInsideBottom =
              localY >= bottom - 8 && localY <= bottom + 14;
            const lastKey = stage?.attrs.__lastTrackAddKey;
            const targetHasContent = (tracks[idx].clips?.length || 0) > 0;
            const canAdd =
              targetHasContent &&
              (!lastKey ||
                lastKey !== `${mt}:${idx}` ||
                now - (stage?.attrs.__lastTrackAddTs || 0) > cooldownMs);

            if (nearInsideBottom) {
              container.style.cursor = "row-resize";
              if (canAdd) {
                if (stage) {
                  stage.attrs.__lastTrackAddTs = now;
                  stage.attrs.__lastTrackAddKey = `${mt}:${idx}`;
                }
                dispatch(
                  addTrack({ type: mt as any, insertAfterTrackId: trackId }),
                );
              }
            } else {
              container.style.cursor = "default";
            }
          }
        } else if (mt) {
          // If hovering in the gap below any track of that type, also add
          const sameTypeIndices = tracks
            .map((t, i) => ({ t, i }))
            .filter((x) => x.t.type === mt)
            .map((x) => x.i);

          let foundGap = false;
          for (const idx of sameTypeIndices) {
            const bottom = trackTops[idx] + tracks[idx].height;
            const inGapBelow =
              localY > bottom && localY < bottom + trackGap + 20;

            if (inGapBelow) {
              const lastKey = stage?.attrs.__lastTrackAddKey;
              const targetHasContent = (tracks[idx].clips?.length || 0) > 0;
              const canAdd =
                targetHasContent &&
                (!lastKey ||
                  lastKey !== `${mt}:${idx}` ||
                  now - (stage?.attrs.__lastTrackAddTs || 0) > cooldownMs);

              container.style.cursor = "row-resize";
              if (canAdd) {
                if (stage) {
                  stage.attrs.__lastTrackAddTs = now;
                  stage.attrs.__lastTrackAddKey = `${mt}:${idx}`;
                }
                dispatch(
                  addTrack({
                    type: mt as any,
                    insertAfterTrackId: tracks[idx].id,
                  }),
                );
              }
              foundGap = true;
              break;
            }
          }
          if (!foundGap) {
            container.style.cursor = "default";
          }
          setHighlightTrackId(null);
        }
      },
      [
        dispatch,
        tracks,
        trackTops,
        dragType,
        mediaTypeToTrackType,
        getTrackIdAtY,
      ],
    );

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const data = e.dataTransfer.getData("application/json");
      if (stageRef.current)
        delete (stageRef.current as any).attrs.__currentDragData;
      if (!data) return;
      let media: any;
      try {
        media = JSON.parse(data);
      } catch {
        return;
      }

      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const startSeconds = Math.max(0, (localX + scrollX) / zoom);

      // Handle effects differently
      if (media.isEffect) {
        // For effects, we need to find a position between existing clips
        const targetTrackId = getTrackIdAtY(localY);
        if (!targetTrackId) return;
        const track = tracks.find((t) => t.id === targetTrackId);
        if (!track) return;

        // Check if this is the right track type for the effect
        const effectTrackType = media.trackType;
        if (track.type !== effectTrackType) return;

        // Find the position between clips
        const trackClips = track.clips || [];
        const trackClipObjects = trackClips
          .map((clipId: string) => clips[clipId])
          .filter((clip): clip is ClipType => clip !== undefined)
          .sort((a: ClipType, b: ClipType) => a.start - b.start);

        // For transitions, only allow placement between media items
        if (
          media.type === "transition" ||
          media.type === "xfade" ||
          media.effectType
        ) {
          // Filter to ONLY media clips (non-effects) for finding transition points
          const mediaClips = trackClipObjects
            .filter((c) => !c.isEffect)
            .map((clip) => ({
              ...clip,
              duration: liveDurationOverrides?.[clip.id] ?? clip.duration,
            }));

          // Find the gap between clips where transition should be placed
          let transitionStart = startSeconds;
          let transitionDuration = media.duration || 1;
          let isValidPlacement = false;

          for (let i = 0; i < mediaClips.length - 1; i++) {
            const currentClip = mediaClips[i];
            const nextClip = mediaClips[i + 1];
            const currentEnd = currentClip.start + currentClip.duration;
            const nextStart = nextClip.start;

            // Check if the drop position is near the transition point between clips
            const transitionPoint = currentEnd;
            const tolerance = 0.5; // Matches visual boundary width (0.5s on each side)

            if (
              startSeconds >= transitionPoint - tolerance &&
              startSeconds <= transitionPoint + tolerance
            ) {
              // Ensure clips are strictly adjacent (gap <= 0.1s)
              const gap = nextStart - currentEnd;
              if (gap > 0.1) continue;

              // Don't allow transitions if either neighbor has keyframes
              const currentHasKeyframes =
                currentClip.keyframes && currentClip.keyframes.length > 0;
              const nextHasKeyframes =
                nextClip.keyframes && nextClip.keyframes.length > 0;
              if (currentHasKeyframes || nextHasKeyframes) continue;

              // Check if a transition already exists at this location to prevent stacking
              const existingTransition = trackClipObjects.find((c) => {
                if (!c.isEffect) return false;
                // Transition usually starts around currentEnd - 0.5 and ends around currentEnd + 0.5
                return Math.abs(c.start + 0.5 - transitionPoint) < 0.2;
              });

              if (existingTransition) {
                // If a transition already exists here, reject the drop
                break;
              }

              // Snap transition to start at the end of the first clip (minus half duration)
              transitionStart = currentEnd - 0.5;

              // Ensure transition doesn't extend beyond the clips it's connecting
              const maxOverlapLeft = currentClip.duration;
              const maxOverlapRight = nextClip.duration;
              transitionDuration = Math.min(
                transitionDuration,
                maxOverlapLeft,
                maxOverlapRight,
              );

              isValidPlacement = true;
              break;
            }
          }

          // If no valid gap found, don't place the transition
          if (!isValidPlacement) {
            return;
          }

          // Add the transition clip
          const effectColorMap: Record<string, string> = {
            transition: "#9c27b0",
            xfade: "#9c27b0",
            fade: "#424242",
            wipe: "#4caf50",
            slide: "#9c27b0",
            circle: "#ff9800",
            crop: "#f44336",
            blur: "#ffeb3b",
          };

          dispatch(
            addClip({
              trackId: targetTrackId,
              clip: {
                type: media.type,
                start: transitionStart,
                duration: transitionDuration,
                trackId: targetTrackId,
                name: media.name || "Transition",
                color: effectColorMap[media.type] || "#607d8b",
                isEffect: true,
                effectType:
                  media.effectType ||
                  media.name?.toLowerCase().replace(/\s+/g, "") ||
                  "fade",
              },
            }),
          );
        } else {
          // For other effects (like blur/color filters that are NOT transitions), use the original logic
          // Find the insertion point between clips
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          let insertIndex = 0;
          const nonTransitionClips = trackClipObjects.filter(
            (c) =>
              !c.isEffect || (c.type !== "transition" && c.type !== "xfade"),
          );

          for (let i = 0; i < nonTransitionClips.length; i++) {
            const clip = nonTransitionClips[i];
            if (!clip) continue;
            const clipEnd = clip.start + clip.duration;
            if (startSeconds > clipEnd) {
              insertIndex = i + 1;
            } else if (startSeconds >= clip.start && startSeconds <= clipEnd) {
              // If dropped on an existing clip, insert after it
              insertIndex = i + 1;
            } else {
              break;
            }
          }

          // Add the effect clip
          const effectColorMap: Record<string, string> = {
            transition: "#9c27b0",
            fade: "#424242",
            wipe: "#4caf50",
            slide: "#9c27b0",
            circle: "#ff9800",
            crop: "#f44336",
            blur: "#ffeb3b",
          };

          dispatch(
            addClip({
              trackId: targetTrackId,
              clip: {
                type: media.type,
                start: startSeconds,
                duration: media.duration || 1,
                trackId: targetTrackId,
                name: media.name || "Effect",
                color: effectColorMap[media.type] || "#607d8b",
                isEffect: true,
                effectType:
                  media.effectType ||
                  media.name?.toLowerCase().replace(/\s+/g, "") ||
                  "fade",
              },
            }),
          );
        }
      } else {
        // Original media handling
        const targetTrackId = getTrackIdAtY(localY);
        if (!targetTrackId) return;
        const track = tracks.find((t) => t.id === targetTrackId);
        if (!track) return;
        const mediaTrackType = mediaTypeToTrackType(media.type);
        if (track.type !== mediaTrackType) return; // reject mismatched drops

        const defaultDuration = media.duration || 10;
        const colorMap: Record<string, string> = {
          video: "#2196f3",
          audio: "#9c27b0",
          image: "#ff9800",
          gif: "#ff5722",
          subtitle: "#4caf50",
          text: "#4caf50",
        };

        // If this is a subtitle media (text with subtitles array), explode into multiple subtitle clips
        if (
          (media.type === "text" || media.type === "subtitle") &&
          Array.isArray(media.subtitles) &&
          media.subtitles.length > 0
        ) {
          const cues: { start: number; end: number; text: string }[] =
            media.subtitles;
          // For subtitles we want to honor exact timestamps from the file,
          // not the X drop position and not collision adjustments.

          const newClips = cues.map((cue) => ({
            type: "subtitle",
            start: Math.max(0, cue.start),
            duration: Math.max(0.2, cue.end - cue.start),
            trackId: targetTrackId,
            name: cue.text,
            color: colorMap["text"],
            subtitleGroupId: media.subtitleGroupId,
            isAnimated: media.isAnimated,
            hasAudio: media.hasAudio,
            mediaId: media.id,
            url: media.url,
          }));

          dispatch(
            batchAddClips({
              trackId: targetTrackId,
              clips: newClips as any,
            }),
          );
        } else {
          // Check for collisions with existing clips in the target track
          const existingClips = track.clips
            .map((clipId) => clips[clipId])
            .filter((clip): clip is ClipType => clip !== undefined);

          const validStart = findNearestValidPosition(
            startSeconds,
            defaultDuration,
            existingClips,
          );

          dispatch(
            addClip({
              trackId: targetTrackId,
              clip: {
                type: media.type,
                start: validStart,
                duration: defaultDuration,
                trackId: targetTrackId,
                name: media.name || "Media",
                color: colorMap[media.type] || "#607d8b",
                isAnimated: media.isAnimated,
                hasAudio: media.hasAudio,
                mediaId: media.id,
                url: media.url,
              },
            }),
          );
        }
      }
      setHighlightTrackId(null);
      setDragType(null);
    };

    const handleDragLeave = () => {
      setHighlightTrackId(null);
      setDragType(null);
    };

    const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
    const lastInsertZoneRef = useRef<string | null>(null);

    // Attach native drag events directly to the Konva stage container to ensure we receive events
    useEffect(() => {
      const stage = stageRef.current as any;
      const container: HTMLElement | undefined = stage?.container();
      if (!container) return;

      const onDragOver = (e: DragEvent) => {
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        const localY = e.clientY - rect.top;

        let mtLocal: string | null = draggingType;
        if (!mtLocal && e.dataTransfer) {
          const plain = e.dataTransfer.getData("text/plain");
          if (plain) {
            try {
              const parsed = JSON.parse(plain as any);
              if ((parsed as any)?.isEffect) {
                // Handle effects
                setDragType((parsed as any).type);
                mtLocal = (parsed as any).trackType;
              } else if ((parsed as any)?.type) {
                // Handle regular media
                setDragType((parsed as any).type);
                mtLocal = mediaTypeToTrackType((parsed as any).type);
              }
            } catch {}
          }
        }

        const trackId = getTrackIdAtY(localY);
        const now = performance.now();
        const cooldownMs = 250;

        const mt =
          mtLocal ?? (dragType ? mediaTypeToTrackType(dragType) : null);

        let currentZone: string | null = null;
        let foundInsertPoint = false;
        let insertInfo: {
          y: number;
          sameType: boolean;
          trackId: string;
        } | null = null;

        if (trackId && mt) {
          const track = tracks.find((t) => t.id === trackId);
          if (track && track.type === mt) {
            const idx = tracks.findIndex((t) => t.id === trackId);
            const top = trackTops[idx];
            const bottom = top + tracks[idx].height;
            const nearInsideBottom =
              localY >= bottom - 8 && localY <= bottom + 14;

            if (nearInsideBottom) {
              const nextTrack = tracks[idx + 1];
              const isSameTypeAsNext = nextTrack && nextTrack.type === mt;
              currentZone = `zone-${idx}`;
              insertInfo = {
                y: bottom,
                sameType: !!isSameTypeAsNext,
                trackId: trackId,
              };
              foundInsertPoint = true;
            }
          }
        } else if (mt) {
          // Check gaps
          const sameTypeIndices = tracks
            .map((t, i) => ({ t, i }))
            .filter((x) => x.t.type === mt)
            .map((x) => x.i);

          for (const idx of sameTypeIndices) {
            const bottom = trackTops[idx] + tracks[idx].height;
            const inGapBelow =
              localY > bottom && localY < bottom + trackGap + 20;

            if (inGapBelow) {
              const nextTrack = tracks[idx + 1];
              const isSameTypeAsNext = nextTrack && nextTrack.type === mt;
              currentZone = `zone-gap-${idx}`;
              insertInfo = {
                y: bottom,
                sameType: !!isSameTypeAsNext,
                trackId: tracks[idx].id,
              };
              foundInsertPoint = true;
              break;
            }
          }
        }

        if (foundInsertPoint && insertInfo) {
          if (container) container.style.cursor = "row-resize";

          // Use a ref to avoid redundant dispatches
          const prevIndicator = (stageRef.current as any)?.__lastInsertion;
          if (
            !prevIndicator ||
            prevIndicator.y !== insertInfo.y ||
            prevIndicator.type !== mt ||
            !prevIndicator.isVisible
          ) {
            (stageRef.current as any).__lastInsertion = {
              y: insertInfo.y,
              type: mt,
              isVisible: true,
            };
            dispatch(
              setInsertionIndicator({
                y: insertInfo.y,
                type: mt as any,
                isVisible: true,
              }),
            );
          }

          if (lastInsertZoneRef.current !== currentZone) {
            if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
            lastInsertZoneRef.current = currentZone;

            const performAdd = () => {
              const lastKey = stage?.attrs?.__lastTrackAddKey;
              const zoneKey = `${mt}:${insertInfo!.trackId}`;
              const currentNow = performance.now();
              const canAdd =
                !lastKey ||
                lastKey !== zoneKey ||
                currentNow - (stage?.attrs?.__lastTrackAddTs || 0) > cooldownMs;

              if (canAdd) {
                if (stage) {
                  stage.attrs.__lastTrackAddTs = currentNow;
                  stage.attrs.__lastTrackAddKey = zoneKey;
                }
                dispatch(
                  addTrack({
                    type: mt as any,
                    insertAfterTrackId: insertInfo!.trackId,
                  }),
                );
              }
            };

            if (insertInfo.sameType) {
              holdTimerRef.current = setTimeout(performAdd, 1000);
            } else {
              performAdd();
            }
          }
        } else {
          if (container) container.style.cursor = "default";
          if (holdTimerRef.current) {
            clearTimeout(holdTimerRef.current);
            holdTimerRef.current = null;
          }
          lastInsertZoneRef.current = null;
          dispatch(setInsertionIndicator(null));
          setHighlightTrackId(null);
        }
      };

      const onDrop = (e: DragEvent) => {
        e.preventDefault();
        setHighlightTrackId(null);
        if (container) container.style.cursor = "default";
        if (holdTimerRef.current) {
          clearTimeout(holdTimerRef.current);
          holdTimerRef.current = null;
        }
        lastInsertZoneRef.current = null;
        dispatch(setInsertionIndicator(null));
      };

      const onLeave = () => {
        setHighlightTrackId(null);
        if (container) container.style.cursor = "default";
        if (holdTimerRef.current) {
          clearTimeout(holdTimerRef.current);
          holdTimerRef.current = null;
        }
        lastInsertZoneRef.current = null;
        dispatch(setInsertionIndicator(null));
      };

      container.addEventListener("dragover", onDragOver);
      container.addEventListener("drop", onDrop);
      container.addEventListener("dragleave", onLeave);
      return () => {
        container.removeEventListener("dragover", onDragOver);
        container.removeEventListener("drop", onDrop);
        container.removeEventListener("dragleave", onLeave);
      };
    }, [tracks, trackTops, dragType, dispatch, trackGap, draggingType]);

    return (
      <div className="h-full w-full overflow-x-hidden bg-muted/30 border border-border rounded-lg flex flex-col">
        {/* Fixed Time Ruler */}
        <div className="flex-shrink-0 " style={{ height: rulerHeight }}>
          <Stage width={width} height={rulerHeight} scaleX={1} scaleY={1}>
            <Layer>
              <TimeRuler
                width={width}
                height={rulerHeight}
                zoom={zoom}
                timelineWidth={totalTimelineWidth}
                currentTime={currentTime}
                scrollX={scrollX}
                onDblClick={(time) => dispatch(setCurrentTime(time))}
              />
            </Layer>
          </Stage>
        </div>

        {/* Scrollable Timeline Content */}
        <div
          ref={containerRef}
          className="overflow-y-scroll overflow-x-hidden "
          style={{
            height: availableHeight,
            maxHeight: availableHeight,
          }}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragLeave={handleDragLeave}
          onScroll={handleScroll}
          data-timeline-scroll="true"
        >
          <div style={{ height: scrollableHeight, minHeight: availableHeight }}>
            <Stage
              ref={stageRef}
              width={width}
              height={scrollableHeight}
              scaleX={1}
              scaleY={1}
              onClick={handleStageClick}
              onWheel={handleWheel}
              draggable={false}
              style={{ touchAction: "none" }}
            >
              <ReactReduxContext.Consumer>
                {(reduxContext) => (
                    <ReactReduxContext.Provider value={reduxContext}>
                      <BackgroundLayer
                        scrollX={scrollX}
                        totalTimelineWidth={totalTimelineWidth}
                        scrollableHeight={scrollableHeight}
                      />

                      <ClipsLayer
                        scrollX={scrollX}
                        viewportWidth={width}
                        tracks={tracks}
                        trackTops={trackTops}
                        totalTimelineWidth={totalTimelineWidth}
                        zoom={zoom}
                        highlightTrackId={highlightTrackId}
                        clips={clips}
                        draggingType={draggingType}
                        liveDurationOverrides={liveDurationOverrides}
                      />

                      <InsertionIndicatorLayer
                        scrollX={scrollX}
                        totalTimelineWidth={totalTimelineWidth}
                      />

                      {/* Layer 3: High-frequency updates (Playhead) */}
                      <Layer>
                        <Group x={-scrollX}>
                          <Playhead
                            x={currentTime * zoom}
                            height={scrollableHeight}
                            zoom={zoom}
                            onPointerDown={handlePlayheadPointerDown}
                            scrollTop={scrollTop}
                          />
                        </Group>
                      </Layer>
                    </ReactReduxContext.Provider>
                )}
              </ReactReduxContext.Consumer>
            </Stage>
          </div>
        </div>
        <div className="flex-shrink-0 px-2 pb-2">
          {totalTimelineWidth > width && (
            <HorizontalScrollbar
              viewportWidth={width}
              contentWidth={totalTimelineWidth}
              scrollX={scrollX}
              onScrollXChange={setScrollX}
            />
          )}
        </div>
      </div>
    );
  },
);

const BackgroundLayer = React.memo(
  ({
    scrollX,
    totalTimelineWidth,
    scrollableHeight,
  }: {
    scrollX: number;
    totalTimelineWidth: number;
    scrollableHeight: number;
  }) => (
    <Layer listening={false}>
      <Group x={-scrollX}>
        <Rect
          x={0}
          y={0}
          width={totalTimelineWidth}
          height={scrollableHeight}
          stroke={THEME.border}
          strokeWidth={1}
        />
      </Group>
    </Layer>
  ),
);

const ClipsLayer = React.memo(
  ({
    scrollX,
    viewportWidth,
    tracks,
    trackTops,
    totalTimelineWidth,
    zoom,
    highlightTrackId,
    clips,
    draggingType,
    liveDurationOverrides,
  }: {
    scrollX: number;
    viewportWidth: number;
    tracks: any[];
    trackTops: number[];
    totalTimelineWidth: number;
    zoom: number;
    highlightTrackId: string | null;
    clips: Record<string, any>;
    draggingType: string | null;
    liveDurationOverrides: any;
  }) => {
    // Virtualization logic for clips
    const visibleClips = useMemo(() => {
      // Buffer of 1000px on each side to prevent artifacts during scroll
      const pixelBuffer = 1000;
      const visibleStartSec = Math.max(0, (scrollX - pixelBuffer) / zoom);
      const visibleEndSec = (scrollX + viewportWidth + pixelBuffer) / zoom;

      return Object.values(clips).filter((clip) => {
        const duration = liveDurationOverrides?.[clip.id] ?? clip.duration;
        const clipEnd = clip.start + duration;
        // Clip is visible if its end is after viewport start AND its start is before viewport end
        return clipEnd >= visibleStartSec && clip.start <= visibleEndSec;
      });
    }, [clips, scrollX, viewportWidth, zoom, liveDurationOverrides]);

    const insertionIndicator = useSelector(
      (state: RootState) => state.timeline.insertionIndicator,
    );

    return (
      <Layer>
        <Group x={-scrollX}>
          {/* Tracks and Indicators */}
          <Group>
            {tracks.map((track, i) => (
              <Track
                key={track.id}
                track={track}
                y={trackTops[i]}
                width={totalTimelineWidth}
                height={track.height}
                zoom={zoom}
                isHighlighted={highlightTrackId === track.id}
              />
            ))}

            {/* Insertion Indicator */}
            {insertionIndicator?.isVisible && (
              <Rect
                x={0}
                y={insertionIndicator.y}
                width={totalTimelineWidth}
                height={2}
                fill={THEME.accent}
                opacity={0.8}
              />
            )}
          </Group>

          {/* Clips */}
          {visibleClips.map((clip) => {
            const track = tracks.find((t) => t.id === clip.trackId);
            if (!track) return null;
            const trackIndex = tracks.findIndex((t) => t.id === clip.trackId);
            const trackY = trackTops[trackIndex];
            return (
              <Clip
                key={clip.id}
                clip={clip}
                track={track}
                zoom={zoom}
                trackY={trackY}
              />
            );
          })}

          {/* Transition Drop Zones */}
          <TransitionZones
            tracks={tracks}
            clips={clips}
            zoom={zoom}
            trackTops={trackTops}
          />
        </Group>
      </Layer>
    );
  },
);

const TransitionZones = memo(
  ({
    tracks,
    clips,
    zoom,
    trackTops,
  }: {
    tracks: any[];
    clips: Record<string, any>;
    zoom: number;
    trackTops: number[];
  }) => {
    const draggingType = useSelector(
      (state: RootState) => state.timeline.draggingType,
    );
    const liveDurationOverrides = useSelector(
      (state: RootState) => state.timeline.liveDurationOverrides,
    );

    if (draggingType !== "video") return null;

    return (
      <Group>
        {tracks.map((track, trackIndex) => {
          if (track.type !== "video") return null;
          const trackY = trackTops[trackIndex];
          const videoClips = track.clips
            .map((clipId: string) => clips[clipId])
            .filter(
              (clip: any): clip is ClipType =>
                clip !== undefined && !clip.isEffect,
            )
            .sort((a: any, b: any) => a.start - b.start);

          return videoClips.map((clip: any, index: number) => {
            if (index === videoClips.length - 1) return null;
            const nextClip = videoClips[index + 1];
            const leftDuration =
              liveDurationOverrides?.[clip.id] ?? clip.duration;
            const currentEnd = clip.start + leftDuration;
            const nextStart = nextClip.start;

            // Only show drop zone if clips are adjacent (gap < 0.1s)
            const gap = nextStart - currentEnd;
            if (gap > 0.1) return null;

            // Don't show drop zone if either neighbor has keyframes
            const currentHasKeyframes =
              clip.keyframes && clip.keyframes.length > 0;
            const nextHasKeyframes =
              nextClip.keyframes && nextClip.keyframes.length > 0;
            if (currentHasKeyframes || nextHasKeyframes) return null;

            const transitionPoint = currentEnd;
            const dropZoneWidth = zoom; // 2 seconds wide (1s on each side)
            const dropZoneX = (transitionPoint - 0.5) * zoom;

            return (
              <Group
                key={`transition-zone-${track.id}-${index}`}
                listening={false}
              >
                <Rect
                  x={dropZoneX}
                  y={trackY + 5}
                  width={dropZoneWidth}
                  height={track.height - 10}
                  fill="rgba(34, 197, 94, 0.2)"
                  stroke="rgba(34, 197, 94, 0.8)"
                  strokeWidth={2}
                  dash={[3, 3]}
                />
              </Group>
            );
          });
        })}
      </Group>
    );
  },
);

const InsertionIndicatorLayer = memo(
  ({
    scrollX,
    totalTimelineWidth,
  }: {
    scrollX: number;
    totalTimelineWidth: number;
  }) => {
    const insertionIndicator = useSelector(
      (state: RootState) => state.timeline.insertionIndicator,
    );

    if (!insertionIndicator || !insertionIndicator.isVisible) return null;

    return (
      <Layer>
        <Group x={-scrollX}>
          <Group>
            <Line
              points={[
                0,
                insertionIndicator.y,
                totalTimelineWidth,
                insertionIndicator.y,
              ]}
              stroke="#2196f3"
              strokeWidth={2}
              dash={[5, 5]}
            />
          </Group>
        </Group>
      </Layer>
    );
  },
);

export default TimelineCanvas;

// Simple internal horizontal scrollbar for timeline panning
interface HorizontalScrollbarProps {
  viewportWidth: number;
  contentWidth: number;
  scrollX: number;
  onScrollXChange: (x: number) => void;
}

const HorizontalScrollbar: React.FC<HorizontalScrollbarProps> = ({
  viewportWidth,
  contentWidth,
  scrollX,
  onScrollXChange,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [trackWidth, setTrackWidth] = React.useState(viewportWidth);

  // Measure actual track width
  React.useEffect(() => {
    const updateTrackWidth = () => {
      if (trackRef.current) {
        setTrackWidth(trackRef.current.offsetWidth);
      }
    };
    updateTrackWidth();
    window.addEventListener("resize", updateTrackWidth);
    return () => window.removeEventListener("resize", updateTrackWidth);
  }, [viewportWidth]);

  const maxScroll = Math.max(0, contentWidth - viewportWidth);
  const minThumbPx = 32;
  const thumbWidth = Math.max(
    minThumbPx,
    Math.round((viewportWidth / contentWidth) * trackWidth),
  );
  const maxThumbX = Math.max(0, trackWidth - thumbWidth);
  const thumbX =
    maxScroll > 0 ? Math.round((scrollX / maxScroll) * maxThumbX) : 0;

  useEffect(() => {
    const getClientX = (e: MouseEvent | TouchEvent): number => {
      if ("touches" in e && e.touches.length > 0) {
        return e.touches[0].clientX;
      }
      if ("clientX" in e) {
        return e.clientX;
      }
      return 0;
    };

    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!isDragging) return;
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const clientX = getClientX(e);
      const localX = Math.min(Math.max(0, clientX - rect.left), rect.width);
      const clampedThumbX = Math.min(
        Math.max(0, localX - thumbWidth / 2),
        maxThumbX,
      );
      const nextScroll =
        maxThumbX > 0 ? (clampedThumbX / maxThumbX) * maxScroll : 0;
      onScrollXChange(Math.round(Math.min(Math.max(0, nextScroll), maxScroll)));
    };
    const onUp = () => {
      setIsDragging(false);
      document.removeEventListener("mousemove", onMove as any);
      document.removeEventListener("touchmove", onMove as any);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchend", onUp);
      document.removeEventListener("touchcancel", onUp);
    };
    if (isDragging) {
      document.addEventListener("mousemove", onMove as any);
      document.addEventListener("touchmove", onMove as any, { passive: true });
      document.addEventListener("mouseup", onUp);
      document.addEventListener("touchend", onUp);
      document.addEventListener("touchcancel", onUp);
    }
    return () => {
      document.removeEventListener("mousemove", onMove as any);
      document.removeEventListener("touchmove", onMove as any);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchend", onUp);
      document.removeEventListener("touchcancel", onUp);
    };
  }, [
    isDragging,
    maxScroll,
    maxThumbX,
    onScrollXChange,
    thumbWidth,
    trackWidth,
  ]);

  // Clamp scrollX to valid range
  React.useEffect(() => {
    if (scrollX > maxScroll) {
      onScrollXChange(maxScroll);
    }
  }, [scrollX, maxScroll, onScrollXChange]);

  const getClientXFromEvent = (
    e: React.MouseEvent | React.TouchEvent,
  ): number => {
    if ("touches" in e && e.touches.length > 0) {
      return e.touches[0].clientX;
    }
    if ("clientX" in e) {
      return e.clientX;
    }
    return 0;
  };

  const handleTrackPointerDown = (
    e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>,
  ) => {
    e.preventDefault();
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const clientX = getClientXFromEvent(e);
    const localX = Math.min(Math.max(0, clientX - rect.left), rect.width);
    const targetThumbX = Math.min(
      Math.max(0, localX - thumbWidth / 2),
      maxThumbX,
    );
    const nextScroll =
      maxThumbX > 0 ? (targetThumbX / maxThumbX) * maxScroll : 0;
    onScrollXChange(Math.round(Math.min(Math.max(0, nextScroll), maxScroll)));
    setIsDragging(true);
  };

  const handleThumbPointerDown = (
    e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  if (contentWidth <= viewportWidth) return null;

  return (
    <div
      wrapper-timeline-scroll="true"
      ref={trackRef}
      className="w-full h-3 rounded bg-muted/50 border border-border relative select-none touch-none"
      onMouseDown={handleTrackPointerDown}
      onTouchStart={handleTrackPointerDown}
    >
      <div
        className="absolute top-0 h-3 rounded bg-muted-foreground/40 hover:bg-muted-foreground/60 cursor-pointer touch-none"
        style={{ width: thumbWidth, left: thumbX }}
        onMouseDown={handleThumbPointerDown}
        onTouchStart={handleThumbPointerDown}
      />
    </div>
  );
};
