/**
 * Clip.tsx
 *
 * The primary draggable and resizable entity on the timeline canvas.
 *
 * This component handles the complex lifecycle of a timeline clip:
 * 1. **Visual States**:
 *    - Renders the clip background (theme-based).
 *    - Overlays media-specific previews (Audio Waveforms, Video Thumbnails, Images, GIFs).
 *    - Shows selection highlights and "invalid position" (overlap) warnings.
 * 2. **Interactions**:
 *    - Dragging: Moves the clip temporal start position or transfers it across tracks.
 *    - Resizing: Drags the edges to change duration, using `liveDurationOverrides`
 *      for smooth 60fps performance without hammering the Redux store.
 *    - Snapping: Automatically aligns clip edges with the playhead or other clip boundaries.
 * 3. **Persistence**:
 *    - Syncs final positions back to Redux on `onDragEnd`.
 */
import React, { useEffect, useMemo, useRef, useState, memo } from "react";
import { createRoot } from "react-dom/client";
import { Rect, Text, Group, Path, RegularPolygon } from "react-konva";
import { useSelector, useDispatch, useStore, shallowEqual } from "react-redux";
import {
  updateClip,
  removeClip,
  showResizeGuidelines,
  addTrack,
  setCurrentTime,
  setLiveDurationOverride,
  clearLiveDurationOverride,
  setInsertionIndicator,
  setSelectedClip,
  moveClip,
} from "../../../redux/timelineSlice";
import {
  Clip as ClipType,
  Track as TrackType,
} from "../../../redux/timelineSlice";
import AudioWaveform from "./AudioWaveform";
import ImagePreview from "./ImagePreview";
import VideoPreview from "./VideoPreview";
import GIFPreview from "./GIFPreview";
import { THEME } from "../../../utils/themeConstants";
import { RootState } from "../../../redux/store";


/**
 * Snapping Logic
 *
 * Computes a snapped start time given nearby clip boundaries and pixel tolerance.
 * Snaps to:
 * - Time 0
 * - Starts/Ends of any other clip on the timeline.
 */
const snapStartTime = (
  tentativeStart: number,
  otherClips: ClipType[],
  zoom: number,
): number => {
  // Tolerance in seconds based on ~6px
  const toleranceSec = Math.max(0.02, 6 / Math.max(zoom, 5));
  const candidates: number[] = [0];
  otherClips.forEach((c) => {
    candidates.push(c.start);
    candidates.push(c.start + c.duration);
  });
  let best = tentativeStart;
  let bestDist = Infinity;
  for (const t of candidates) {
    const d = Math.abs(t - tentativeStart);
    if (d < bestDist) {
      best = t;
      bestDist = d;
    }
  }
  if (bestDist <= toleranceSec) return Math.max(0, best);
  // Fallback to 0.1s grid when no boundary nearby
  return Math.round(tentativeStart * 10) / 10;
};

/**
 * Collision Prevention
 *
 * Clamp duration so the end does not pass the next neighbor's start.
 */
const clampDurationByNeighbors = (
  start: number,
  tentativeDuration: number,
  otherClips: ClipType[],
): number => {
  const end = start + tentativeDuration;
  // Find the closest next clip start after our start
  let nextStart: number | null = null;
  for (const c of otherClips) {
    if (c.start >= start) {
      if (nextStart === null || c.start < nextStart) nextStart = c.start;
    }
  }
  if (nextStart !== null && end > nextStart) {
    return Math.max(0.05, nextStart - start);
  }
  return tentativeDuration;
};

/**
 * Optimization Helper
 *
 * Apply live duration overrides to a clip list for accurate collision checks
 * during an active resize operation.
 */
const applyLiveOverrides = (
  clips: ClipType[],
  overrides?: Record<string, number>,
): ClipType[] => {
  if (!overrides || !clips?.length) return clips;
  return clips.map((c) =>
    overrides[c.id] !== undefined ? { ...c, duration: overrides[c.id]! } : c,
  );
};

// Utility function to find the nearest valid position for a clip
const findNearestValidPosition = (
  targetStart: number,
  targetDuration: number,
  otherClips: ClipType[],
  currentClipId: string,
): number => {
  // Filter out the current clip and sort by start time
  const sortedClips = otherClips
    .filter((clip) => clip.id !== currentClipId)
    .sort((a, b) => a.start - b.start);

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

interface ClipProps {
  clip: ClipType;
  track: TrackType;
  zoom: number;
  trackY: number; // absolute Y position of the track in the layer
}

const Clip: React.FC<ClipProps> = memo(({ clip, track, zoom, trackY }) => {
  const dispatch = useDispatch();

  // Granular selectors to minimize re-renders
  const selectedClipId = useSelector(
    (state: RootState) => state.timeline.selectedClipId,
  );
  const isSelected = selectedClipId === clip.id;

  const store = useStore() as any;

  // Specific selector for the media item required by this clip (avoids re-rendering on unrelated media changes)
  const mediaItem = useSelector(
    (state: RootState) =>
      state.timeline.mediaItems.find(
        (m: any) =>
          (clip.mediaId && m.id === clip.mediaId) ||
          (clip.url && m.url === clip.url) ||
          (m.name === clip.name && m.type === clip.type),
      ),
    shallowEqual,
  );

  // Get live overrides and clips on this track to detect transitions at edges
  const liveOverrides = useSelector(
    (state: RootState) => state.timeline.liveDurationOverrides,
    shallowEqual,
  );

  const transitionsOnTrack = useSelector((state: RootState) => {
    return track.clips
      .map((id) => state.timeline.clips[id])
      .filter(
        (c) =>
          c &&
          c.isEffect &&
          (c.type === "transition" || c.type === "xfade" || c.effectType),
      );
  }, shallowEqual);

  const groupRef = useRef<any>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [tempStart, setTempStart] = useState<number | null>(null);
  const [tempDuration, setTempDuration] = useState<number | null>(null);
  const [tempY, setTempY] = useState<number | null>(null);
  const [showDeleteButton, setShowDeleteButton] = useState(false);
  const [isOverlapping, setIsOverlapping] = useState(false);
  const [draggingKeyframeIndex, setDraggingKeyframeIndex] = useState<
    number | null
  >(null);
  const [isDraggingFadeIn, setIsDraggingFadeIn] = useState(false);
  const [isDraggingFadeOut, setIsDraggingFadeOut] = useState(false);
  const [tempFadeIn, setTempFadeIn] = useState<number | null>(null);
  const [tempFadeOut, setTempFadeOut] = useState<number | null>(null);
  const portalContainerRef = useRef<HTMLDivElement | null>(null);
  const portalRootRef = useRef<ReturnType<typeof createRoot> | null>(null);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const dragGroupClipsRef = useRef<ClipType[]>([]);
  const dragInitialStartRef = useRef<number>(0);
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastInsertZoneRef = useRef<string | null>(null);
  const lastMoveTimeRef = useRef<number>(0);
  const neighborsRef = useRef<ClipType[]>([]);
  const trackBoundariesRef = useRef<
    { id: string; type: string; top: number; bottom: number }[]
  >([]);
  const longPressTimeoutRef = useRef<number | null>(null);

  // Detect touch device
  useEffect(() => {
    const checkTouchDevice = () => {
      return (
        "ontouchstart" in window ||
        navigator.maxTouchPoints > 0 ||
        (navigator as any).msMaxTouchPoints > 0
      );
    };
    setIsTouchDevice(checkTouchDevice());
  }, []);

  // Create a detached DOM root for the context menu outside Konva tree
  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.createElement("div");
    el.setAttribute("data-clip-menu-root", "");
    document.body.appendChild(el);
    portalContainerRef.current = el;
    portalRootRef.current = createRoot(el);
    return () => {
      // Defer unmount to avoid unmounting a root during React render phase
      const root = portalRootRef.current;
      try {
        setTimeout(() => {
          try {
            root?.unmount();
          } catch {}
        }, 0);
      } catch {}
      if (el.parentNode) el.parentNode.removeChild(el);
      portalContainerRef.current = null;
      portalRootRef.current = null;
    };
  }, []);

  // Cleanup long-press timeout on unmount
  useEffect(() => {
    return () => {
      if (longPressTimeoutRef.current) {
        clearTimeout(longPressTimeoutRef.current);
        longPressTimeoutRef.current = null;
      }
    };
  }, []);

  // Compute max allowed duration/width based on media type
  const getMaxWidthPx = () => {
    if (clip.type === "image" || clip.type === "text")
      return Number.POSITIVE_INFINITY;

    const state = store.getState() as RootState;
    const mediaItems = state.timeline.mediaItems;
    const media = mediaItems.find(
      (m: any) =>
        (clip.mediaId && m.id === clip.mediaId) ||
        (clip.url && m.url === clip.url) ||
        (m.name === clip.name && m.type === clip.type),
    );
    const maxDuration = media?.duration; // seconds (video/audio/gif)
    if (!maxDuration || !isFinite(maxDuration)) return Number.POSITIVE_INFINITY;
    return maxDuration * zoom;
  };

  const getClipColor = (type: string, isEffect?: boolean) => {
    if (isEffect) {
      return `${THEME.trackVideo}33`; // 20% opacity for effect clips
    }

    switch (type) {
      case "video":
        return `${THEME.trackVideo}66`; // 40% opacity for main clips
      case "audio":
        return `${THEME.trackAudio}66`;
      case "image":
        return "#ec489966"; // Pink (standardized)
      case "gif":
        return "#f59e0b66"; // Amber (standardized)
      case "subtitle":
        return `${THEME.trackSubtitle}66`;
      case "text":
        return "#f43f5e66"; // Rose (standardized)
      default:
        return "#6b728066";
    }
  };

  /**
   * Interaction: Dragging
   *
   * Handles the movement of the clip box. Supports:
   * - Subtitle Group Dragging: Moving one subtitle shifts the whole group.
   * - Track Switching: Moving the clip vertically to a different track of same type.
   * - Auto-Track Insertion: Dragging near the gaps can trigger new track creation.
   */
  const handleDragStart = () => {
    setIsDragging(true);
    dispatch(setSelectedClip(clip.id));
    setTempY(trackY);

    const state = store.getState() as RootState;
    const tracks = state.timeline.tracks;
    const clips = state.timeline.clips;
    const liveDurationOverrides = state.timeline.liveDurationOverrides;

    // Cache track boundaries for faster lookup in handleDragMove
    const trackGap = 4;
    let currentY = 0;
    trackBoundariesRef.current = tracks.map((t) => {
      const boundary = {
        id: t.id,
        type: t.type,
        top: currentY,
        bottom: currentY + t.height,
      };
      currentY += t.height + trackGap;
      return boundary;
    });

    // Cache neighbors and apply overrides once
    const otherClipsRaw = track.clips
      .map((clipId) => clips[clipId])
      .filter((other) => other !== undefined && other.id !== clip.id);
    neighborsRef.current = applyLiveOverrides(
      otherClipsRaw,
      liveDurationOverrides || undefined,
    );

    // If subtitle, capture the entire group's initial state
    if (clip.type === "subtitle") {
      dragInitialStartRef.current = clip.start;
      dragGroupClipsRef.current = Object.values(clips).filter(
        (otherClip): otherClip is ClipType =>
          otherClip !== undefined &&
          otherClip.type === "subtitle" &&
          otherClip.subtitleGroupId === clip.subtitleGroupId,
      );
    }
  };

  const handleDragMove = (e: any) => {
    if (!isDragging) return;

    const now = performance.now();
    if (now - lastMoveTimeRef.current < 16) return; // 60fps throttle for dragging
    lastMoveTimeRef.current = now;

    const newX = e.target.x();
    const newY = e.target.y();
    const newStart = Math.max(0, newX / zoom);

    const effectiveDurationLocal = tempDuration ?? clip.duration;

    // For transitions, restrict movement to only between media items
    if (
      clip.isEffect &&
      (clip.type === "transition" || clip.type === "xfade" || clip.effectType)
    ) {
      const mediaNeighbors = neighborsRef.current
        .filter((c) => !c.isEffect)
        .sort((a, b) => a.start - b.start);

      // Find valid transition positions between media items
      let validStart = newStart;
      let isValidPosition = false;

      for (let i = 0; i < mediaNeighbors.length - 1; i++) {
        const currentClip = mediaNeighbors[i];
        const nextClip = mediaNeighbors[i + 1];
        const currentEnd = currentClip.start + currentClip.duration;
        const transitionPoint = currentEnd;
        const tolerance = 1.0; // 1 second tolerance for snapping while dragging

        if (
          newStart >= transitionPoint - tolerance &&
          newStart <= transitionPoint + tolerance
        ) {
          // Don't allow transitions if either neighbor has keyframes
          const currentHasKeyframes =
            currentClip.keyframes && currentClip.keyframes.length > 0;
          const nextHasKeyframes =
            nextClip.keyframes && nextClip.keyframes.length > 0;

          if (!currentHasKeyframes && !nextHasKeyframes) {
            validStart = transitionPoint - 0.5;
            isValidPosition = true;
            break;
          }
        }
      }

      if (!isValidPosition) {
        // If not near a valid boundary, we still allow moving but highlight as invalid
        setTempStart(newStart);
        setTempY(newY);
        setIsOverlapping(true);
      } else {
        setTempStart(validStart);
        setTempY(newY);
        setIsOverlapping(false);
      }
      return;
    }

    // Optimization: avoid Redux updates for subtitle groups while dragging
    if (clip.type === "subtitle") {
      // Just update visual feedback locally, don't dispatch shiftClips
      setTempStart(newStart);
      setTempY(newY);
      setIsOverlapping(false);
      return;
    }

    const solidNeighbors = neighborsRef.current.filter((c) => !c.isEffect);

    // Check if the new position would cause an overlap
    const wouldOverlap = solidNeighbors.some((otherClip) => {
      const otherStart = otherClip.start;
      const otherEnd = otherClip.start + otherClip.duration;
      const newEnd = newStart + effectiveDurationLocal;
      return newStart < otherEnd && newEnd > otherStart;
    });

    setIsOverlapping(wouldOverlap);

    let validStart = newStart;
    if (wouldOverlap) {
      validStart = findNearestValidPosition(
        newStart,
        effectiveDurationLocal,
        solidNeighbors,
        clip.id,
      );
    }

    const snappedStart = snapStartTime(validStart, solidNeighbors, zoom);
    const reOverlap = solidNeighbors.some((otherClip) => {
      const otherStart = otherClip.start;
      const otherEnd = otherClip.start + otherClip.duration;
      const newEnd = snappedStart + effectiveDurationLocal;
      return snappedStart < otherEnd && newEnd > otherStart;
    });
    if (!reOverlap) validStart = snappedStart;

    setTempStart(validStart);
    setTempY(newY);

    // While dragging, handle auto-track insertion with delay for same-type tracks
    const stage: any = groupRef?.current?.getStage() || e.target.getStage();
    const container = stage?.container();
    // use cached track tops
    const trackTops = trackBoundariesRef.current.map((b) => b.top);
    const cooldownMs = 250;
    const trackGap = 4;

    const state = store.getState() as RootState;
    const tracks = state.timeline.tracks;

    const sameTypeIndices = tracks
      .map((t, i) => ({ t, i }))
      .filter((x) => x.t.type === track.type)
      .map((x) => x.i);

    let currentZone: string | null = null;
    let foundInsertPoint = false;
    let insertInfo: { y: number; sameType: boolean; trackId: string } | null =
      null;

    for (const sameIdx of sameTypeIndices) {
      const bottom = trackTops[sameIdx] + tracks[sameIdx].height;
      const nearInsideBottom = newY >= bottom - 8 && newY <= bottom + 14;
      const inGapBelow = newY > bottom && newY < bottom + trackGap + 20;

      if (nearInsideBottom || inGapBelow) {
        const nextTrack = tracks[sameIdx + 1];
        const isSameTypeAsNext = nextTrack && nextTrack.type === track.type;
        currentZone = `zone-${sameIdx}`;
        insertInfo = {
          y: bottom,
          sameType: !!isSameTypeAsNext,
          trackId: tracks[sameIdx].id,
        };
        foundInsertPoint = true;
        break;
      }
    }

    if (foundInsertPoint && insertInfo) {
      if (container) container.style.cursor = "row-resize";

      // Dispatch visual indicator (throttled)
      const lastIndicatorTs = (stage as any)?.attrs?.__lastIndicatorTs || 0;
      if (now - lastIndicatorTs > 64) {
        if (stage) (stage as any).attrs.__lastIndicatorTs = now;
        dispatch(
          setInsertionIndicator({
            y: insertInfo.y,
            type: track.type as any,
            isVisible: true,
          }),
        );
      }

      if (lastInsertZoneRef.current !== currentZone) {
        // Zone changed or entered a new one: reset timer
        if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
        lastInsertZoneRef.current = currentZone;

        const performAdd = () => {
          const lastKey = (stage as any)?.attrs?.__lastTrackAddKey;
          const zoneKey = `${track.type}:${insertInfo!.trackId}`;
          const currentNow = performance.now();
          const canAdd =
            !lastKey ||
            lastKey !== zoneKey ||
            currentNow - ((stage as any)?.attrs?.__lastTrackAddTs || 0) >
              cooldownMs;

          if (canAdd) {
            if (stage) {
              (stage as any).attrs.__lastTrackAddTs = currentNow;
              (stage as any).attrs.__lastTrackAddKey = zoneKey;
            }
            dispatch(
              addTrack({
                type: track.type as any,
                insertAfterTrackId: insertInfo!.trackId,
              }),
            );
          }
        };

        if (insertInfo.sameType) {
          // Delay insertion by 1s for same-type tracks
          holdTimerRef.current = setTimeout(performAdd, 1000);
        } else {
          // Instant insertion for different-type tracks
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
    }
  };

  const handleDragEnd = (e: any) => {
    if (!isDragging) return;

    setIsDragging(false);

    const newX = e.target.x();
    const newY = e.target.y();
    const newStart = Math.max(0, newX / zoom);
    const effectiveDurationLocal = tempDuration ?? clip.duration;

    // Special handling for transitions on drag end
    if (
      clip.isEffect &&
      (clip.type === "transition" || clip.type === "xfade" || clip.effectType)
    ) {
      const stage = e.target.getStage();
      const pointer = stage ? stage.getPointerPosition() : null;
      const pointerY = pointer ? pointer.y : newY;
      const targetTrack = findTrackAtY(pointerY);

      if (targetTrack && targetTrack.type === "video") {
        const state = store.getState() as RootState;
        const clips = state.timeline.clips;
        const liveDurationOverrides = state.timeline.liveDurationOverrides; // Fetch internally

        const mediaNeighbors = applyLiveOverrides(
          targetTrack.clips
            .map((clipId: string) => clips[clipId])
            .filter(
              (c: ClipType) =>
                c !== undefined && !c.isEffect && c.id !== clip.id,
            ),
          liveDurationOverrides || undefined,
        ).sort((a, b) => a.start - b.start);

        let finalStart = newStart;
        let isValid = false;

        for (let i = 0; i < mediaNeighbors.length - 1; i++) {
          const currentClip = mediaNeighbors[i];
          const nextClip = mediaNeighbors[i + 1];
          const currentEnd = currentClip.start + currentClip.duration;
          const transitionPoint = currentEnd;
          const tolerance = 0.5; // Matches visual boundary width

          if (
            newStart >= transitionPoint - tolerance &&
            newStart <= transitionPoint + tolerance
          ) {
            // Ensure clips are strictly adjacent (gap <= 0.1s)
            const gap = nextClip.start - currentEnd;
            if (gap > 0.1) continue;

            // Don't allow transitions if either neighbor has keyframes
            const currentHasKeyframes =
              currentClip.keyframes && currentClip.keyframes.length > 0;
            const nextHasKeyframes =
              nextClip.keyframes && nextClip.keyframes.length > 0;
            if (currentHasKeyframes || nextHasKeyframes) continue;

            // Check for stacking on move
            const existingTransition = targetTrack.clips
              .map((id: string) => clips[id])
              .find((c: ClipType) => {
                if (!c || !c.isEffect || c.id === clip.id) return false;
                // Match transition center point
                const cCenter = c.start + 0.5;
                return Math.abs(cCenter - transitionPoint) < 0.2;
              });

            if (!existingTransition) {
              finalStart = transitionPoint - 0.5;
              isValid = true;
            }
            break;
          }
        }

        if (isValid) {
          if (targetTrack.id !== clip.trackId) {
            dispatch(
              moveClip({
                clipId: clip.id,
                newTrackId: targetTrack.id,
                newStart: finalStart,
              }),
            );
          } else {
            dispatch(
              updateClip({
                clipId: clip.id,
                updates: { start: finalStart },
              }),
            );
            if (groupRef.current) groupRef.current.x(finalStart * zoom);
          }
        } else {
          // Delete transition if invalid placement
          dispatch(removeClip(clip.id));
        }
      } else {
        // Delete transition if not on a video track
        dispatch(removeClip(clip.id));
      }

      setTempStart(null);
      setTempY(null);
      setIsOverlapping(false);
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      lastInsertZoneRef.current = null;
      dispatch(setInsertionIndicator(null));
      return;
    }

    // If this is a subtitle clip, finalize shifting all subtitle clips by the same delta
    if (clip.type === "subtitle") {
      const delta = newStart - dragInitialStartRef.current;
      const subtitleClips = dragGroupClipsRef.current;

      const stage = e.target.getStage();
      const pointer = stage ? stage.getPointerPosition() : null;
      const pointerY = pointer ? pointer.y : newY;
      const targetTrack = findTrackAtY(pointerY);

      // Perform updates for all clips in the group
      subtitleClips.forEach((sc) => {
        const proposedStart = Math.max(0, sc.start + delta);
        let destinationTrackId = sc.trackId;

        if (
          targetTrack &&
          targetTrack.id !== sc.trackId &&
          targetTrack.type === track.type
        ) {
          destinationTrackId = targetTrack.id;
        }

        const snappedStart = Math.round(proposedStart * 10) / 10;

        if (destinationTrackId !== sc.trackId) {
          dispatch(
            moveClip({
              clipId: sc.id,
              newTrackId: destinationTrackId,
              newStart: snappedStart,
            }),
          );
        } else {
          dispatch(
            updateClip({
              clipId: sc.id,
              updates: { start: snappedStart },
            }),
          );
        }
      });

      setTempStart(null);
      setTempY(null);
      setIsOverlapping(false);
      return;
    }

    // Check if we need to move to a different track
    const stage = e.target.getStage();
    if (stage) {
      // Use stage pointer Y for reliable coordinate (accounts for scroll/viewport)
      const pointer = stage.getPointerPosition();
      const pointerY = pointer ? pointer.y : newY;
      const targetTrack = findTrackAtY(pointerY);
      if (
        targetTrack &&
        targetTrack.id !== clip.trackId &&
        targetTrack.type === track.type
      ) {
        const state = store.getState() as RootState;
        const clips = state.timeline.clips;
        const liveDurationOverrides = state.timeline.liveDurationOverrides;

        // Move to different track of same type - check for collisions in the new track
        const otherClipsInNewTrack = applyLiveOverrides(
          (targetTrack as TrackType).clips
            .map((clipId: string) => clips[clipId])
            .filter(
              (otherClip: ClipType): otherClip is ClipType =>
                otherClip !== undefined && otherClip.id !== clip.id,
            ),
          liveDurationOverrides || undefined,
        );
        const solidNewTrack = otherClipsInNewTrack.filter((c) => !c.isEffect);

        let validStart = findNearestValidPosition(
          newStart,
          effectiveDurationLocal,
          solidNewTrack,
          clip.id,
        );
        validStart = snapStartTime(validStart, solidNewTrack, zoom);
        const snappedStart = validStart;

        dispatch(
          moveClip({
            clipId: clip.id,
            newTrackId: targetTrack.id,
            newStart: snappedStart,
          }),
        );
      } else {
        const state = store.getState() as RootState;
        const clips = state.timeline.clips;
        const liveDurationOverrides = state.timeline.liveDurationOverrides;

        // Just update position on current track - check for collisions
        const otherClipsInTrackAllEnd = applyLiveOverrides(
          track.clips
            .map((clipId) => clips[clipId])
            .filter(
              (otherClip): otherClip is ClipType =>
                otherClip !== undefined && otherClip.id !== clip.id,
            ),
          liveDurationOverrides || undefined,
        );
        const solidNeighborsEnd = otherClipsInTrackAllEnd.filter(
          (c) => !c.isEffect,
        );
        let validStart = findNearestValidPosition(
          newStart,
          effectiveDurationLocal,
          solidNeighborsEnd,
          clip.id,
        );
        validStart = snapStartTime(validStart, solidNeighborsEnd, zoom);
        const snappedStart = validStart;

        dispatch(
          updateClip({
            clipId: clip.id,
            updates: { start: snappedStart },
          }),
        );

        // Reset position to snapped value
        if (groupRef.current) {
          groupRef.current.x(snappedStart * zoom);
        }
      }

      // --- NEW: Orphaned Transition Cleanup ---
      // When a media clip moves, check if any transitions on the same track (old or new)
      // are now orphaned (no longer between two adjacent media clips).
      const tracksToCleanup = [track.id];
      if (targetTrack) tracksToCleanup.push(targetTrack.id);
      const uniqueTracks = Array.from(new Set(tracksToCleanup));

      uniqueTracks.forEach((tId) => {
        const state = store.getState() as RootState;
        const tracks = state.timeline.tracks;
        const clips = state.timeline.clips;
        const trackObj = tracks.find((t) => t.id === tId);
        if (!trackObj || trackObj.type !== "video") return;

        const trackClips = trackObj.clips
          .map((id: string) => clips[id])
          .filter((c: ClipType) => c !== undefined);

        const mediaClips = trackClips
          .filter((c) => !c.isEffect)
          .sort((a, b) => a.start - b.start);
        const transitionClips = trackClips.filter(
          (c) =>
            c.isEffect &&
            (c.type === "transition" || c.type === "xfade" || c.effectType),
        );

        transitionClips.forEach((trans) => {
          const transCenter = trans.start + 0.5;
          // A transition is valid if it's placed exactly at a media boundary with gap <= 0.1
          const atBoundary = mediaClips.some((m, idx) => {
            if (idx === mediaClips.length - 1) return false;
            const nextM = mediaClips[idx + 1];
            const boundary = m.start + m.duration;
            const gap = nextM.start - boundary;
            return Math.abs(boundary - transCenter) < 0.1 && gap <= 0.1;
          });

          if (!atBoundary) {
            dispatch(removeClip(trans.id));
          }
        });
      });
    } else {
      // Fallback to just updating position with collision detection
      const state = store.getState() as RootState;
      const clips = state.timeline.clips;
      const otherClipsInTrack = track.clips
        .map((clipId) => clips[clipId])
        .filter(
          (otherClip): otherClip is ClipType =>
            otherClip !== undefined && otherClip.id !== clip.id,
        );

      const validStart = findNearestValidPosition(
        newStart,
        clip.duration,
        otherClipsInTrack,
        clip.id,
      );
      const snappedStart = Math.round(validStart * 10) / 10;

      dispatch(
        updateClip({
          clipId: clip.id,
          updates: { start: snappedStart },
        }),
      );

      if (groupRef.current) {
        groupRef.current.x(snappedStart * zoom);
      }
    }

    setTempStart(null);
    setTempY(null);
    setIsOverlapping(false);

    // Cleanup insertion indicator and timer
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    lastInsertZoneRef.current = null;
    dispatch(setInsertionIndicator(null));
  };

  // Helper function to find track at Y position
  const findTrackAtY = (localY: number) => {
    const boundary = trackBoundariesRef.current.find(
      (b) => localY >= b.top && localY <= b.bottom,
    );
    if (!boundary) return null;
    const state = store.getState() as RootState;
    const tracks = state.timeline.tracks;
    return tracks.find((t) => t.id === boundary.id) || null;
  };

  const handleDelete = (e: any) => {
    e.cancelBubble = true;
    dispatch(removeClip(clip.id));
  };

  const handleResize = (e: any) => {
    if (!isResizing) return;

    const state = store.getState() as RootState;
    const clips = state.timeline.clips;
    const liveDurationOverrides = state.timeline.liveDurationOverrides;

    const now = performance.now();
    if (now - lastMoveTimeRef.current < 16) return; // 60fps throttle for resizing
    lastMoveTimeRef.current = now;

    const stage = e.target.getStage();
    if (!stage || !groupRef.current) return;

    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    // Convert pointer to group's local coordinates (accounts for transforms)
    const absTransform = groupRef.current.getAbsoluteTransform().copy();
    absTransform.invert();
    const localPos = absTransform.point(pointer);
    const rawWidth = localPos.x;
    const minWidth = 20;
    const maxWidthMedia = getMaxWidthPx();
    const maxClamp = isFinite(maxWidthMedia)
      ? Math.max(minWidth, maxWidthMedia)
      : Number.MAX_SAFE_INTEGER;
    const newWidth = Math.max(minWidth, Math.min(maxClamp, rawWidth));
    let newDuration = newWidth / zoom;

    const otherClipsInTrack = applyLiveOverrides(
      track.clips
        .map((clipId) => clips[clipId])
        .filter(
          (otherClip): otherClip is ClipType =>
            otherClip !== undefined && otherClip.id !== clip.id,
        ),
      liveDurationOverrides || undefined,
    );
    const solidNeighborsForResize = otherClipsInTrack.filter(
      (c) => !c.isEffect,
    );
    newDuration = clampDurationByNeighbors(
      clip.start,
      newDuration,
      solidNeighborsForResize,
    );

    // Snap end to nearby boundaries or 0.1s grid
    const endCandidates = [
      ...solidNeighborsForResize.map((c) => c.start),
      ...solidNeighborsForResize.map((c) => c.start + c.duration),
    ];
    const toleranceSec = Math.max(0.02, 6 / Math.max(zoom, 1));
    const tentativeEnd = clip.start + newDuration;
    let bestEnd = tentativeEnd;
    let bestDist = Infinity;
    for (const t of endCandidates) {
      const d = Math.abs(t - tentativeEnd);
      if (d < bestDist) {
        bestEnd = t;
        bestDist = d;
      }
    }
    if (bestDist <= toleranceSec) {
      newDuration = Math.max(0.05, bestEnd - clip.start);
    } else {
      newDuration = Math.round(newDuration * 10) / 10;
    }

    setTempDuration(newDuration);
    // Push live override to store so other components (transition zones) reflect it
    dispatch(
      setLiveDurationOverride({ clipId: clip.id, duration: newDuration }),
    );
  };

  const handleResizeEnd = (e: any) => {
    if (!isResizing) return;

    setIsResizing(false);

    const stage = e.target.getStage();
    if (!stage || !groupRef.current) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const absTransform = groupRef.current.getAbsoluteTransform().copy();
    absTransform.invert();
    const localPos = absTransform.point(pointer);
    const minWidth = 20;
    const rawWidth = localPos.x;
    const maxWidthMedia = getMaxWidthPx();
    const maxClamp = isFinite(maxWidthMedia)
      ? Math.max(minWidth, maxWidthMedia)
      : Number.MAX_SAFE_INTEGER;
    const newWidth = Math.max(minWidth, Math.min(maxClamp, rawWidth));
    const state = store.getState() as RootState;
    const latestClips = state.timeline.clips;
    const latestClip = latestClips[clip.id];
    const liveDurationOverrides = state.timeline.liveDurationOverrides;
    const latestZoom = state.timeline.zoom;

    let newDuration = newWidth / latestZoom;

    const otherClipsInTrack = applyLiveOverrides(
      track.clips
        .map((clipId: string) => latestClips[clipId])
        .filter(
          (otherClip): otherClip is ClipType =>
            otherClip !== undefined && otherClip.id !== clip.id,
        ),
      liveDurationOverrides || undefined,
    );
    const solidNeighborsForResizeEnd = otherClipsInTrack.filter(
      (c) => !c.isEffect,
    );
    newDuration = clampDurationByNeighbors(
      clip.start,
      newDuration,
      solidNeighborsForResizeEnd,
    );

    // Snap end to nearby boundaries or 0.1s grid
    const endCandidates = [
      ...solidNeighborsForResizeEnd.map((c) => c.start),
      ...solidNeighborsForResizeEnd.map((c) => c.start + c.duration),
    ];
    const toleranceSec = Math.max(0.02, 6 / Math.max(latestZoom, 1));
    const tentativeEnd = clip.start + newDuration;
    let bestEnd = tentativeEnd;
    let bestDist = Infinity;
    for (const t of endCandidates) {
      const d = Math.abs(t - tentativeEnd);
      if (d < bestDist) {
        bestEnd = t;
        bestDist = d;
      }
    }
    if (bestDist <= toleranceSec) {
      newDuration = Math.max(0.05, bestEnd - clip.start);
    } else {
      newDuration = Math.round(newDuration * 10) / 10;
    }

    const updates: any = { duration: newDuration };
    // Delete keyframes outside the new borders
    if (latestClip?.keyframes) {
      updates.keyframes = latestClip.keyframes.filter(
        (kf) => kf.at <= newDuration + 0.001,
      );
    }

    dispatch(
      updateClip({
        clipId: clip.id,
        updates,
      }),
    );
    // Clear live override after a small delay to ensure Redux state is updated
    setTimeout(() => {
      dispatch(clearLiveDurationOverride({ clipId: clip.id }));
    }, 0);
    setTempDuration(null);
  };

  // Track mouse outside of the clip while resizing so we can grow to the right
  useEffect(() => {
    if (!isResizing) return;
    const onMove = (evt: MouseEvent) => {
      if (
        clip.isEffect &&
        (clip.type === "transition" || clip.type === "xfade" || clip.effectType)
      )
        return;
      if (!groupRef.current) return;
      const stage = groupRef.current.getStage();
      if (stage) {
        // update konva pointer position from native event
        stage.setPointersPositions(evt as any);
      }

      handleResize({ target: groupRef.current });
    };
    const onUp = (evt: MouseEvent) => {
      if (
        clip.isEffect &&
        (clip.type === "transition" || clip.type === "xfade" || clip.effectType)
      )
        return;

      if (!groupRef.current) return;
      const stage = groupRef.current.getStage();
      if (stage) {
        stage.setPointersPositions(evt as any);
      }
      handleResizeEnd({ target: groupRef.current });
    };
    // visual feedback
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = "ew-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove as any, { passive: false });
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp as any);
    return () => {
      document.body.style.cursor = prevCursor;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onMove as any);
      window.removeEventListener("mouseup", onUp as any);
      window.removeEventListener("touchend", onUp as any);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isResizing, zoom]);

  // Long-press handler for touch devices
  const LONG_PRESS_DELAY_MS = 500;

  // Extract double-click logic into reusable function
  const handleDoubleClickAction = (targetTime?: number) => {
    // Ensure clip is selected/highlighted
    dispatch(setSelectedClip(clip.id));
    // Move playhead to clip start or specific target time
    dispatch(
      setCurrentTime(targetTime !== undefined ? targetTime : clip.start),
    );
    // Toggle MediaLibrary when double-clicking or long-pressing a media item
    if (typeof window !== "undefined") {
      try {
        const event = new CustomEvent("toggle-media-library", {
          detail: { clipId: clip.id },
          bubbles: true,
          cancelable: true,
        });
        document.dispatchEvent(event);
      } catch (error) {
        console.error("Error dispatching toggle-media-library event:", error);
      }
    }
    // Only show resize guidelines for visual clips (image/video/gif/text). Never for audio/subtitle.
    if (
      clip.type === "image" ||
      clip.type === "video" ||
      clip.type === "gif" ||
      clip.type === "text"
    ) {
      dispatch(showResizeGuidelines({ clipId: clip.id }));
    }
    // Open Subtitle Styling tab when double-clicking a subtitle
    if (clip.type === "subtitle" && typeof window !== "undefined") {
      try {
        window.dispatchEvent(
          new CustomEvent("open-subtitle-styling", {
            detail: { clipId: clip.id },
          }),
        );
      } catch {}
    }
    // Open Text Styling tab when double-clicking a text clip
    if (clip.type === "text" && typeof window !== "undefined") {
      try {
        window.dispatchEvent(
          new CustomEvent("open-text-styling", {
            detail: { clipId: clip.id },
          }),
        );
      } catch {}
    }
    // Open Media Styling tab when double-clicking a visual or audio clip
    if (
      (clip.type === "image" ||
        clip.type === "video" ||
        clip.type === "gif" ||
        clip.type === "audio") &&
      typeof window !== "undefined"
    ) {
      try {
        window.dispatchEvent(
          new CustomEvent("open-media-styling", {
            detail: { clipId: clip.id },
          }),
        );
      } catch {}
    }
  };

  const handleClick = (e: any) => {
    e.cancelBubble = true;
    // Only select the clip on single click, don't move playhead or auto-play
    dispatch(setSelectedClip(clip.id));
  };

  const handleDoubleClick = (e: any) => {
    e.cancelBubble = true;

    const stage = e.target.getStage();
    if (!stage || !groupRef.current) {
      handleDoubleClickAction();
      return;
    }

    const pointerPos = stage.getPointerPosition();
    if (!pointerPos) {
      handleDoubleClickAction();
      return;
    }

    // Calculate relative position within the clip
    const transform = groupRef.current.getAbsoluteTransform().copy();
    transform.invert();
    const relativePos = transform.point(pointerPos);

    const timeOffset = relativePos.x / zoom;
    const targetTime = (tempStart ?? clip.start) + timeOffset;

    handleDoubleClickAction(targetTime);
  };

  // Touch handlers for long-press on mobile devices
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const TOUCH_MOVE_THRESHOLD = 10; // pixels

  const handleTouchStart = (e: any) => {
    // Don't interfere with dragging - only handle if not dragging
    if (isDragging || isResizing) {
      return;
    }

    // Store initial touch position to detect movement
    const stage = e.target.getStage();
    if (stage) {
      const pos = stage.getPointerPosition();
      if (pos) {
        touchStartPosRef.current = { x: pos.x, y: pos.y };
      }
    }

    // Start long-press timer
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
    }
    longPressTimeoutRef.current = window.setTimeout(() => {
      // Check if touch hasn't moved significantly
      if (touchStartPosRef.current) {
        const stage = e.target.getStage();
        if (stage && groupRef.current) {
          // Calculate relative position within the clip for the initial touch
          const transform = groupRef.current.getAbsoluteTransform().copy();
          transform.invert();
          const relativePos = transform.point(touchStartPosRef.current);

          const timeOffset = relativePos.x / zoom;
          const targetTime = (tempStart ?? clip.start) + timeOffset;

          handleDoubleClickAction(targetTime);
        } else {
          handleDoubleClickAction();
        }
      }
      longPressTimeoutRef.current = null;
      touchStartPosRef.current = null;
    }, LONG_PRESS_DELAY_MS);
  };

  const handleTouchMove = (e: any) => {
    // Cancel long-press if user moves finger (likely dragging)
    if (touchStartPosRef.current) {
      const stage = e.target.getStage();
      if (stage) {
        const pos = stage.getPointerPosition();
        if (pos) {
          const dx = Math.abs(pos.x - touchStartPosRef.current.x);
          const dy = Math.abs(pos.y - touchStartPosRef.current.y);
          if (dx > TOUCH_MOVE_THRESHOLD || dy > TOUCH_MOVE_THRESHOLD) {
            // User is moving, cancel long-press
            if (longPressTimeoutRef.current) {
              clearTimeout(longPressTimeoutRef.current);
              longPressTimeoutRef.current = null;
            }
            touchStartPosRef.current = null;
          }
        }
      }
    }
  };

  const handleTouchEnd = () => {
    // Cancel long-press if user lifts finger before timeout
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
    touchStartPosRef.current = null;
  };

  const handleTouchCancel = () => {
    // Cancel long-press on touch cancel
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
    touchStartPosRef.current = null;
  };

  const handleMouseEnter = () => {
    setShowDeleteButton(true);
  };

  const handleMouseLeave = () => {
    setShowDeleteButton(false);
  };

  const hasKeyframes = (clip.keyframes && clip.keyframes.length > 0) || false;

  const effectiveStart = tempStart ?? clip.start;
  const effectiveDuration = tempDuration ?? clip.duration;

  // Detect if there is a transition at the start or end of this clip
  const hasTransitionAtStart = useMemo(() => {
    if (clip.isEffect || track.type !== "video") return false;
    return transitionsOnTrack.some((t) => {
      const tStart = liveOverrides?.[`${t.id}_start`] ?? t.start;
      const tDuration = liveOverrides?.[t.id] ?? t.duration;
      const tCenter = tStart + tDuration / 2;
      return Math.abs(tCenter - effectiveStart) < 0.1;
    });
  }, [
    transitionsOnTrack,
    liveOverrides,
    clip.isEffect,
    track.type,
    effectiveStart,
  ]);

  const hasTransitionAtEnd = useMemo(() => {
    if (clip.isEffect || track.type !== "video") return false;
    return transitionsOnTrack.some((t) => {
      const tStart = liveOverrides?.[`${t.id}_start`] ?? t.start;
      const tDuration = liveOverrides?.[t.id] ?? t.duration;
      const tCenter = tStart + tDuration / 2;
      return Math.abs(tCenter - (effectiveStart + effectiveDuration)) < 0.1;
    });
  }, [
    transitionsOnTrack,
    liveOverrides,
    clip.isEffect,
    track.type,
    effectiveStart,
    effectiveDuration,
  ]);

  // Automatically reset fades if a transition is placed at the same location
  useEffect(() => {
    if (hasTransitionAtStart && (clip.fadeInDuration || 0) > 0) {
      dispatch(updateClip({ clipId: clip.id, updates: { fadeInDuration: 0 } }));
    }
  }, [hasTransitionAtStart, clip.fadeInDuration, clip.id, dispatch]);

  useEffect(() => {
    if (hasTransitionAtEnd && (clip.fadeOutDuration || 0) > 0) {
      dispatch(
        updateClip({ clipId: clip.id, updates: { fadeOutDuration: 0 } }),
      );
    }
  }, [hasTransitionAtEnd, clip.fadeOutDuration, clip.id, dispatch]);

  // Reset fades if keyframes are present
  useEffect(() => {
    if (
      hasKeyframes &&
      ((clip.fadeInDuration || 0) > 0 || (clip.fadeOutDuration || 0) > 0)
    ) {
      dispatch(
        updateClip({
          clipId: clip.id,
          updates: { fadeInDuration: 0, fadeOutDuration: 0 },
        }),
      );
    }
  }, [
    hasKeyframes,
    clip.fadeInDuration,
    clip.fadeOutDuration,
    clip.id,
    dispatch,
  ]);

  const x = effectiveStart * zoom;
  const width = effectiveDuration * zoom;
  const y = isDragging && tempY !== null ? tempY : trackY; // allow vertical drag feedback

  const isTransition =
    clip.isEffect &&
    (clip.type === "transition" || clip.type === "xfade" || clip.effectType);

  // Render media preview based on type
  const renderMediaPreview = () => {
    if (clip.isEffect) {
      // Special rendering for effects

      return (
        <Group>
          {/* Effect Gradient Background */}
          <Rect
            x={0}
            y={5}
            width={width}
            height={track.height - 10}
            fillLinearGradientStartPoint={{ x: 0, y: 0 }}
            fillLinearGradientEndPoint={{ x: width, y: track.height }}
            fillLinearGradientColorStops={
              clip.type === "fade" || clip.effectType?.includes("fade")
                ? [0, "rgba(30, 41, 59, 0.8)", 1, "rgba(71, 85, 105, 0.4)"]
                : [0, "rgba(139, 92, 246, 0.8)", 1, "rgba(192, 38, 211, 0.4)"]
            }
            cornerRadius={8}
          />

          {/* Decorative Icon or Pattern */}
          {width > 30 && (
            <Group x={width / 2 - 8} y={track.height / 2 - 8}>
              <Path
                data={
                  isTransition
                    ? "M8 5v14l11-7z" // Play/Transition icon
                    : "M13 10V3L4 14h7v7l9-11h-7z" // Flash/Filter icon
                }
                fill="white"
                opacity={0.6}
                scaleX={0.8}
                scaleY={0.8}
              />
            </Group>
          )}

          {/* Dash border for transitions */}
          {isTransition && (
            <Rect
              x={0}
              y={5}
              width={width}
              height={track.height - 10}
              stroke="white"
              strokeWidth={1}
              dash={[4, 4]}
              opacity={0.3}
              cornerRadius={8}
            />
          )}
        </Group>
      );
    }

    if (!mediaItem || width < 20) return null; // Don't render preview for very small clips

    switch (clip.type) {
      case "audio":
        return (
          <AudioWaveform
            audio={mediaItem.url}
            width={width}
            height={track.height - 5}
            x={0}
            y={2.5}
            color={THEME.panel}
            progressColor={`${THEME.panel}CC`}
          />
        );
      case "image":
        return (
          <ImagePreview
            imageUrl={mediaItem.url}
            width={width - 5}
            height={track.height - 5}
            x={2.5}
            y={2.5}
            repeatX={true}
          />
        );
      case "video":
        return (
          <VideoPreview
            videoUrl={mediaItem.url}
            width={width}
            height={track.height}
            zoom={zoom}
            clipDuration={clip.duration}
          />
        );
      case "gif":
        return (
          <GIFPreview
            gifUrl={mediaItem.url}
            width={width}
            height={track.height - 5}
            x={0}
            y={2.5}
            zoom={zoom}
          />
        );
      default:
        return null;
    }
  };

  return (
    <Group
      ref={groupRef}
      x={x}
      y={y}
      draggable={!isResizing}
      dragBoundFunc={(pos) => ({ x: Math.max(0, pos.x), y: pos.y })}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      onDblClick={handleDoubleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onContextMenu={(e) => {
        if (!clip.isEffect) return;
        e.evt?.preventDefault?.();
        e.cancelBubble = true;
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      {/* Main clip rectangle with preview */}
      <Rect
        x={0}
        y={5}
        width={width}
        height={track.height - 10}
        fill={
          isOverlapping ? THEME.invalid : getClipColor(clip.type, clip.isEffect)
        }
        stroke={
          isOverlapping
            ? THEME.invalid
            : isSelected
              ? THEME.selection
              : `${THEME.textMuted}44`
        }
        strokeWidth={isOverlapping ? 3 : isSelected ? 2 : 1}
        cornerRadius={8}
        shadowColor="black"
        shadowBlur={2}
        shadowOffset={{ x: 1, y: 1 }}
        shadowOpacity={0.2}
      />

      {/* Media preview overlay */}
      {renderMediaPreview()}

      {/* Semi-transparent overlay for text readability (skip for audio to keep waveform visible) */}
      {clip.type !== "audio" && (
        <Rect
          x={0}
          y={5}
          width={width}
          height={track.height - 10}
          fill="rgba(0, 0, 0, 0.3)"
          opacity={0.4}
        />
      )}

      {/* Fade Indicators */}
      {track.type === "video" && !isTransition && !hasKeyframes && (
        <>
          {!!(clip.fadeInDuration || tempFadeIn) && !hasTransitionAtStart && (
            <Path
              data={`M 0 5 L ${
                (tempFadeIn ?? clip.fadeInDuration ?? 0) * zoom
              } 5 L 0 ${track.height - 5} Z`}
              fill="white"
              opacity={0.3}
            />
          )}
          {!!(clip.fadeOutDuration || tempFadeOut) && !hasTransitionAtEnd && (
            <Path
              data={`M ${width} 5 L ${
                width - (tempFadeOut ?? clip.fadeOutDuration ?? 0) * zoom
              } 5 L ${width} ${track.height - 5} Z`}
              fill="white"
              opacity={0.3}
            />
          )}
        </>
      )}

      {/* Keyframe markers */}
      {clip.keyframes &&
        clip.keyframes.map((kf, index) => {
          const kfX = kf.at * zoom;
          // Only render if within clip bounds and visible
          if (kfX < 0 || kfX > width) return null;

          return (
            <Rect
              key={`kf-${index}`}
              x={kfX}
              y={track.height / 2}
              width={14}
              height={14}
              offsetX={7}
              offsetY={7}
              rotation={45}
              fill="#FFFFFF"
              stroke={draggingKeyframeIndex === index ? "#3b82f6" : "#000000"}
              strokeWidth={draggingKeyframeIndex === index ? 2 : 0.5}
              hitStrokeWidth={20}
              opacity={0.9}
              draggable
              dragBoundFunc={(pos) => {
                const stage = groupRef.current?.getStage();
                if (!stage) return pos;

                // Keep vertical position fixed
                const absY =
                  groupRef.current.getAbsolutePosition().y + track.height / 2;

                // Calculate horizontal bounds in absolute coordinates
                const clipAbsX = groupRef.current.getAbsolutePosition().x;
                const minAbsX = clipAbsX;
                const maxAbsX = clipAbsX + width;

                return {
                  x: Math.max(minAbsX, Math.min(maxAbsX, pos.x)),
                  y: absY,
                };
              }}
              onDragStart={(e) => {
                e.cancelBubble = true;
                setDraggingKeyframeIndex(index);
              }}
              onDragMove={(e) => {
                e.cancelBubble = true;
                const newX = e.target.x();
                const newAt = Math.max(0, Math.min(clip.duration, newX / zoom));

                // Visual update only - Redux update on drag end for performance
                e.target.x(newAt * zoom);
              }}
              onDragEnd={(e) => {
                e.cancelBubble = true;
                const newX = e.target.x();
                const newAt = Math.round((newX / zoom) * 100) / 100;

                if (clip.keyframes) {
                  const newKeyframes = [...clip.keyframes];
                  newKeyframes[index] = { ...newKeyframes[index], at: newAt };
                  // Sort keyframes by time
                  newKeyframes.sort((a, b) => a.at - b.at);

                  dispatch(
                    updateClip({
                      clipId: clip.id,
                      updates: { keyframes: newKeyframes },
                    }),
                  );
                }

                setDraggingKeyframeIndex(null);
              }}
              onMouseEnter={(e: any) => {
                const stage = e.target.getStage();
                if (stage) stage.container().style.cursor = "ew-resize";
              }}
              onMouseLeave={(e: any) => {
                const stage = e.target.getStage();
                if (stage) stage.container().style.cursor = "default";
              }}
            />
          );
        })}

      {/* Fade Handles */}
      {track.type === "video" &&
        !isTransition &&
        !hasKeyframes &&
        !clip.styling?.greenScreenEnabled && (
          <>
            {!hasTransitionAtStart && (
              <RegularPolygon
                x={(tempFadeIn ?? clip.fadeInDuration ?? 0) * zoom}
                y={7}
                sides={3}
                rotation={180}
                radius={5}
                fill="white"
                stroke="#3b82f6"
                strokeWidth={isDraggingFadeIn ? 2 : 1}
                draggable
                dragBoundFunc={(pos) => {
                  const stage = groupRef.current?.getStage();
                  if (!stage) return pos;
                  const clipAbsX = groupRef.current.getAbsolutePosition().x;
                  const clipAbsY = groupRef.current.getAbsolutePosition().y;
                  return {
                    x: Math.max(
                      clipAbsX,
                      Math.min(clipAbsX + width / 2, pos.x),
                    ),
                    y: clipAbsY + 5,
                  };
                }}
                onDragStart={(e) => {
                  e.cancelBubble = true;
                  setIsDraggingFadeIn(true);
                }}
                onDragMove={(e) => {
                  e.cancelBubble = true;
                  const newX = e.target.x();
                  const newFade = Math.max(0, newX / zoom);
                  setTempFadeIn(newFade);
                }}
                onDragEnd={(e) => {
                  e.cancelBubble = true;
                  setIsDraggingFadeIn(false);
                  const newX = e.target.x();
                  const newFade = Math.round((newX / zoom) * 10) / 10;
                  dispatch(
                    updateClip({
                      clipId: clip.id,
                      updates: { fadeInDuration: newFade },
                    }),
                  );
                  setTempFadeIn(null);
                }}
                onMouseEnter={(e: any) => {
                  const stage = e.target.getStage();
                  if (stage) stage.container().style.cursor = "ew-resize";
                }}
                onMouseLeave={(e: any) => {
                  const stage = e.target.getStage();
                  if (stage) stage.container().style.cursor = "default";
                }}
              />
            )}

            {!hasTransitionAtEnd && (
              <RegularPolygon
                x={width - (tempFadeOut ?? clip.fadeOutDuration ?? 0) * zoom}
                y={7}
                rotation={180}
                sides={3}
                radius={5}
                fill="white"
                stroke="#3b82f6"
                strokeWidth={isDraggingFadeOut ? 2 : 1}
                draggable
                dragBoundFunc={(pos) => {
                  const stage = groupRef.current?.getStage();
                  if (!stage) return pos;
                  const clipAbsX = groupRef.current.getAbsolutePosition().x;
                  const clipAbsY = groupRef.current.getAbsolutePosition().y;
                  return {
                    x: Math.max(
                      clipAbsX + width / 2,
                      Math.min(clipAbsX + width, pos.x),
                    ),
                    y: clipAbsY + 5,
                  };
                }}
                onDragStart={(e) => {
                  e.cancelBubble = true;
                  setIsDraggingFadeOut(true);
                }}
                onDragMove={(e) => {
                  e.cancelBubble = true;
                  const localX = e.target.x();
                  const newFade = Math.max(0, (width - localX) / zoom);
                  setTempFadeOut(newFade);
                }}
                onDragEnd={(e) => {
                  e.cancelBubble = true;
                  setIsDraggingFadeOut(false);
                  const localX = e.target.x();
                  const newFade =
                    Math.round(((width - localX) / zoom) * 10) / 10;
                  dispatch(
                    updateClip({
                      clipId: clip.id,
                      updates: { fadeOutDuration: newFade },
                    }),
                  );
                  setTempFadeOut(null);
                }}
                onMouseEnter={(e: any) => {
                  const stage = e.target.getStage();
                  if (stage) stage.container().style.cursor = "ew-resize";
                }}
                onMouseLeave={(e: any) => {
                  const stage = e.target.getStage();
                  if (stage) stage.container().style.cursor = "default";
                }}
              />
            )}
          </>
        )}

      {/* Clip labels (render only if there is enough space) */}
      {width > 24 && (
        <>
          {/* Clip name */}
          <Text
            x={8}
            y={track.height / 2 - 6}
            text={
              clip.type === "text" || clip.type === "subtitle" ? clip.name : ""
            }
            fontSize={10}
            fill="#fff"
            fontFamily="Arial"
            fontStyle="bold"
            width={Math.max(0, width - 16)}
            wrap="none"
            ellipsis={true}
          />

          {/* Duration label */}
          <Text
            x={8}
            y={track.height / 2 + 6}
            text={`${clip.duration.toFixed(1)}s`}
            fontSize={8}
            fill="#fff"
            fontFamily="Arial"
            opacity={0.8}
            width={Math.max(0, width - 16)}
            wrap="none"
            ellipsis={true}
          />
        </>
      )}

      {/* Delete button */}
      {(showDeleteButton || isTouchDevice) && (
        <Group>
          <Rect
            x={2}
            y={5}
            width={20}
            height={20}
            fill="rgba(239, 68, 68, 0.9)"
            stroke="rgba(220, 38, 38, 1)"
            strokeWidth={1}
            cornerRadius={3}
            onClick={handleDelete}
            onTap={handleDelete}
          />
          <Group
            x={5}
            y={8}
            onClick={handleDelete}
            onTap={handleDelete}
            scaleX={0.6}
            scaleY={0.6}
          >
            <Path
              data="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"
              fill="white"
              stroke="#000"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Group>
        </Group>
      )}

      {/* Resize handle */}
      {track.height > 0 && (
        <Rect
          x={width - (isTouchDevice ? 20 : 10)}
          y={track.height * 0.3}
          width={isTouchDevice ? 20 : 10}
          height={track.height * 0.4}
          fill={isResizing ? "rgba(255,255,255,0.3)" : "transparent"}
          stroke="transparent"
          onMouseEnter={(e) => {
            const stage = e.target.getStage();
            if (!stage) return;
            const container = stage.container();
            container.style.cursor = "ew-resize";
          }}
          onMouseLeave={(e) => {
            const stage = e.target.getStage();
            if (!stage) return;
            const container = stage.container();
            container.style.cursor = "default";
          }}
          onMouseDown={(e) => {
            e.cancelBubble = true;
            setIsResizing(true);
          }}
          onTouchStart={(e) => {
            e.cancelBubble = true;
            setIsResizing(true);
          }}
        />
      )}
    </Group>
  );
});

export default Clip;
