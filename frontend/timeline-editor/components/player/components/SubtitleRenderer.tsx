import React, { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SubtitleStylingOptions } from "../../mediahub/components/SubtitleStylingPanel";

/**
 * SubtitleRenderer
 *
 * Renders animated subtitle text overlaid on the player canvas.
 * Takes a single cue string (`text`), the current playhead position,
 * and a `SubtitleStylingOptions` object and produces the correct animated
 * frame for that instant.
 *
 * ## Windowing
 *
 * Long cues are split into character-width "windows" that fit within the
 * canvas aspect ratio (22 chars for 9:16, 35 for 1:1, 60 for 16:9).
 * The active window is determined by how far through the cue the playhead is
 * (0 – 1 progress × word count).  This mimics word-by-word scrolling subtitles.
 *
 * ## Animation presets (driven by `styling.animationPreset`)
 *
 *  - `none`           – static text for the current window
 *  - `word-highlight` – each word changes colour when reached (karaoke mode)
 *  - `pop-in`         – words scale in from the bottom using a spring animation
 *  - `word-pop`       – single active word pops into view with spring scale
 *  - `typewriter`     – reveals characters one-by-one based on progress
 *
 * Framer Motion's `AnimatePresence` handles enter/exit transitions between
 * window changes for all presets.
 */

interface SubtitleRendererProps {
  text: string;
  currentTime: number;
  startTime: number;
  duration: number;
  styling: SubtitleStylingOptions;
  aspectRatio: string;
  containerClassName?: string;
}

const SubtitleRenderer: React.FC<SubtitleRendererProps> = ({
  text,
  currentTime,
  startTime,
  duration,
  styling,
  aspectRatio,
  containerClassName,
}) => {
  const words = useMemo(() => text.split(" "), [text]);

  // 0–1 progress through this cue (0 = cue start, 1 = cue end)
  const progress = Math.max(
    0,
    Math.min(1, (currentTime - startTime) / duration),
  );

  // Index of the word that is currently active based on playback progress
  const activeGlobalIndex = Math.floor(progress * words.length);

  // Max characters per visible window varies by aspect ratio so text fits the frame
  const maxChars = useMemo(() => {
    if (aspectRatio === "9:16") return 22;
    if (aspectRatio === "1:1")  return 35;
    return 60; // 16:9 or default
  }, [aspectRatio]);

  // Split the full word list into screen-sized windows of at most `maxChars` characters.
  // Each window records its starting word index in the original array so
  // we can map the activeGlobalIndex back to `windowLocalIndex` for animations.
  const windows = useMemo(() => {
    const result: { words: string[]; startIndex: number }[] = [];
    let currentWindow: string[] = [];
    let currentLength = 0;
    let startIndex = 0;

    words.forEach((word, index) => {
      // +1 for the space (except for the first word in a window)
      const wordLen = word.length + (currentWindow.length > 0 ? 1 : 0);

      if (currentLength + wordLen > maxChars && currentWindow.length > 0) {
        result.push({ words: currentWindow, startIndex });
        currentWindow = [word];
        currentLength = word.length;
        startIndex = index;
      } else {
        currentWindow.push(word);
        currentLength += wordLen;
      }
    });

    if (currentWindow.length > 0) {
      result.push({ words: currentWindow, startIndex });
    }

    return result;
  }, [words, maxChars]);

  // Find which window contains the currently active word index
  const currentWindow = useMemo(() => {
    const window = windows.find((w, i) => {
      const nextWindow = windows[i + 1];
      return (
        activeGlobalIndex >= w.startIndex &&
        (!nextWindow || activeGlobalIndex < nextWindow.startIndex)
      );
    });
    return window || windows[0];
  }, [windows, activeGlobalIndex]);

  const renderStyle = () => {
    if (!currentWindow) return null;

    const { words: windowWords, startIndex } = currentWindow;

    switch (styling.animationPreset) {
      case "word-highlight":
        return (
          <div className="flex flex-wrap justify-center gap-x-[0.25em]">
            {windowWords.map((word, i) => {
              const globalIndex = startIndex + i;
              return (
                <span
                  key={globalIndex}
                  className="transition-colors duration-200"
                  style={{
                    color:
                      globalIndex <= activeGlobalIndex && styling.enableKaraoke
                        ? styling.highlightColor || styling.primaryColor
                        : styling.primaryColor,
                  }}
                >
                  {word}
                </span>
              );
            })}
          </div>
        );

      case "pop-in":
        return (
          <div className="flex flex-wrap justify-center gap-x-[0.25em]">
            {windowWords.map((word, i) => {
              const globalIndex = startIndex + i;
              return (
                <motion.span
                  key={globalIndex}
                  initial={{ scaleY: 0, opacity: 0 }}
                  animate={
                    globalIndex <= activeGlobalIndex
                      ? { scaleY: 1, opacity: 1 }
                      : { scaleY: 0, opacity: 0 }
                  }
                  transition={{ type: "spring", damping: 12, stiffness: 200 }}
                  style={{
                    display: "inline-block",
                    color: styling.primaryColor,
                    transformOrigin: "bottom",
                  }}
                >
                  {word}
                </motion.span>
              );
            })}
          </div>
        );

      case "word-pop":
        return (
          <motion.div
            key={`${activeGlobalIndex}-${text}`}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", damping: 12, stiffness: 200 }}
            className="text-center"
            style={{
              color: styling.primaryColor,
            }}
          >
            {words[activeGlobalIndex]}
          </motion.div>
        );

      case "typewriter": {
        const windowText = windowWords.join(" ");
        // Find char offset of the current window in the full text
        const textBeforeWindow = words.slice(0, startIndex).join(" ");
        const charOffset = textBeforeWindow.length + (startIndex > 0 ? 1 : 0);

        const chars = text.split("");
        const globalCharProgress = Math.floor(progress * chars.length);
        const relativeCharProgress = Math.max(
          0,
          globalCharProgress - charOffset,
        );

        return (
          <div className="text-center whitespace-pre-wrap">
            {windowText.slice(0, relativeCharProgress)}
          </div>
        );
      }

      default:
        // Default simple rendering for current window
        return <div className="text-center">{windowWords.join(" ")}</div>;
    }
  };

  /**
   * Assembles the common CSS properties shared by all animation modes:
   * font, size, colour, outline (WebkitTextStroke), and drop shadow.
   */
  const getCommonStyles = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      fontSize: `${styling.fontSize}px`,
      fontFamily: styling.fontName,
      color: styling.primaryColor,
      lineHeight: 1.2,
      fontWeight: "bold",
    };

    // Apply outline and shadow
    base.WebkitTextStrokeWidth = `${styling.outlineWidth}px`;
    base.WebkitTextStrokeColor = styling.outlineColor;
    base.textShadow = `${styling.shadowDepth}px ${styling.shadowDepth}px 0px ${styling.shadowColor}`;

    return base;
  };

  return (
    <div className={containerClassName} style={getCommonStyles()}>
      <AnimatePresence mode="wait">{renderStyle()}</AnimatePresence>
    </div>
  );
};

export default SubtitleRenderer;
