import React, { useRef, useEffect, useMemo, useState, useCallback } from "react";
import { useSelector, useDispatch, shallowEqual } from "react-redux";
import { RootState } from "../../redux/store";
import {
  setCurrentTime,
  hideResizeGuidelines,
  togglePlayerScrubber,
} from "../../redux/timelineSlice";
import { calculateTimelineDuration } from "../timeline/utils/timelineDuration";

// Components
import { VideoGroupRenderer, MediaItemRenderer, MediaElement } from "./components/ClipRenderer";
import { 
  FadeTransition, 
  FadeBlackTransition, 
  FadeWhiteTransition, 
  WipeTransition, 
  SlideTransition, 
  CircularTransition, 
  RectCropTransition, 
  CircleCloseTransition 
} from "./components/TransitionRenderer";
import { PlayerControls } from "./components/PlayerControls";

// Hooks
import { useCanvasInteraction } from "./hooks/useCanvasInteraction";
import { usePlayerAudio } from "./hooks/usePlayerAudio";
import { usePlayerMediaSync } from "./hooks/usePlayerMediaSync";

/**
 * Player
 *
 * Root preview canvas component.  Orchestrates all child renderers and hooks:
 *
 *  - Reads `clips`, `tracks`, `mediaItems`, `currentTime` from Redux
 *  - Derives `allMediaElements` (all renderable clips with resolved media items)
 *  - Derives `allVideoGroups` (video clips grouped by source file for shared <video>)
 *  - Derives `activeTransitions` (clips currently in a transition window)
 *  - Delegates rendering to `MediaItemRenderer` / `VideoGroupRenderer`
 *  - Delegates transitions to the TransitionRenderer components
 *  - Manages the interactive resize overlay (guidelines + corner handles)
 *  - Controls fullscreen mode via the native Fullscreen API
 *  - Maintains responsive canvas dimensions via `ResizeObserver`
 *
 * ## Rendering layers (bottom to top)
 *
 *  1. Transition clips  (managed by TransitionRenderer; `zIndex` handled per-component)
 *  2. Media clips       (video groups then image/audio/text; z-index from clip.zIndex)
 *  3. Interaction layer (resize guidelines at z-index 1500–1501)
 *
 * ## Look-ahead mounting
 *
 * Clips starting within the next **3 seconds** are mounted with
 * `opacityOverride={0}` and `ignoreBounds={true}`.  This pre-loads the media
 * (especially `<video>`) so it is ready to play without a visible flash.
 */
const Player: React.FC = () => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const showPlayerScrubber = useSelector((state: RootState) => state.timeline.showPlayerScrubber);
  const dispatch = useDispatch();
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const outerContainerRef = useRef<HTMLDivElement>(null);
  const aspectContainerRef = useRef<HTMLDivElement>(null);

  // Redux State
  const {
    isPlaying,
    clips,
    tracks,
    mediaItems,
    resizeGuidelines,
    globalSubtitleStyling,
    aspectRatio,
    liveDurationOverrides,
  } = useSelector(
    (state: RootState) => ({
      isPlaying: state.timeline.isPlaying,
      clips: state.timeline.clips,
      tracks: state.timeline.tracks,
      mediaItems: state.timeline.mediaItems,
      resizeGuidelines: state.timeline.resizeGuidelines,
      globalSubtitleStyling: state.timeline.globalSubtitleStyling,
      aspectRatio: state.timeline.aspectRatio,
      liveDurationOverrides: state.timeline.liveDurationOverrides,
    }),
    shallowEqual
  );

  const currentTime = useSelector((state: RootState) => state.timeline.currentTime);

  // ── Media element refs ───────────────────────────────────────────────────
  // All maps are keyed by clipId (per-clip) or mediaKey (shared per source file).
  // Using refs instead of state prevents render cycles during media operations.
  const videoRefs              = useRef<Map<string, HTMLVideoElement>>(new Map()); // per-clip (unused after move to groups)
  const videoRefsByMedia       = useRef<Map<string, HTMLVideoElement>>(new Map()); // shared per source file
  const lastActiveClipIdByMedia= useRef<Map<string, string>>(new Map());           // for cut-switch detection
  const audioRefs              = useRef<Map<string, HTMLAudioElement>>(new Map()); // per audio clip
  const imageRefs              = useRef<Map<string, HTMLImageElement>>(new Map()); // per image/gif clip
  const nodeRefMap             = useRef<Map<string, React.RefObject<any>>>(new Map()); // generic node refs
  const aspectRatioByClipRef   = useRef<Map<string, number>>(new Map());            // natural width/height ratio

  // ── Responsive canvas dimensions ─────────────────────────────────────────
  // Tracked so ClipRenderer can pass containerDimensions to MediaItemRenderer
  // (e.g. for computing responsive masonry column counts in subtitle windows)
  const [containerHeight, setContainerHeight] = useState<number>(400);
  const [containerWidth,  setContainerWidth]  = useState<number>(750);
  const [availableSize,   setAvailableSize]   = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  /**
   * Returns (or lazily creates) a stable React ref for a given clip ID.
   * TransitionRenderer passes these to UniversalClipRenderer for DOM access.
   */
  const getNodeRef = (clipId: string): React.RefObject<any> => {
    let ref = nodeRefMap.current.get(clipId);
    if (!ref) {
      ref = React.createRef<any>();
      nodeRefMap.current.set(clipId, ref);
    }
    return ref;
  };

  // ── Derived data (memoised) ───────────────────────────────────────────────

  // Exclude transition/effect clips from the media list so they don't get their
  // own renderer (they are handled by the `activeTransitions` loop below)
  const mediaOnlyClips = useMemo(() => {
    return Object.values(clips).filter(c => c && !["transition", "fade", "xfade"].includes(c.type));
  }, [clips]);

  /**
   * allMediaElements: flat array of all renderable clips, each paired with its
   * resolved MediaItem and track.  Text/subtitle clips that have no MediaItem
   * get a synthetic virtual item so SubtitleRenderer can access `textContent`.
   * Sorted ascending by z-index so higher-z items are rendered last (on top).
   */
  const allMediaElements = useMemo(() => {
    const elements: MediaElement[] = [];
    mediaOnlyClips.forEach((clip) => {
      const track = tracks.find((t) => t.id === clip.trackId);
      if (!track) return;

      let mediaItem = mediaItems.find((m: any) => 
        (clip.mediaId && m.id === clip.mediaId) || 
        (clip.url && m.url === clip.url) || 
        (m.name === clip.name && m.type === clip.type)
      );
      
      if (!mediaItem && (clip.type === "text" || clip.type === "subtitle")) {
        mediaItem = { id: `virtual-${clip.id}`, type: clip.type, name: clip.name, url: "", textContent: clip.name };
      }

      if (!mediaItem) return;

      const trackIndex = tracks.findIndex((t) => t.id === track.id);
      const videoTrackOrder = tracks.map((t, idx) => ({ t, idx })).filter(x => x.t.type === "video").map(x => x.idx).sort((a,b) => a-b);
      const baseRank = (clip.type === "text" || clip.type === "subtitle") ? 1 : (videoTrackOrder.indexOf(trackIndex) >= 0 ? videoTrackOrder.indexOf(trackIndex) + 1 : 3);
      
      elements.push({ clip, track, mediaItem, localTime: 0, zIndex: clip.zIndex ?? baseRank });
    });
    return elements.sort((a, b) => a.zIndex - b.zIndex);
  }, [mediaOnlyClips, tracks, mediaItems]);

  /**
   * allVideoGroups: groups video clips by their source file (mediaKey).
   * Each group shares one `<video>` element managed by VideoGroupRenderer.
   * Clips within a group are sorted by start time so cut-advance logic works
   * correctly (it scans `allClipsSorted` to find the next clip after a cut).
   */
  const allVideoGroups = useMemo(() => {
    const groups = new Map<string, any>();
    allMediaElements.filter(el => el.clip.type === "video").forEach(el => {
      const mediaKey = el.clip.id || el.mediaItem.id || el.mediaItem.url || el.mediaItem.name;
      if (!groups.has(mediaKey)) {
        groups.set(mediaKey, { mediaKey, mediaItem: el.mediaItem, clips: [], zIndex: el.zIndex });
      }
      groups.get(mediaKey).clips.push(el.clip);
    });
    return Array.from(groups.values()).map(group => ({
      ...group,
      allClipsSorted: [...group.clips].sort((a, b) => a.start - b.start)
    }));
  }, [allMediaElements]);

  /**
   * activeTransitions: all transition clips whose window currently overlaps
   * the playhead.  For each, we look up the two neighbouring media clips
   * (fromClip before the midpoint, toClip after) so they can be passed to
   * the correct TransitionRenderer component.
   *
   * Uses `pivot = start + duration/2` as the transition midpoint to identify
   * which clip is outgoing and which is incoming.
   */
  const activeTransitions = useMemo(() => {
    const transitions: any[] = [];
    const transitionClips = Object.values(clips).filter(c => c.type === "transition" || c.type === "fade" || c.type === "xfade" || (c.isEffect && !["video", "image", "gif", "text", "subtitle"].includes(c.type)));

    transitionClips.forEach((tc) => {
      if (currentTime >= tc.start && currentTime <= tc.start + tc.duration) {
        const pivot = tc.start + tc.duration / 2;
        const mediaClips = Object.values(clips).filter(c => !["transition", "fade", "xfade"].includes(c.type) && !c.isEffect);
        
        const fromClip = mediaClips.find(c => c.start <= pivot - 0.05 && c.start + (liveDurationOverrides?.[c.id] ?? c.duration) >= pivot - 0.05);
        const toClip = mediaClips.find(c => c.start <= pivot + 0.05 && c.start + (liveDurationOverrides?.[c.id] ?? c.duration) >= pivot + 0.05);

        transitions.push({
          id: tc.id,
          type: tc.effectType || tc.type,
          startTime: tc.start,
          duration: tc.duration,
          fromClip: fromClip?.id,
          toClip: toClip?.id
        });
      }
    });
    return transitions;
  }, [clips, currentTime, liveDurationOverrides]);

  const totalDuration = useMemo(() => calculateTimelineDuration(clips, liveDurationOverrides) || 10, [clips, liveDurationOverrides]);

  // Combined Hooks
  const { isResizing, isDragging, getClipTransform, handleResizeStart, mediaTransforms } = useCanvasInteraction({
    clips, resizeGuidelines, aspectRatioByClipRef, dispatch
  });

  usePlayerAudio({ allMediaElements, audioRefs, currentTime, liveDurationOverrides, isPlaying });

  usePlayerMediaSync({
    isPlaying, currentTime, totalDuration, dispatch, allMediaElements, allVideoGroups,
    videoRefs, audioRefs, videoRefsByMedia, lastActiveClipIdByMedia, liveDurationOverrides
  });

  /**
   * getAspectRatioStyle
   * Computes the canvas dimensions that fill the player container while
   * respecting the chosen aspect ratio.  Letter-boxes or pillar-boxes the
   * canvas as needed.
   */
  const getAspectRatioStyle = () => {
    const [rw, rh] = aspectRatio.split(":").map(Number);
    const ar = rh ? rw / rh : 16 / 9;
    const boxW = containerWidth;
    const boxH = containerHeight;
    const boxRatio = boxW / boxH;

    let contentW = boxW;
    let contentH = boxH;
    if (boxRatio > ar) {
      contentH = boxH;
      contentW = Math.round(boxH * ar);
    } else {
      contentW = boxW;
      contentH = Math.round(boxW / ar);
    }

    return { width: `${contentW}px`, height: `${contentH}px`, position: "relative" as const, display: "block" as const };
  };

  // ── Fullscreen ────────────────────────────────────────────────────────────
  // Uses the native Fullscreen API.  When exiting fullscreen, the scrubber
  // is re-shown if it had been hidden (to avoid a permanently invisible overlay).
  const toggleFullscreen = useCallback(() => {
    if (!playerContainerRef.current) return;
    if (!document.fullscreenElement) {
      playerContainerRef.current.requestFullscreen().catch(err => console.error(err));
    } else {
      document.exitFullscreen();
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNowFullscreen = !!document.fullscreenElement;
      setIsFullscreen(isNowFullscreen);
      if (!isNowFullscreen && !showPlayerScrubber) dispatch(togglePlayerScrubber());
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [showPlayerScrubber, dispatch]);

  // ── ResizeObserver: track canvas container dimensions ────────────────────
  // Dimensions are used for aspect-ratio calculations and passed to renderers
  // so they can compute responsive layouts (e.g. subtitle window widths).
  useEffect(() => {
    const update = () => {
      const container = document.querySelector("[data-player-container]") as HTMLElement;
      if (container) {
        const rect = container.getBoundingClientRect();
        setContainerHeight(rect.height);
        setContainerWidth(rect.width);
      }
      if (outerContainerRef.current) {
        const rect = outerContainerRef.current.getBoundingClientRect();
        setAvailableSize({ width: rect.width, height: rect.height });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    if (playerContainerRef.current) ro.observe(playerContainerRef.current);
    window.addEventListener("resize", update);
    return () => { ro.disconnect(); window.removeEventListener("resize", update); };
  }, []);

  // ── Teardown: pause and clear all media elements on unmount ──────────────
  useEffect(() => {
    return () => {
      [videoRefs, audioRefs, videoRefsByMedia].forEach(map => map.current.forEach(el => { try { el.pause(); } catch{} }));
      [videoRefs, audioRefs, imageRefs, videoRefsByMedia].forEach(map => map.current.clear());
    };
  }, []);

  const currentTransform = resizeGuidelines.clipId ? getClipTransform(resizeGuidelines.clipId) : { x: 50, y: 50, width: 100, height: 100, scaleX: 1, scaleY: 1 };

  return (
    <div
      ref={playerContainerRef}
      className={`h-full bg-muted/20 flex items-center justify-center relative rounded-[20px] border border-border overflow-hidden ${isFullscreen ? "w-screen h-screen z-[9999] rounded-none border-none" : ""}`}
      data-player-container
    >
      {allMediaElements.length > 0 ? (
        <div className="w-full h-full flex items-center justify-center p-4" ref={outerContainerRef}>
          <div className="relative rounded-md border-2 border-primary/60 overflow-hidden" style={getAspectRatioStyle()} ref={aspectContainerRef}>
            
            {/* ── Transition clips (rendered first, manage their own z-index) ── */}
            {activeTransitions.map((t) => {
              const props = { key: t.id, transition: t, currentTime, allClips: clips, tracks, mediaItems, liveDurationOverrides, getClipTransform, getNodeRef, imageRefs, audioRefs, videoRefsByMedia, lastActiveClipIdByMedia, aspectRatioByClipRef, isPlaying, globalSubtitleStyling, containerDimensions: { width: containerWidth, height: containerHeight }, dispatch, setCurrentTime };
              if (t.type === "fade" || t.type === "dissolve") return <FadeTransition {...props} />;
              if (t.type === "fadeblack") return <FadeBlackTransition {...props} />;
              if (t.type === "fadewhite") return <FadeWhiteTransition {...props} />;
              if (t.type.startsWith("wipe")) return <WipeTransition {...props} direction={t.type.replace("wipe", "") as any || "left"} />;
              if (t.type.startsWith("slide")) return <SlideTransition {...props} direction={t.type.replace("slide", "") as any || "left"} />;
              if (t.type === "circlecrop") return <CircularTransition {...props} />;
              if (t.type === "rectcrop") return <RectCropTransition {...props} />;
              if (t.type === "circleclose") return <CircleCloseTransition {...props} />;
              return null;
            })}

            {/* ── Media clips (filtered to exclude clips managed by transitions) ── */}
            <React.Fragment>
              {allMediaElements
                .filter(el => !activeTransitions.some(t => t.fromClip === el.clip.id || t.toClip === el.clip.id))
                .map((el) => {
                  const duration = liveDurationOverrides?.[el.clip.id] ?? el.clip.duration;
                  const isActuallyActive = currentTime >= el.clip.start && currentTime <= el.clip.start + duration;
                  
                  // Look-ahead: mount the element up to 3 s before it becomes active
                  // so that video/audio elements have time to buffer.
                  // Mounted with opacity 0 so the user can't see them yet.
                  const isLookAhead = !isActuallyActive && 
                                     currentTime < el.clip.start && 
                                     currentTime >= el.clip.start - 3;
                  
                  if (!isActuallyActive && !isLookAhead) return null;

                  if (el.clip.type === "video") {
                    const group = allVideoGroups.find(g => g.clips.some((c: any) => c.id === el.clip.id));
                    if (!group) return null;
                    return (
                      <VideoGroupRenderer
                        key={el.clip.id}
                        group={{ ...group, activeClip: el.clip }}
                        currentTime={currentTime}
                        liveDurationOverrides={liveDurationOverrides}
                        getClipTransform={getClipTransform}
                        videoRefsByMedia={videoRefsByMedia}
                        lastActiveClipIdByMedia={lastActiveClipIdByMedia}
                        aspectRatioByClipRef={aspectRatioByClipRef}
                        isPlaying={isPlaying}
                        dispatch={dispatch}
                        setCurrentTime={setCurrentTime}
                        opacityOverride={isLookAhead ? 0 : undefined}
                        ignoreBounds={isLookAhead}
                      />
                    );
                  }
                  return (
                    <MediaItemRenderer
                      key={el.clip.id}
                      element={{ ...el, localTime: currentTime - el.clip.start }}
                      currentTime={currentTime}
                      liveDurationOverrides={liveDurationOverrides}
                      getClipTransform={getClipTransform}
                      getNodeRef={getNodeRef}
                      imageRefs={imageRefs}
                      audioRefs={audioRefs}
                      aspectRatioByClipRef={aspectRatioByClipRef}
                      isPlaying={isPlaying}
                      globalSubtitleStyling={globalSubtitleStyling}
                      containerDimensions={{ width: containerWidth, height: containerHeight }}
                      opacityOverride={isLookAhead ? 0 : undefined}
                      ignoreBounds={isLookAhead}
                    />
                  );
                })}
            </React.Fragment>

            {/* ── Resize interaction overlay ── */}
            {/* Shown for the clip currently selected in the MediaStylingPanel.
                Provides: dashed selection border, corner handles, snap guidelines,
                a size readout badge, and a close button. */}
            {resizeGuidelines.isVisible && resizeGuidelines.clipId && (
              <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 1500 }}>
                {/* Snap Guidelines */}
                {resizeGuidelines.snapX !== null && resizeGuidelines.snapX !== undefined && (
                  <div 
                    className="absolute top-0 bottom-0 border-l border-blue-400/80 shadow-[0_0_8px_rgba(59,130,246,0.5)] z-[1499]"
                    style={{ left: `${resizeGuidelines.snapX}%` }}
                  />
                )}
                {resizeGuidelines.snapY !== null && resizeGuidelines.snapY !== undefined && (
                  <div 
                    className="absolute left-0 right-0 border-t border-blue-400/80 shadow-[0_0_8px_rgba(59,130,246,0.5)] z-[1499]"
                    style={{ top: `${resizeGuidelines.snapY}%` }}
                  />
                )}

                <div
                  className="absolute border-2 border-blue-500 border-dashed bg-blue-500/10 rounded-lg pointer-events-auto transition-all duration-75"
                  style={{ 
                    left: `${currentTransform.x}%`, 
                    top: `${currentTransform.y}%`, 
                    width: `${currentTransform.width}%`, 
                    height: `${currentTransform.height}%`, 
                    minWidth: "50px", 
                    minHeight: "50px", 
                    transform: "translate(-50%, -50%)", 
                    zIndex: 1501,
                    // Subtle scale effect when snapping
                    scale: (resizeGuidelines.snapX !== null || resizeGuidelines.snapY !== null) ? 1.02 : 1
                  }}
                >
                  <div className="absolute inset-0 cursor-move pointer-events-auto" onMouseDown={(e) => handleResizeStart(e, "move", aspectContainerRef)} onTouchStart={(e) => handleResizeStart(e, "move", aspectContainerRef)} />
                  {/* Corner Handles */}
                  {["both", "width", "height"].map((type: any) => (
                      <div key={type} className="absolute pointer-events-auto" />
                  ))}
                   <div className="absolute -right-2 -top-2 w-4 h-4 bg-blue-500 border-2 border-white rounded-full cursor-se-resize pointer-events-auto" onMouseDown={(e) => handleResizeStart(e, "both", aspectContainerRef)} />
                   <div className="absolute -left-2 -top-2 w-4 h-4 bg-blue-500 border-2 border-white rounded-full cursor-sw-resize pointer-events-auto" onMouseDown={(e) => handleResizeStart(e, "both", aspectContainerRef)} />
                   <div className="absolute -right-2 -bottom-2 w-4 h-4 bg-blue-500 border-2 border-white rounded-full cursor-ne-resize pointer-events-auto" onMouseDown={(e) => handleResizeStart(e, "both", aspectContainerRef)} />
                   <div className="absolute -left-2 -bottom-2 w-4 h-4 bg-blue-500 border-2 border-white rounded-full cursor-nw-resize pointer-events-auto" onMouseDown={(e) => handleResizeStart(e, "both", aspectContainerRef)} />
                   
                   {/* Info & Reset */}
                   <div className="absolute -top-8 left-0 bg-blue-500 text-white px-2 py-1 rounded text-xs font-medium whitespace-nowrap flex items-center gap-2">
                       <span>{Math.round(currentTransform.width)}% × {Math.round(currentTransform.height)}%</span>
                       <button onClick={() => dispatch(hideResizeGuidelines())}>×</button>
                   </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="text-center text-muted-foreground p-8">
           <h3 className="text-lg font-medium mb-1">No Clips at this Time</h3>
           <p className="text-sm">Scrub or play to preview your project</p>
        </div>
      )}

      <PlayerControls 
        currentTime={currentTime} 
        totalDuration={totalDuration} 
        isFullscreen={isFullscreen} 
        showPlayerScrubber={showPlayerScrubber}
        dispatch={dispatch}
        toggleFullscreen={toggleFullscreen}
        handleTimelineClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            dispatch(setCurrentTime((e.clientX - rect.left) / rect.width * totalDuration));
        }}
        handleTimelineMouseDown={(e) => {
            const target = e.currentTarget;
            const move = (me: MouseEvent) => {
                const r = target.getBoundingClientRect();
                dispatch(setCurrentTime(Math.max(0, Math.min(totalDuration, (me.clientX - r.left) / r.width * totalDuration))));
            };
            const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
            document.addEventListener("mousemove", move);
            document.addEventListener("mouseup", up);
        }}
      />
    </div>
  );
};

export default React.memo(Player);
