import { useEffect, useMemo } from "react";
import { MediaElement } from "../components/ClipRenderer";
import { Clip, setCurrentTime, togglePlayback } from "../../../redux/timelineSlice";

/**
 * usePlayerMediaSync
 *
 * Keeps all media elements (<video> and <audio>) in sync with the Redux
 * playhead (`currentTime`) and play/pause state.  It handles three distinct
 * scenarios:
 *
 *  1. **Playback timer** — drives the Redux `currentTime` forward at ~30 fps
 *     using a `setInterval`.  Stops and dispatches `togglePlayback` when the
 *     end of the composition is reached.
 *
 *  2. **Seek sync** — when the player is paused, corrects any element whose
 *     `currentTime` has drifted more than 0.1 s from the expected local time.
 *     This handles scrubber seeks and undo/redo operations.
 *
 *  3. **Cut switch sync** — while playing, detects when the active clip within
 *     a media group (same source file, multiple cuts) changes and snaps the
 *     shared video element to the correct `sourceStart` offset.  Only triggers
 *     if drift exceeds 0.5 s to avoid frame-by-frame jitter.
 *
 * **Video groups**: Multiple clips that reference the same source file share
 * a single <video> element (`videoRefsByMedia`).  The hook finds which clip
 * is currently active and seeks the element to the correct offset within the
 * source file using `clip.sourceStart + localTime`.
 *
 * @param isPlaying              - whether the composition is playing
 * @param currentTime            - current playhead position (seconds)
 * @param totalDuration          - total composition duration (seconds)
 * @param dispatch               - Redux dispatch function
 * @param allMediaElements       - all ClipRenderer MediaElement objects
 * @param allVideoGroups         - groups of clips sharing the same source file
 * @param videoRefs              - map of clipId → <video> DOM element (per clip)
 * @param audioRefs              - map of clipId → <audio> DOM element
 * @param videoRefsByMedia       - map of mediaKey → <video> DOM element (shared per source)
 * @param lastActiveClipIdByMedia - tracks the last active clipId per media group for cut detection
 * @param liveDurationOverrides  - optional per-clip duration overrides (e.g. from speed changes)
 */
export const usePlayerMediaSync = ({
  isPlaying,
  currentTime,
  totalDuration,
  dispatch,
  allMediaElements,
  allVideoGroups,
  videoRefs,
  audioRefs,
  videoRefsByMedia,
  lastActiveClipIdByMedia,
  liveDurationOverrides,
}: {
  isPlaying: boolean;
  currentTime: number;
  totalDuration: number;
  dispatch: any;
  allMediaElements: MediaElement[];
  allVideoGroups: any[];
  videoRefs: React.MutableRefObject<Map<string, HTMLVideoElement>>;
  audioRefs: React.MutableRefObject<Map<string, HTMLAudioElement>>;
  videoRefsByMedia: React.MutableRefObject<Map<string, HTMLVideoElement>>;
  lastActiveClipIdByMedia: React.MutableRefObject<Map<string, string>>;
  liveDurationOverrides: Record<string, number> | undefined;
}) => {

  // ── 1. Playback timer (advances Redux currentTime at ~30 fps) ─────────────
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    let startTime   = currentTime;
    let lastUpdateTime = Date.now();

    if (isPlaying) {
      intervalId = setInterval(() => {
        const now       = Date.now();
        const deltaTime = (now - lastUpdateTime) / 1000; // convert ms → seconds
        lastUpdateTime  = now;

        const newTime     = startTime + deltaTime;
        const clampedTime = Math.min(newTime, totalDuration);

        // Stop playback when the composition ends
        if (clampedTime >= totalDuration) {
          dispatch(togglePlayback());
          return;
        }

        dispatch(setCurrentTime(clampedTime));
        startTime = clampedTime;
      }, 1000 / 30); // ~30 fps tick rate
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isPlaying, totalDuration, dispatch]);

  // ── 2. Play / pause all elements ─────────────────────────────────────────
  useEffect(() => {
    videoRefs.current.forEach((el) => {
      if (el) isPlaying ? el.play().catch(() => {}) : el.pause();
    });
    audioRefs.current.forEach((el) => {
      if (el) isPlaying ? el.play().catch(() => {}) : el.pause();
    });
    videoRefsByMedia.current.forEach((el) => {
      if (el) isPlaying ? el.play().catch(() => {}) : el.pause();
    });
  }, [isPlaying]);

  // ── 3. Seek sync (while paused) ───────────────────────────────────────────
  // Corrects element positions that have drifted from the expected local time.
  // Only runs while paused to avoid fighting the browser's natural playback.
  useEffect(() => {
    if (!isPlaying) {
      // Per-clip video and audio elements
      allMediaElements.forEach(({ clip }) => {
        const duration   = liveDurationOverrides?.[clip.id] ?? clip.duration;
        const localTime  = currentTime - clip.start; // time within this clip
        if (localTime < 0 || localTime > duration) return;

        const videoRef = videoRefs.current.get(clip.id);
        const audioRef = audioRefs.current.get(clip.id);

        if (videoRef) {
          const drift = Math.abs((videoRef.currentTime || 0) - localTime);
          if (drift > 0.1) videoRef.currentTime = localTime;
        }
        if (audioRef) {
          const drift = Math.abs((audioRef.currentTime || 0) - localTime);
          if (drift > 0.1) audioRef.currentTime = localTime;
        }
      });

      // Shared video elements (groups of clips from the same source file)
      allVideoGroups.forEach((group) => {
        const { mediaKey, allClipsSorted } = group;

        // Find which clip within this group is currently active
        const activeClip = allClipsSorted.find((c: Clip) => {
          const dur = liveDurationOverrides?.[c.id] ?? c.duration;
          return currentTime >= c.start && currentTime <= c.start + dur;
        });

        const el = videoRefsByMedia.current.get(mediaKey);
        if (el && activeClip) {
          const duration  = liveDurationOverrides?.[activeClip.id] ?? activeClip.duration;
          const local     = Math.max(0, Math.min(duration, currentTime - activeClip.start));
          // `sourceStart` is the offset into the original source file for this cut
          const inSource  = (activeClip.sourceStart || 0) + local;
          if (Math.abs(el.currentTime - inSource) > 0.1) {
            el.currentTime = inSource;
          }
        }
      });
    }
  }, [currentTime, allMediaElements, allVideoGroups, isPlaying, liveDurationOverrides]);

  // ── 4. Cut switch sync (while playing) ────────────────────────────────────
  // Detects when the active clip within a group changes (i.e. a cut happened)
  // and jumps the shared <video> element to the new clip's source position.
  // A 0.5 s drift threshold prevents unnecessary seeks during normal playback.
  useEffect(() => {
    if (isPlaying) {
      allVideoGroups.forEach((group) => {
        const { mediaKey, allClipsSorted } = group;

        const activeClip = allClipsSorted.find((c: Clip) => {
          const dur = liveDurationOverrides?.[c.id] ?? c.duration;
          return currentTime >= c.start && currentTime <= c.start + dur;
        });

        const el = videoRefsByMedia.current.get(mediaKey);
        if (el && activeClip) {
          const lastId    = lastActiveClipIdByMedia.current.get(mediaKey);
          const duration  = liveDurationOverrides?.[activeClip.id] ?? activeClip.duration;
          const local     = Math.max(0, Math.min(duration, currentTime - activeClip.start));
          const inSource  = (activeClip.sourceStart || 0) + local;
          const drift     = Math.abs((el.currentTime || 0) - inSource);

          // Seek only on a real cut (clip changed) or significant playback drift
          if (lastId !== activeClip.id || (isPlaying && drift > 0.5)) {
            try { el.currentTime = inSource; } catch {}
            lastActiveClipIdByMedia.current.set(mediaKey, activeClip.id);
          }
        }
      });
    }
  }, [allVideoGroups, currentTime, isPlaying, liveDurationOverrides]);
};
