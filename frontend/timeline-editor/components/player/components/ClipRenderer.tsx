import React, { useMemo, useEffect } from "react";
import { Clip, Track } from "../../../redux/timelineSlice";
import { getInterpolatedKeyframeValues } from "../utils/PlayerMath";

import SubtitleRenderer from "./SubtitleRenderer";
import { ChromaKeyCanvas } from "./ChromaKeyCanvas";
import {
  convertBrightnessForCSS,
  convertContrastForCSS,
  convertSaturationForCSS,
} from "../../mediahub/components/MediaStylingPanel";

/**
 * ClipRenderer.tsx
 *
 * Contains the two core rendering components that put clips on screen:
 *
 * - **MediaItemRenderer** – renders non-video clips (images, GIFs, audio, text/subtitle).
 *   Each instance is memoised with a fine-grained `areEqual` comparator so only clips
 *   whose data or active state has actually changed will re-render.
 *
 * - **VideoGroupRenderer** – renders video clips.  Multiple clips that share the same
 *   source file are grouped together and share a single `<video>` element, only seeking
 *   the element when a cut boundary is crossed.  This avoids the cost of remounting
 *   a video element on every cut.
 *
 * Both components accept `opacityOverride` and `brightnessOverride` so that
 * TransitionRenderer can drive their appearance during crossfades and wipes.
 *
 * The `ignoreBounds` flag disables the active-time guard so transition-managed clips
 * can remain mounted even when `currentTime` is outside their normal window (the
 * transition is responsible for visibility via opacity/clip-path instead).
 */

/**
 * Represents a single renderable clip along with its resolved media item,
 * the track it lives on, the time within the clip, and its z-order.
 * This is the canonical type passed between Player.tsx and the renderers.
 */
export interface MediaElement {
  clip: Clip;
  track: Track;
  mediaItem: any;
  /** Seconds elapsed since the clip's own start (i.e. `currentTime - clip.start`) */
  localTime: number;
  /** Render order: lower = further back; text/subtitle always at 2000 */
  zIndex: number;
}

/**
 * MediaItemRenderer
 *
 * Renders a single non-video clip as a positioned, styled HTML element.
 * Handles: image, GIF, audio (hidden), text, subtitle.
 *
 * Video clips return `null` here — they are handled by `VideoGroupRenderer`
 * because multiple cuts from the same source file share one `<video>` element.
 *
 * Props:
 * @param opacityOverride   - 0–1 multiplier applied on top of the clip's own opacity;
 *                            used by transition renderers for crossfade control
 * @param brightnessOverride - 0–∞ multiplier on the brightness filter;
 *                            used by fade-black / fade-white transitions
 * @param ignoreBounds      - when true, skip the active-time guard so the clip stays
 *                            mounted outside its window (for transition overlap)
 */
export const MediaItemRenderer: React.FC<{
  element: MediaElement;
  currentTime: number;
  liveDurationOverrides: Record<string, number> | undefined;
  getClipTransform: (id: string) => any;
  getNodeRef: (id: string) => React.RefObject<any>;
  imageRefs: React.MutableRefObject<Map<string, HTMLImageElement>>;
  audioRefs: React.MutableRefObject<Map<string, HTMLAudioElement>>;
  aspectRatioByClipRef: React.MutableRefObject<Map<string, number>>;
  isPlaying: boolean;
  globalSubtitleStyling: any;
  containerDimensions: { width: number; height: number };
  opacityOverride?: number;
  brightnessOverride?: number;
  ignoreBounds?: boolean;
}> = React.memo(
  ({
    element,
    currentTime,
    liveDurationOverrides,
    getClipTransform,
    getNodeRef,
    imageRefs,
    audioRefs,
    aspectRatioByClipRef,
    isPlaying,
    globalSubtitleStyling,
    containerDimensions,
    opacityOverride,
    brightnessOverride,
    ignoreBounds,
  }) => {
    const { clip, mediaItem, localTime, zIndex } = element;
    const { type } = clip;

    // Duration may be overridden (e.g. if speed was changed in MediaStylingPanel)
    const duration = liveDurationOverrides?.[clip.id] ?? clip.duration;

    // Skip rendering if the playhead is outside this clip's window,
    // unless ignoreBounds is set (used by transition renderers)
    const isCurrentlyActive =
      ignoreBounds ||
      (currentTime >= clip.start && currentTime <= clip.start + duration);

    if (!isCurrentlyActive) return null;

    const clipTransform = getClipTransform(clip.id);

    // Get interpolated property values from the clip's keyframe list (if any)
    const keyframeValues = getInterpolatedKeyframeValues(
      clip.keyframes,
      localTime,
      {
        position: clipTransform,
        size: clipTransform,
        styling: clip.styling || {},
      },
    );

    const finalStyle = useMemo(() => {
      // Merge keyframe values over the base styling; keyframe values take priority
      const finalX = keyframeValues?.position?.x ?? clipTransform.x;
      const finalY = keyframeValues?.position?.y ?? clipTransform.y;
      const finalW = keyframeValues?.size?.width  ?? clipTransform.width;
      const finalH = keyframeValues?.size?.height ?? clipTransform.height;

      const isTextLike = type === "text" || type === "subtitle";

      const baseStyling: any = clip.styling || {};
      // activeStyling: keyframe values override base styling for animated props
      const activeStyling = {
        ...baseStyling,
        rotate: keyframeValues?.rotate ?? baseStyling.rotate ?? 0,
        opacity: keyframeValues?.opacity ?? 100,
        brightness: keyframeValues?.brightness ?? baseStyling.brightness ?? 100,
        contrast: keyframeValues?.contrast ?? baseStyling.contrast ?? 100,
        saturation: keyframeValues?.saturation ?? baseStyling.saturation ?? 100,
        hue: keyframeValues?.hue ?? baseStyling.hue ?? 0,
        blur: keyframeValues?.blur ?? baseStyling.blur ?? 0,
        grayscale: keyframeValues?.grayscale ?? baseStyling.grayscale ?? 0,
        sepia: keyframeValues?.sepia ?? baseStyling.sepia ?? 0,
        invert: keyframeValues?.invert ?? baseStyling.invert ?? 0,
        sharpen: keyframeValues?.sharpen ?? baseStyling.sharpen ?? 0,
        roundedCorners:
          keyframeValues?.roundedCorners ?? baseStyling.roundedCorners ?? 0,
      };

      // Build a single CSS filter string from all the active visual properties.
      // `convertBrightnessForCSS` etc. normalise the 0–200 % UI range to CSS values.
      // `brightnessOverride` is a multiplier applied by transition renderers.
      const filter = `brightness(${convertBrightnessForCSS(
        (activeStyling.brightness ?? 100) *
          (brightnessOverride !== undefined ? brightnessOverride : 1),
      )}%) contrast(${convertContrastForCSS(
        activeStyling.contrast ?? 100,
      )}%) saturate(${convertSaturationForCSS(
        activeStyling.saturation ?? 100,
      )}%) hue-rotate(${activeStyling.hue ?? 0}deg) blur(${
        activeStyling.blur ?? 0
      }px) grayscale(${(activeStyling.grayscale ?? 0) / 100}) sepia(${
        (activeStyling.sepia ?? 0) / 100
      }) invert(${(activeStyling.invert ?? 0) / 100})${
        activeStyling.sharpen && activeStyling.sharpen > 0
          ? ` contrast(${100 + activeStyling.sharpen / 2}%) saturate(${
              100 + activeStyling.sharpen / 2
            }%)`
          : ""
      }`;

      // Sharpen is simulated by stacking additional contrast + saturation
      // (same as the classic "unsharp mask" trick done in FFmpeg)

      const borderRadius =
        activeStyling.roundedCorners && activeStyling.roundedCorners > 0
          ? `${activeStyling.roundedCorners}px`
          : undefined;

      // Fade-in / fade-out envelope: ramp opacity based on how far into the
      // fade region the current localTime sits. Skipped when opacityOverride
      // is set (transition renderers manage opacity externally).
      let fadeOpacity = activeStyling.opacity / 100;
      if (!ignoreBounds && opacityOverride === undefined) {
        if (clip.fadeInDuration && localTime < clip.fadeInDuration) {
          fadeOpacity *= localTime / clip.fadeInDuration;
        } else if (
          clip.fadeOutDuration &&
          localTime > duration - clip.fadeOutDuration
        ) {
          fadeOpacity *= (duration - localTime) / clip.fadeOutDuration;
        }
      }

      return {
        container: {
          position: "absolute" as const,
          left: `${finalX}%`,
          top: `${finalY}%`,
          width: `${finalW}%`,
          height: `${finalH}%`,
          transform: `translate(-50%, -50%)`,
          zIndex: isTextLike ? 2000 : 1000 - zIndex,
          opacity: Math.max(
            0,
            Math.min(
              1,
              fadeOpacity *
                (opacityOverride !== undefined ? opacityOverride : 1),
            ),
          ),
        },
        activeStyling,
        filter,
        borderRadius,
      };
    }, [
      clipTransform,
      keyframeValues,
      zIndex,
      type,
      clip.styling,
      clip.fadeInDuration,
      clip.fadeOutDuration,
      localTime,
      duration,
      opacityOverride,
      brightnessOverride,
    ]);

    const transitionClass = "";

    switch (type) {
      case "video":
        return null;

      case "gif":
        const sGif = finalStyle.activeStyling;
        const hasChromaKey = sGif.greenScreenEnabled;
        const chromaKeyColor = sGif.greenScreenColor || "#00FF00";
        const chromaKeySimilarity = Math.max(
          0,
          Math.min(1, sGif.greenScreenSimilarity ?? 0.3),
        );
        const chromaKeyBlend = Math.max(
          0,
          Math.min(1, sGif.greenScreenBlend ?? 0.2),
        );

        return (
          <React.Fragment key={clip.id}>
            {hasChromaKey ? (
              <ChromaKeyCanvas
                src={mediaItem.url}
                color={chromaKeyColor}
                similarity={chromaKeySimilarity}
                blend={chromaKeyBlend}
                className={`object-fill ${transitionClass}`}
                style={{
                  ...finalStyle.container,
                  transform: `${finalStyle.container.transform} rotate(${
                    sGif.rotate || 0
                  }deg) scale(${sGif.flipH ? -1 : 1}, ${sGif.flipV ? -1 : 1})`,
                  filter: finalStyle.filter,
                  borderRadius: finalStyle.borderRadius,
                  overflow: "hidden",
                }}
                onLoad={() => {
                  const canvas = document.querySelector(
                    `canvas[data-clip-id="${clip.id}"]`,
                  ) as HTMLCanvasElement;
                  if (canvas && canvas.width && canvas.height) {
                    aspectRatioByClipRef.current.set(
                      clip.id,
                      canvas.width / canvas.height,
                    );
                  }
                }}
              />
            ) : (
              <img
                ref={(el) => {
                  const nodeRef = getNodeRef(clip.id) as any;
                  if (nodeRef) (nodeRef as any).current = el as any;
                  if (el) {
                    imageRefs.current.set(clip.id, el);
                    const handler = () => {
                      if (el.naturalWidth && el.naturalHeight) {
                        aspectRatioByClipRef.current.set(
                          clip.id,
                          el.naturalWidth / el.naturalHeight,
                        );
                      }
                    };
                    if (el.complete) {
                      handler();
                    } else {
                      el.addEventListener("load", handler, { once: true });
                    }
                  } else {
                    imageRefs.current.delete(clip.id);
                  }
                }}
                src={mediaItem.url}
                alt={clip.name}
                width={1000}
                height={1000}
                className={`object-fill ${transitionClass}`}
                style={{
                  ...finalStyle.container,
                  transform: `${finalStyle.container.transform} rotate(${
                    sGif.rotate || 0
                  }deg) scale(${sGif.flipH ? -1 : 1}, ${sGif.flipV ? -1 : 1})`,
                  filter: finalStyle.filter,
                  borderRadius: finalStyle.borderRadius,
                  overflow: "hidden",
                }}
              />
            )}
          </React.Fragment>
        );

      case "image":
        const sImage = finalStyle.activeStyling;
        const hasChromaKeyImage = sImage.greenScreenEnabled;
        const chromaKeyColorImage = sImage.greenScreenColor || "#00FF00";
        const chromaKeySimilarityImage = Math.max(
          0,
          Math.min(1, sImage.greenScreenSimilarity ?? 0.3),
        );
        const chromaKeyBlendImage = Math.max(
          0,
          Math.min(1, sImage.greenScreenBlend ?? 0.2),
        );

        return (
          <React.Fragment key={clip.id}>
            {hasChromaKeyImage ? (
              <ChromaKeyCanvas
                src={mediaItem.url}
                color={chromaKeyColorImage}
                similarity={chromaKeySimilarityImage}
                blend={chromaKeyBlendImage}
                className={`object-fill ${transitionClass}`}
                style={{
                  ...finalStyle.container,
                  transform: `${finalStyle.container.transform} rotate(${
                    sImage.rotate || 0
                  }deg) scale(${sImage.flipH ? -1 : 1}, ${
                    sImage.flipV ? -1 : 1
                  })`,
                  filter: finalStyle.filter,
                  borderRadius: finalStyle.borderRadius,
                  overflow: "hidden",
                }}
                onLoad={() => {
                  const canvas = document.querySelector(
                    `canvas[data-clip-id="${clip.id}"]`,
                  ) as HTMLCanvasElement;
                  if (canvas && canvas.width && canvas.height) {
                    aspectRatioByClipRef.current.set(
                      clip.id,
                      canvas.width / canvas.height,
                    );
                  }
                }}
              />
            ) : (
              <img
                ref={(el) => {
                  const nodeRef = getNodeRef(clip.id) as any;
                  if (nodeRef) (nodeRef as any).current = el as any;
                  if (el) {
                    imageRefs.current.set(clip.id, el);
                    const handler = () => {
                      if (el.naturalWidth && el.naturalHeight) {
                        aspectRatioByClipRef.current.set(
                          clip.id,
                          el.naturalWidth / el.naturalHeight,
                        );
                      }
                    };
                    if (el.complete) {
                      handler();
                    } else {
                      el.addEventListener("load", handler, { once: true });
                    }
                  } else {
                    imageRefs.current.delete(clip.id);
                  }
                }}
                src={mediaItem.url}
                alt={clip.name}
                width={1000}
                height={1000}
                className={`object-fill ${transitionClass}`}
                style={{
                  ...finalStyle.container,
                  transform: `${finalStyle.container.transform} rotate(${
                    sImage.rotate || 0
                  }deg) scale(${sImage.flipH ? -1 : 1}, ${
                    sImage.flipV ? -1 : 1
                  })`,
                  filter: finalStyle.filter,
                  borderRadius: finalStyle.borderRadius,
                  overflow: "hidden",
                }}
              />
            )}
          </React.Fragment>
        );

      case "audio":
        return (
          <audio
            key={clip.id}
            ref={(el) => {
              if (el && audioRefs.current.get(clip.id) !== el) {
                audioRefs.current.set(clip.id, el);
                try {
                  el.muted = false;
                  el.volume = 1;
                } catch {}
                const duration =
                  liveDurationOverrides?.[clip.id] ?? clip.duration;
                el.currentTime = Math.max(0, Math.min(duration, localTime));
                if (isPlaying) {
                  el.play().catch(() => {});
                }
              }
            }}
            style={{
              position: "absolute",
              width: 0,
              height: 0,
              opacity: 0,
              pointerEvents: "none",
            }}
            crossOrigin="anonymous"
            preload="auto"
            src={mediaItem.url}
          />
        );

      case "text":
      case "subtitle":
        const isSubtitle = type === "subtitle";
        const clipStyling = isSubtitle
          ? { ...globalSubtitleStyling, ...finalStyle.activeStyling }
          : finalStyle.activeStyling;

        const getPositionClass = (position?: string) => {
          switch (position) {
            case "top":
              return "items-start justify-center";
            case "bottom":
              return "items-end justify-center";
            case "top-left":
              return "items-start justify-start";
            case "top-right":
              return "items-start justify-end";
            case "bottom-left":
              return "items-end justify-start";
            case "bottom-right":
              return "items-end justify-end";
            case "center":
            default:
              return "items-center justify-center";
          }
        };

        return (
          <div
            key={clip.id}
            className={`flex pointer-events-none ${getPositionClass(
              (clipStyling as any).position,
            )}`}
            style={finalStyle.container}
          >
            <SubtitleRenderer
              text={mediaItem.textContent || clip.name || ""}
              currentTime={currentTime}
              startTime={clip.start}
              duration={duration}
              styling={clipStyling}
              // aspectRatio should be passed here, but it was coming from selector in orig
              aspectRatio="16:9"
            />
          </div>
        );

      default:
        return null;
    }
  },
  // ── Custom areEqual comparator ──────────────────────────────────────────
  // React.memo by default does a shallow prop comparison.  We replace it with
  // a fine-grained check so that clips which are outside their active window
  // and have no keyframes / fades never re-render during playback.
  (prevProps, nextProps) => {
    // Always re-render if the clip data itself changed (e.g. from MediaStylingPanel)
    if (prevProps.element.clip !== nextProps.element.clip) return false;

    if (
      prevProps.element.mediaItem.id !== nextProps.element.mediaItem.id ||
      prevProps.isPlaying !== nextProps.isPlaying ||
      prevProps.opacityOverride !== nextProps.opacityOverride ||
      prevProps.brightnessOverride !== nextProps.brightnessOverride ||
      prevProps.ignoreBounds !== nextProps.ignoreBounds ||
      prevProps.liveDurationOverrides !== nextProps.liveDurationOverrides ||
      prevProps.globalSubtitleStyling !== nextProps.globalSubtitleStyling ||
      prevProps.containerDimensions.width !==
        nextProps.containerDimensions.width ||
      prevProps.containerDimensions.height !==
        nextProps.containerDimensions.height
    ) {
      return false;
    }

    const { clip } = nextProps.element;
    const prevTime = prevProps.currentTime;
    const nextTime = nextProps.currentTime;
    const duration =
      nextProps.liveDurationOverrides?.[clip.id] ?? clip.duration;

    const wasActive =
      prevTime >= clip.start && prevTime <= clip.start + duration;
    const isActive =
      nextTime >= clip.start && nextTime <= clip.start + duration;
    if (wasActive !== isActive) return false;
    if (!wasActive && !isActive && !nextProps.ignoreBounds) return true;

    const hasKeyframes = clip.keyframes && clip.keyframes.length > 0;
    const hasFades =
      (clip.fadeInDuration && clip.fadeInDuration > 0) ||
      (clip.fadeOutDuration && clip.fadeOutDuration > 0);
    if (hasKeyframes || hasFades) return false;
    if (clip.type === "audio") return false;
    if (clip.type === "subtitle") return false;

    return true;
  },
);

/**
 * VideoGroupRenderer
 *
 * Renders a group of clips that all reference the same source video file.
 * A single `<video>` element is shared across all clips in the group; when a
 * cut boundary is crossed the element's `currentTime` is jumped to the
 * correct source offset rather than re-mounting the element.
 *
 * Key responsibilities:
 *  - Sync the `<video>` element position via a `useEffect` that watches
 *    `currentTime` and `activeClip.sourceStart`
 *  - Show a buffering spinner overlay when `waiting` fires during playback
 *  - Apply all styling / filter / transform CSS from the active clip's settings
 *  - Overlay a `ChromaKeyCanvas` if green screen is enabled
 *  - Auto-advance to the next clip in the group when the source playhead
 *    reaches the cut end (`timeupdate` listener)
 *
 * @param group.activeClip      - the clip currently under the playhead
 * @param group.allClipsSorted  - all clips in the group, sorted by start time
 *                                (needed for the auto-advance logic)
 * @param localTimeOverride     - used by TransitionRenderer to set an explicit
 *                                local time independent of currentTime
 */
export const VideoGroupRenderer: React.FC<{
  group: any;
  currentTime: number;
  liveDurationOverrides: Record<string, number> | undefined;
  getClipTransform: (id: string) => any;
  videoRefsByMedia: React.MutableRefObject<Map<string, HTMLVideoElement>>;
  lastActiveClipIdByMedia: React.MutableRefObject<Map<string, string>>;
  aspectRatioByClipRef: React.MutableRefObject<Map<string, number>>;
  isPlaying: boolean;
  dispatch: any;
  setCurrentTime: any;
  opacityOverride?: number;
  brightnessOverride?: number;
  ignoreBounds?: boolean;
  localTimeOverride?: number;
}> = React.memo(
  ({
    group,
    currentTime,
    liveDurationOverrides,
    getClipTransform,
    videoRefsByMedia,
    lastActiveClipIdByMedia,
    aspectRatioByClipRef,
    isPlaying,
    dispatch,
    setCurrentTime,
    opacityOverride,
    brightnessOverride,
    ignoreBounds,
    localTimeOverride,
  }) => {
    const [isBuffering, setIsBuffering] = React.useState(false);
    const { mediaKey, mediaItem, activeClip, zIndex, allClipsSorted } = group;
    if (!activeClip) return null;

    const localTime = currentTime - activeClip.start;
    const clipTransform = getClipTransform(activeClip.id);
    const keyframeValues = getInterpolatedKeyframeValues(
      activeClip.keyframes,
      localTime,
      {
        position: clipTransform,
        size: clipTransform,
        styling: activeClip.styling || {},
      },
    );

    const finalStyle = useMemo(() => {
      const sBase: any = activeClip.styling || {};
      const s = {
        ...sBase,
        rotate: keyframeValues?.rotate ?? sBase.rotate ?? 0,
        opacity: keyframeValues?.opacity ?? 100,
        brightness: keyframeValues?.brightness ?? sBase.brightness ?? 100,
        contrast: keyframeValues?.contrast ?? sBase.contrast ?? 100,
        saturation: keyframeValues?.saturation ?? sBase.saturation ?? 100,
        hue: keyframeValues?.hue ?? sBase.hue ?? 0,
        blur: keyframeValues?.blur ?? sBase.blur ?? 0,
        grayscale: keyframeValues?.grayscale ?? sBase.grayscale ?? 0,
        sepia: keyframeValues?.sepia ?? sBase.sepia ?? 0,
        invert: keyframeValues?.invert ?? sBase.invert ?? 0,
        sharpen: keyframeValues?.sharpen ?? sBase.sharpen ?? 0,
        roundedCorners:
          keyframeValues?.roundedCorners ?? sBase.roundedCorners ?? 0,
      };

      const finalX = keyframeValues?.position?.x ?? clipTransform.x;
      const finalY = keyframeValues?.position?.y ?? clipTransform.y;
      const finalW = keyframeValues?.size?.width ?? clipTransform.width;
      const finalH = keyframeValues?.size?.height ?? clipTransform.height;

      const sepiaVal = (s.sepia ?? 0) / 100;
      const enhancedSepia =
        sepiaVal > 0
          ? `sepia(${sepiaVal}) hue-rotate(${sepiaVal * 30}deg) saturate(${
              1 + sepiaVal * 1.9
            }) brightness(${1.5 + sepiaVal * 0.2})`
          : "sepia(0)";

      const filter = `brightness(${convertBrightnessForCSS(
        (s.brightness ?? 100) *
          (brightnessOverride !== undefined ? brightnessOverride : 1),
      )}%) contrast(${convertContrastForCSS(
        s.contrast ?? 100,
      )}%) saturate(${convertSaturationForCSS(
        s.saturation ?? 100,
      )}%) hue-rotate(${s.hue ?? 0}deg) blur(${s.blur ?? 0}px) grayscale(${
        (s.grayscale ?? 0) / 100
      }) ${enhancedSepia} invert(${(s.invert ?? 0) / 100})${
        s.sharpen && s.sharpen > 0
          ? ` contrast(${100 + s.sharpen / 2}%) saturate(${
              100 + s.sharpen / 2
            }%)`
          : ""
      }`;

      return {
        container: {
          position: "absolute" as const,
          left: `${finalX}%`,
          top: `${finalY}%`,
          width: `${finalW}%`,
          height: `${finalH}%`,
          transform: "translate(-50%, -50%)",
          zIndex: 1000 - zIndex,
          opacity: (() => {
            let op = s.opacity / 100;
            const duration =
              liveDurationOverrides?.[activeClip.id] ?? activeClip.duration;
            const localTime =
              localTimeOverride !== undefined
                ? localTimeOverride
                : currentTime - activeClip.start;

            if (!ignoreBounds && opacityOverride === undefined) {
              if (
                activeClip.fadeInDuration &&
                localTime < activeClip.fadeInDuration
              ) {
                op *= localTime / activeClip.fadeInDuration;
              } else if (
                activeClip.fadeOutDuration &&
                localTime > duration - activeClip.fadeOutDuration
              ) {
                op *= (duration - localTime) / activeClip.fadeOutDuration;
              }
            }

            if (opacityOverride !== undefined) {
              op *= opacityOverride;
            }

            return Math.max(0, Math.min(1, op));
          })(),
        },
        s,
        filter,
        borderRadius:
          s.roundedCorners && s.roundedCorners > 0
            ? `${s.roundedCorners}px`
            : undefined,
      };
    }, [
      clipTransform,
      keyframeValues,
      zIndex,
      activeClip.styling,
      activeClip.fadeInDuration,
      activeClip.fadeOutDuration,
      activeClip.start,
      activeClip.duration,
      currentTime,
      liveDurationOverrides,
      opacityOverride,
      brightnessOverride,
      localTimeOverride,
      ignoreBounds,
    ]);

    useEffect(() => {
      const el = videoRefsByMedia.current.get(mediaKey);
      if (!el || !activeClip) return;

      const duration =
        liveDurationOverrides?.[activeClip.id] ?? activeClip.duration;
      const local =
        localTimeOverride !== undefined
          ? localTimeOverride
          : currentTime - activeClip.start;

      const clampedLocal = Math.max(0, Math.min(duration, local));
      const inSource = (activeClip.sourceStart || 0) + clampedLocal;
      const driftThreshold = localTimeOverride !== undefined ? 0.05 : 0.2;

      if (Math.abs((el.currentTime || 0) - inSource) > driftThreshold) {
        try {
          el.currentTime = inSource;
        } catch {}
      }
    }, [
      currentTime,
      localTimeOverride,
      mediaKey,
      activeClip,
      liveDurationOverrides,
    ]);

    const hasChromaKeyVideo = finalStyle.s.greenScreenEnabled;
    const chromaKeyColorVideo = finalStyle.s.greenScreenColor || "#00FF00";
    const chromaKeySimilarityVideo = Math.max(
      0,
      Math.min(1, finalStyle.s.greenScreenSimilarity ?? 0.3),
    );
    const chromaKeyBlendVideo = Math.max(
      0,
      Math.min(1, finalStyle.s.greenScreenBlend ?? 0.2),
    );

    return (
      <div key={mediaKey} style={finalStyle.container}>
        <video
          ref={(el) => {
            if (el) {
              videoRefsByMedia.current.set(mediaKey, el);
              const handler = () => {
                if (el.videoWidth && el.videoHeight) {
                  aspectRatioByClipRef.current.set(
                    activeClip.id,
                    el.videoWidth / el.videoHeight,
                  );
                }
              };
              el.addEventListener("loadedmetadata", handler, { once: true });
              const onTime = () => {
                if (!isPlaying) return;
                const current = el.currentTime || 0;
                const cutStartInSource = activeClip.sourceStart || 0;
                const cutDur =
                  liveDurationOverrides?.[activeClip.id] ?? activeClip.duration;
                const cutEndInSource = cutStartInSource + cutDur;
                if (current > cutEndInSource - 0.02) {
                  const idx = allClipsSorted.findIndex(
                    (c: any) => c.id === activeClip.id,
                  );
                  const next = idx >= 0 ? allClipsSorted[idx + 1] : undefined;
                  if (next) {
                    const nextInSource = next.sourceStart || 0;
                    try {
                      el.currentTime = nextInSource;
                    } catch {}
                    dispatch(setCurrentTime(next.start));
                    lastActiveClipIdByMedia.current.set(mediaKey, next.id);
                  }
                }
              };
              el.addEventListener("timeupdate", onTime);
              (el as any).__cut_onTime__ = onTime;
              try {
                el.volume = Math.max(0, Math.min(1, activeClip.volume ?? 1));
              } catch {}
            } else {
              const prev = videoRefsByMedia.current.get(mediaKey);
              const h: any = (prev as any)?.__cut_onTime__;
              if (prev && h) {
                try {
                  prev.removeEventListener("timeupdate", h);
                } catch {}
              }
              videoRefsByMedia.current.delete(mediaKey);
            }
          }}
          className={`w-full h-full object-fill ${
            hasChromaKeyVideo ? "invisible" : ""
          }`}
          style={{
            ...finalStyle.container,
            left: 0,
            top: 0,
            width: "100%",
            height: "100%",
            transform: `rotate(${finalStyle.s.rotate || 0}deg) scale(${
              finalStyle.s.flipH ? -1 : 1
            }, ${finalStyle.s.flipV ? -1 : 1})`,
            filter: finalStyle.filter,
            borderRadius: finalStyle.borderRadius,
            overflow: "hidden",
          }}
          controls={false}
          muted={false}
          playsInline
          preload="auto"
          crossOrigin="anonymous"
          onWaiting={() => setIsBuffering(true)}
          onPlaying={() => setIsBuffering(false)}
          onCanPlay={() => setIsBuffering(false)}
        >
          <source src={mediaItem.url} type="video/mp4" />
        </video>
        {isBuffering && isPlaying && !ignoreBounds && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-[2px] z-[2001]">
            <div className="w-8 h-8 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          </div>
        )}
        {hasChromaKeyVideo && (
          <ChromaKeyCanvas
            src={mediaItem.url}
            isVideo={true}
            videoRef={{
              get current() {
                return videoRefsByMedia.current.get(mediaKey) || null;
              },
            }}
            color={chromaKeyColorVideo}
            similarity={chromaKeySimilarityVideo}
            blend={chromaKeyBlendVideo}
            className={`w-full h-full object-fill`}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              transform: `rotate(${finalStyle.s.rotate || 0}deg) scale(${
                finalStyle.s.flipH ? -1 : 1
              }, ${finalStyle.s.flipV ? -1 : 1})`,
              filter: finalStyle.filter,
              borderRadius: finalStyle.borderRadius,
              overflow: "hidden",
            }}
          />
        )}
      </div>
    );
  },
  (prevProps, nextProps) => {
    // If active clip reference changed, re-render
    if (prevProps.group.activeClip !== nextProps.group.activeClip) return false;
    if (prevProps.group.mediaKey !== nextProps.group.mediaKey) return false;

    if (
      prevProps.isPlaying !== nextProps.isPlaying ||
      prevProps.opacityOverride !== nextProps.opacityOverride ||
      prevProps.brightnessOverride !== nextProps.brightnessOverride ||
      prevProps.liveDurationOverrides !== nextProps.liveDurationOverrides ||
      prevProps.ignoreBounds !== nextProps.ignoreBounds ||
      prevProps.localTimeOverride !== nextProps.localTimeOverride
    ) {
      return false;
    }
    const { activeClip } = nextProps.group;
    const prevTime = prevProps.currentTime;
    const nextTime = nextProps.currentTime;
    const duration =
      nextProps.liveDurationOverrides?.[activeClip.id] ?? activeClip.duration;
    const wasActive =
      prevTime >= activeClip.start && prevTime <= activeClip.start + duration;
    const isActive =
      nextTime >= activeClip.start && nextTime <= activeClip.start + duration;
    if (wasActive !== isActive) return false;
    if (prevProps.group.activeClip.id !== nextProps.group.activeClip.id)
      return false;
    const hasKeyframes =
      activeClip.keyframes && activeClip.keyframes.length > 0;
    const hasFades =
      (activeClip.fadeInDuration && activeClip.fadeInDuration > 0) ||
      (activeClip.fadeOutDuration && activeClip.fadeOutDuration > 0);
    if (hasKeyframes || hasFades) return false;
    const drift = Math.abs(nextTime - prevTime);
    if (drift > 0.5) return false;
    return true;
  },
);

export const UniversalClipRenderer: React.FC<{
  clipId: string;
  currentTime: number;
  allClips: Record<string, Clip>;
  tracks: Track[];
  mediaItems: Record<string, any>;
  liveDurationOverrides: Record<string, number> | undefined;
  getClipTransform: (id: string) => any;
  getNodeRef: (id: string) => React.RefObject<any>;
  imageRefs: React.MutableRefObject<Map<string, HTMLImageElement>>;
  audioRefs: React.MutableRefObject<Map<string, HTMLAudioElement>>;
  videoRefsByMedia: React.MutableRefObject<Map<string, HTMLVideoElement>>;
  lastActiveClipIdByMedia: React.MutableRefObject<Map<string, string>>;
  aspectRatioByClipRef: React.MutableRefObject<Map<string, number>>;
  isPlaying: boolean;
  globalSubtitleStyling: any;
  containerDimensions: { width: number; height: number };
  dispatch: any;
  setCurrentTime: any;
  opacityOverride?: number;
  brightnessOverride?: number;
  ignoreBounds?: boolean;
  localTimeOverride?: number;
}> = (props) => {
  const {
    clipId,
    allClips,
    tracks,
    mediaItems,
    currentTime,
    localTimeOverride,
    ignoreBounds,
    imageRefs,
    audioRefs,
    aspectRatioByClipRef,
    videoRefsByMedia,
    lastActiveClipIdByMedia,
    isPlaying,
    globalSubtitleStyling,
    containerDimensions,
    dispatch,
    setCurrentTime,
    liveDurationOverrides,
    getClipTransform,
    getNodeRef,
    opacityOverride,
    brightnessOverride,
  } = props;
  const clip = allClips[clipId];
  if (!clip) return null;

  const track = tracks.find((t) => t.clips.some((c) => c === clipId));
  if (!track) return null;

  let mediaItem = mediaItems.find(
    (m: any) =>
      (clip.mediaId && m.id === clip.mediaId) ||
      (clip.url && m.url === clip.url) ||
      (m.name === clip.name && m.type === clip.type),
  );

  if (!mediaItem && (clip.type === "text" || clip.type === "subtitle")) {
    mediaItem = {
      id: `virtual-${clip.id}`,
      type: clip.type as any,
      name: clip.name,
      url: "",
      textContent: clip.name,
    } as any;
  }

  if (!mediaItem) return null;

  const element: MediaElement = {
    clip,
    track,
    mediaItem,
    localTime:
      localTimeOverride !== undefined
        ? localTimeOverride
        : currentTime - clip.start,
    zIndex: clip.zIndex || 0,
  };

  if (clip.type === "video") {
    return (
      <VideoGroupRenderer
        group={{
          mediaId: mediaItem.id,
          mediaKey: `transition-${clip.id}`,
          mediaItem,
          zIndex: clip.zIndex || 0,
          allClipsSorted: [clip],
          activeClip: clip,
        }}
        currentTime={currentTime}
        liveDurationOverrides={liveDurationOverrides}
        getClipTransform={getClipTransform}
        videoRefsByMedia={videoRefsByMedia}
        lastActiveClipIdByMedia={lastActiveClipIdByMedia}
        aspectRatioByClipRef={aspectRatioByClipRef}
        isPlaying={isPlaying}
        dispatch={dispatch}
        setCurrentTime={setCurrentTime}
        opacityOverride={opacityOverride}
        brightnessOverride={brightnessOverride}
        ignoreBounds={ignoreBounds}
        localTimeOverride={localTimeOverride}
      />
    );
  }

  return (
    <MediaItemRenderer
      element={element}
      currentTime={currentTime}
      liveDurationOverrides={liveDurationOverrides}
      getClipTransform={getClipTransform}
      getNodeRef={getNodeRef}
      imageRefs={imageRefs}
      audioRefs={audioRefs}
      aspectRatioByClipRef={aspectRatioByClipRef}
      isPlaying={isPlaying}
      globalSubtitleStyling={globalSubtitleStyling}
      containerDimensions={containerDimensions}
      opacityOverride={opacityOverride}
      brightnessOverride={brightnessOverride}
      ignoreBounds={ignoreBounds}
    />
  );
};
