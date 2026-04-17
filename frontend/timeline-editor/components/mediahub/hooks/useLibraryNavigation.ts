import { useState, useMemo, useEffect } from "react";
import { LibraryTab } from "../../timeline/Timeline";

/**
 * useLibraryNavigation
 *
 * Manages the state of the left-side library panel, including:
 * - Which tab is currently active (media, effects, subtitle-styling, etc.)
 * - Which contextual styling tabs should be visible based on what clip
 *   types exist on the timeline
 * - Which specific clip is selected for text or media styling
 *
 * This hook is reactive: it watches the `clips` map and automatically
 * hides styling tabs and clears selections when the relevant clips are
 * removed from the timeline.
 *
 * @param clips - The full clips map from the Redux store (Record<id, Clip>)
 */
export function useLibraryNavigation(clips: Record<string, any>) {
  // The currently visible tab in the library panel
  const [activeTab, setActiveTab] = useState<LibraryTab>("media");

  // Whether each specialised styling tab is visible in the tab bar
  const [showSubtitleStyling, setShowSubtitleStyling] = useState(false);
  const [showTextStyling, setShowTextStyling] = useState(false);
  const [showMediaStyling, setShowMediaStyling] = useState(false);

  // The ID of the clip currently open in the text/subtitle styling panel
  const [selectedTextClipId, setSelectedTextClipId] = useState<string | null>(
    null,
  );
  // The ID of the clip currently open in the media styling panel
  const [selectedMediaClipId, setSelectedMediaClipId] = useState<string | null>(
    null,
  );

  // Flatten the clips object into an array once so derived memos are stable
  const clipsArray = useMemo(() => Object.values(clips), [clips]);

  // Split clips by type so we can show/hide the correct styling tabs
  const { mediaClips, subtitleClips, textClips } = useMemo(() => {
    const media: any[] = [];
    const subtitles: any[] = [];
    const texts: any[] = [];

    for (const clip of clipsArray) {
      if (!clip) continue;
      // Media clips can be dropped onto the video or audio track
      if (["video", "image", "gif", "audio"].includes(clip.type))
        media.push(clip);
      else if (clip.type === "subtitle") subtitles.push(clip);
      else if (clip.type === "text") texts.push(clip);
    }

    return { mediaClips: media, subtitleClips: subtitles, textClips: texts };
  }, [clipsArray]);

  const hasMediaClips = mediaClips.length > 0;
  const hasSubtitleClips = subtitleClips.length > 0;
  const hasTextClips = textClips.length > 0;

  /**
   * Guard effect: when clips are removed from the timeline, hide any styling
   * tab that no longer has matching content, reset the active tab to "media",
   * and clear the stale selected clip ID.
   *
   * This prevents the UI from showing an empty styling panel after the user
   * deletes the last clip of a given type.
   */
  useEffect(() => {
    if (!hasMediaClips) {
      setShowMediaStyling(false);
      if (activeTab === "media-styling") setActiveTab("media");
    }
    if (!hasSubtitleClips) {
      setShowSubtitleStyling(false);
      if (activeTab === "subtitle-styling") setActiveTab("media");
    }
    if (!hasTextClips) {
      setShowTextStyling(false);
      if (activeTab === "text-styling") setActiveTab("media");
    }

    // If the selected media clip was deleted, clear it and close the panel
    if (selectedMediaClipId && !clips[selectedMediaClipId]) {
      setSelectedMediaClipId(null);
      setShowMediaStyling(false);
      if (activeTab === "media-styling") setActiveTab("media");
    }
    // If the selected text/subtitle clip was deleted, clear it and close the panel
    if (selectedTextClipId && !clips[selectedTextClipId]) {
      setSelectedTextClipId(null);
      setShowTextStyling(false);
      if (activeTab === "text-styling") setActiveTab("media");
    }
  }, [
    hasMediaClips,
    hasSubtitleClips,
    hasTextClips,
    clips,
    selectedMediaClipId,
    selectedTextClipId,
    activeTab,
  ]);

  return {
    // Active tab identity and setter
    activeTab,
    setActiveTab,

    // Visibility flags for contextual styling tabs
    showSubtitleStyling,
    setShowSubtitleStyling,
    showTextStyling,
    setShowTextStyling,
    showMediaStyling,
    setShowMediaStyling,

    // Selected clip IDs for the styling panels
    selectedTextClipId,
    setSelectedTextClipId,
    selectedMediaClipId,
    setSelectedMediaClipId,

    // Convenience booleans consumed by the Timeline parent
    hasMediaClips,
    hasSubtitleClips,
    hasTextClips,
  };
}
