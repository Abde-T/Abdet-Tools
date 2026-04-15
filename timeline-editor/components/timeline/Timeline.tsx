/**
 * Timeline.tsx
 *
 * The root container component for the Timeline Editor MVP.
 *
 * This component acts as the primary orchestrator that binds together the three
 * main UI areas: Library Panels, Player Canvas, and the Timeline Canvas.
 *
 * Features:
 * - **Layout Management**: Uses `useTimelineLayout` to toggle between three
 *   preset layouts (Default, Player on top, Library on top).
 * - **Panel State**: Uses `useLibraryNavigation` to manage which styling
 *   or media tab is currently visible in the sidebar.
 * - **Event Routing**: Uses `useTimelineEvents` to handle global hotkeys
 *   (e.g., Space to play/pause) and intercept DOM events to open the right tabs.
 * - **Redux Glue**: Selects minimal slices of data from `timelineSlice` and
 *   passes mapped callbacks (like `updateClip` or `handleApplyTextStylingToAll`)
 *   down to the isolated panel components.
 *
 * Design Notes:
 * The component defines a `LibraryPanel` internally to prevent code duplication,
 * as the panel needs to be rendered in completely different DOM positions
 * depending on the active layout mode.
 */
import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import { useSelector, useDispatch, shallowEqual, Provider } from "react-redux";
import { store, RootState } from "../../redux/store";
import "../../theme.css";

import { useTimelineLayout } from "./hooks/useTimelineLayout";
import { useLibraryNavigation } from "../mediahub/hooks/useLibraryNavigation";
import { useTimelineEvents } from "./hooks/useTimelineEvents";

import TimelineCanvas from "./components/TimelineCanvas";
import MediaHub from "../mediahub/components/MediaHub";
import EffectsLibrary from "../mediahub/components/EffectsLibrary";
import Player from "../player/Player";
import Controls from "../player/components/Controls";
import { Button } from "../ui/button";

import {
  Check,
  Plus,
  Layers,
  Move,
  ArrowLeftRight,
  Scissors,
  Trash2,
  Undo2,
  Volume2,
  ZoomIn,
  PlayCircle,
  Maximize2,
  LayoutTemplate,
  HelpCircle,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "../ui/dropdown-menu";

import SubtitleStylingPanel, {
  SubtitleStylingOptions,
} from "../mediahub/components/SubtitleStylingPanel";
import ResizableSplitter from "./components/ResizableSplitter";
import MediaStylingPanel from "../mediahub/components/MediaStylingPanel";
import { AppDispatch } from "../../redux/store";
import {
  togglePlayback,
  updateClip,
  updateClipsByGroup,
  removeMediaItem,
  removeClipsByMediaItem,
  updateVideoClipThumbnails,
} from "../../redux/timelineSlice";
import { cn } from "../../utils/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

/** The three layout modes the user can pick from the Layout dropdown. */
export type LayoutMode = "default" | "player_top" | "library_top";

/** The tabs available in the library panel on the left side. */
export type LibraryTab =
  | "media"
  | "effects"
  | "subtitle-styling"
  | "text-styling"
  | "media-styling";

// ─── GuideItem ────────────────────────────────────────────────────────────────
// A single row in the keyboard shortcut / guide dropdown.

interface GuideItemProps {
  icon: React.ReactNode;
  /** Tailwind background colour class for the icon circle, e.g. "bg-primary/10" */
  color: string;
  title: string;
  desc: React.ReactNode;
}

const GuideItem: React.FC<GuideItemProps> = ({ icon, color, title, desc }) => (
  <div className="flex gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors">
    <div
      className={`flex-shrink-0 w-8 h-8 rounded-full ${color} flex items-center justify-center`}
    >
      {icon}
    </div>
    <div className="flex-1 min-w-0">
      <div className="font-medium text-foreground text-sm">{title}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
    </div>
  </div>
);

// ─── LibraryPanel ─────────────────────────────────────────────────────────────
// The left-side panel that contains the Media Library, Effects Library, and
// the contextual styling panels (subtitle / text / media styling).
//
// This component is used in ALL THREE layout modes. Before this extraction it
// was copy-pasted three times (~120 lines each). Now it lives here once.

interface LibraryPanelProps {
  /** Which tab is currently visible */
  activeTab: LibraryTab;
  onTabChange: (tab: LibraryTab) => void;

  /** Controls which optional styling tabs appear */
  showSubtitleStyling: boolean;
  showTextStyling: boolean;
  showMediaStyling: boolean;

  /**
   * The rightmost visible tab — used to apply a rounded top-right corner
   * only to the last tab button.
   */
  lastTabKey: "subtitle-styling" | "text-styling" | "media-styling";

  /** Called when the user clicks the delete button on a media library item */
  onDeleteMedia: (name: string, type: string, id?: string) => void;

  /** Current styling values for the selected text/subtitle clip */
  subtitleStylingOptions: SubtitleStylingOptions;
  onTextStylingChange: (options: SubtitleStylingOptions) => void;
  onApplyTextStylingToAll: (options: SubtitleStylingOptions) => void;

  /** The clip currently selected for media/transform styling */
  selectedMediaClipId: string | null;

  /** Optional: round the top-left corner (used in layouts where panel is top-left) */
  roundTopLeft?: boolean;

  /** Optional refs for scroll restoration inside the styling panels */
  subtitleStylingRef?: React.RefObject<HTMLDivElement | null>;
  mediaStylingRef?: React.RefObject<HTMLDivElement | null>;
}

const LibraryPanel: React.FC<LibraryPanelProps> = ({
  activeTab,
  onTabChange,
  showSubtitleStyling,
  showTextStyling,
  showMediaStyling,
  lastTabKey,
  onDeleteMedia,
  subtitleStylingOptions,
  onTextStylingChange,
  onApplyTextStylingToAll,
  selectedMediaClipId,
  roundTopLeft = false,
  subtitleStylingRef,
  mediaStylingRef,
}) => {
  /**
   * Builds the CSS class string for a tab button.
   * Applies the active highlight and optional corner rounding.
   */
  const tabClass = (tab: LibraryTab, isLastTab = false) =>
    [
      "px-3 w-full py-3 text-sm font-medium transition-all duration-200",
      roundTopLeft && tab === "media" ? "rounded-tl-[20px]" : "",
      isLastTab ? "rounded-tr-[20px]" : "",
      activeTab === tab
        ? "bg-primary text-primary-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
    ]
      .filter(Boolean)
      .join(" ");

  return (
    <div className="h-full bg-card border-2 border-border overflow-hidden rounded-[20px] flex flex-col">
      {/* ── Tab Navigation ── */}
      <div className="border-b-2 border-border">
        <div className="flex items-center justify-between">
          {/* These two tabs are always visible */}
          <button
            onClick={() => onTabChange("media")}
            className={tabClass("media")}
          >
            Media <span className="sm:inline hidden">Library</span>
          </button>

          <button
            onClick={() => onTabChange("effects")}
            className={tabClass("effects")}
          >
            Effects <span className="sm:inline hidden">Library</span>
          </button>

          {/* Subtitle Styling tab — only shown when subtitle clips exist on the timeline */}
          {showSubtitleStyling && (
            <button
              onClick={() => onTabChange("subtitle-styling")}
              className={tabClass(
                "subtitle-styling",
                lastTabKey === "subtitle-styling",
              )}
            >
              <span className="sm:inline hidden">Subtitle</span> Styling
            </button>
          )}

          {/* Text Styling tab — only shown when text clips exist on the timeline */}
          {showTextStyling && (
            <button
              onClick={() => onTabChange("text-styling")}
              className={tabClass(
                "text-styling",
                lastTabKey === "text-styling",
              )}
            >
              <span className="sm:inline hidden">Text</span> Styling
            </button>
          )}

          {/* Media Styling tab — only shown when media clips exist on the timeline */}
          {showMediaStyling && (
            <button
              onClick={() => onTabChange("media-styling")}
              className={tabClass(
                "media-styling",
                lastTabKey === "media-styling",
              )}
            >
              <span className="sm:inline hidden">Media</span> Styling
            </button>
          )}
        </div>
      </div>

      {/* ── Tab Content ── */}
      <div className="flex-1 overflow-y-auto  sm:overflow-hidden p-2 relative">
        {/* Upload / manage media files */}
        {activeTab === "media" && <MediaHub onDeleteMedia={onDeleteMedia} />}

        {/* Drag-and-drop transition effects */}
        {activeTab === "effects" && <EffectsLibrary />}

        {/* Subtitle clip styling (position, font, karaoke, etc.) */}
        {showSubtitleStyling && activeTab === "subtitle-styling" && (
          <div className="h-full" ref={subtitleStylingRef}>
            <SubtitleStylingPanel
              stylingOptions={subtitleStylingOptions}
              onStylingChange={onTextStylingChange}
            />
          </div>
        )}

        {/* Text clip styling (font, colour, etc. — no karaoke or position) */}
        {showTextStyling && activeTab === "text-styling" && (
          <div className="h-full">
            <SubtitleStylingPanel
              stylingOptions={subtitleStylingOptions}
              onStylingChange={onTextStylingChange}
              titleOverride="Customize Text Styling"
              hideKaraoke
              hidePosition
            />
          </div>
        )}

        {/* Media/image/video transform styling (scale, position, crop, etc.) */}
        {showMediaStyling &&
          activeTab === "media-styling" &&
          selectedMediaClipId && (
            <div className="h-full overflow-y-auto" ref={mediaStylingRef}>
              {/* key={selectedMediaClipId} resets the panel whenever a different clip is selected */}
              <MediaStylingPanel
                key={selectedMediaClipId}
                clipId={selectedMediaClipId}
              />
            </div>
          )}
      </div>
    </div>
  );
};

// ─── Timeline ────────────────────────────────────────────────────────
// The root editor component. Wires together the Redux store, layout switching,
// responsive sizing, and all sub-components.

const TimelineInner: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();

  // ─── Redux State ─────────────────────────────────────────────────────────────
  // We read only what this component actually uses.
  // shallowEqual prevents unnecessary re-renders when unrelated store keys change.
  const { zoom, clips, mediaItems, tracks, liveDurationOverrides } =
    useSelector(
      (state: RootState) => ({
        zoom: state.timeline.zoom,
        clips: state.timeline.clips,
        mediaItems: state.timeline.mediaItems,
        tracks: state.timeline.tracks,
        liveDurationOverrides: state.timeline.liveDurationOverrides,
      }),
      shallowEqual,
    );

  // ─── Custom Hooks for State & Events ────────────────────────────────────────

  const subtitleStylingRef = useRef<HTMLDivElement>(null);
  const mediaStylingRef = useRef<HTMLDivElement>(null);

  const {
    editorWidth,
    canvasSize,
    layoutMode,
    setLayoutMode,
    splitRatio,
    setSplitRatio,
    isMobileLibraryOpen,
    setIsMobileLibraryOpen,
    canvasContainerRef,
    timelineHeight,
  } = useTimelineLayout(tracks);

  const {
    activeTab,
    setActiveTab,
    showSubtitleStyling,
    setShowSubtitleStyling,
    showTextStyling,
    setShowTextStyling,
    showMediaStyling,
    setShowMediaStyling,
    selectedTextClipId,
    setSelectedTextClipId,
    selectedMediaClipId,
    setSelectedMediaClipId,
  } = useLibraryNavigation(clips);

  useTimelineEvents({
    dispatch,
    setSelectedTextClipId,
    setShowSubtitleStyling,
    setShowTextStyling,
    setShowMediaStyling,
    setActiveTab,
    setSelectedMediaClipId,
    setIsMobileLibraryOpen,
    zoom,
    clips,
    mediaItems,
    tracks,
  });

  /**
   * The rightmost tab button — we give it a rounded top-right corner.
   * Falls back to "media-styling" when nothing else is visible.
   */
  const lastTabKey: LibraryPanelProps["lastTabKey"] = showMediaStyling
    ? "media-styling"
    : showTextStyling
      ? "text-styling"
      : "subtitle-styling";

  // ─── Event Handlers ───────────────────────────────────────────────────────────

  /**
   * Returns the current styling values for the selected text/subtitle clip.
   * Used to pre-populate the styling panel inputs.
   */
  const getSelectedTextStyling = useCallback((): SubtitleStylingOptions => {
    if (selectedTextClipId && clips[selectedTextClipId]) {
      return {
        ...(clips[selectedTextClipId].styling || {}),
      } as SubtitleStylingOptions;
    }
    return {} as SubtitleStylingOptions;
  }, [selectedTextClipId, clips]);

  /**
   * Applies styling changes from the panel to the selected clip.
   * If the clip is part of a subtitle group, all clips in that group are
   * updated together (one Redux dispatch instead of N).
   */
  const handleTextStylingChange = useCallback(
    (options: SubtitleStylingOptions) => {
      if (!selectedTextClipId) return;
      const clip = clips[selectedTextClipId];
      if (!clip) return;

      if (clip.subtitleGroupId) {
        // Group update: one dispatch updates every clip sharing this group ID
        dispatch(
          updateClipsByGroup({
            groupId: clip.subtitleGroupId,
            updates: { styling: { ...options } },
          }),
        );
      } else {
        // Single clip update
        dispatch(
          updateClip({
            clipId: selectedTextClipId,
            updates: { styling: { ...options } },
          }),
        );
      }
    },
    [selectedTextClipId, clips, dispatch],
  );

  /**
   * Applies the current styling to every text and subtitle clip on the timeline.
   * Triggered by the "Apply to all" button in the Text Styling panel.
   */
  const handleApplyTextStylingToAll = useCallback(
    (options: SubtitleStylingOptions) => {
      const groupIds = new Set<string>();
      const soloClipIds: string[] = [];

      // Sort clips into groups vs standalone
      Object.values(clips).forEach((clip: any) => {
        if (clip.type === "text" || clip.type === "subtitle") {
          if (clip.subtitleGroupId) groupIds.add(clip.subtitleGroupId);
          else soloClipIds.push(clip.id);
        }
      });

      groupIds.forEach((groupId) =>
        dispatch(
          updateClipsByGroup({ groupId, updates: { styling: { ...options } } }),
        ),
      );

      soloClipIds.forEach((clipId) =>
        dispatch(updateClip({ clipId, updates: { styling: { ...options } } })),
      );
    },
    [clips, dispatch],
  );

  /**
   * Removes a media item from the library and removes every clip on the
   * timeline that was created from that item.
   * Can be matched by ID (preferred) or by name + type (fallback).
   */
  const handleRemoveMedia = (name: string, type: string, id?: string) => {
    const item = id
      ? mediaItems.find((m: any) => m.id === id)
      : mediaItems.find((m: any) => m.name === name && m.type === type);

    if (!item) return;

    dispatch(
      removeClipsByMediaItem({
        name: item.name,
        type: item.type,
        mediaId: item.id,
      }),
    );
    dispatch(removeMediaItem(item.id));
  };

  // ─── Shared Library Panel Props ───────────────────────────────────────────────
  // Collected here so we don't repeat these same props three times in the JSX below.

  const sharedLibraryProps: Omit<
    LibraryPanelProps,
    "roundTopLeft" | "subtitleStylingRef" | "mediaStylingRef"
  > = {
    activeTab,
    onTabChange: setActiveTab,
    showSubtitleStyling,
    showTextStyling,
    showMediaStyling,
    lastTabKey,
    onDeleteMedia: handleRemoveMedia,
    subtitleStylingOptions: getSelectedTextStyling(),
    onTextStylingChange: handleTextStylingChange,
    onApplyTextStylingToAll: handleApplyTextStylingToAll,
    selectedMediaClipId,
  };

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div
      className={cn(
        "timeline-theme-root relative mb-20 border-2 border-border shadow-md rounded-[30px] p-2 flex flex-col bg-background text-foreground w-full max-w-full transition-colors duration-300",
      )}
      style={{
        width: `${editorWidth}px`,
      }}
    >
      {/* ══ Header ══════════════════════════════════════════════════════════════ */}
      <div className="bg-card border-1 shadow-sm border-border px-4 sm:px-6 py-2 sm:py-4 rounded-[20px]">
        <div className="flex flex-wrap items-center justify-between">
          {/* Title */}
          <div className="flex justify-center items-center gap-2">
            <h1 className="text-2xl font-black italic text-foreground">
              Timeline Editor
            </h1>
          </div>

          {/* Action buttons */}
          <div className="mt-4 md:mt-0 grid grid-cols-2 w-full md:w-auto md:flex sm:flex-row items-center gap-2">
            {/* ── Guide dropdown ── */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <HelpCircle className="w-4 h-4 transform -scale-x-100" />
                  Guide
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-96 max-h-[350px] overflow-y-auto"
                sideOffset={8}
              >
                <DropdownMenuLabel className="text-base text-foreground font-semibold pb-3">
                  Timeline Guide & Shortcuts
                </DropdownMenuLabel>
                <DropdownMenuSeparator />

                {/* Media management tips */}
                <div className="p-3 space-y-3">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    Media Management
                  </div>
                  <GuideItem
                    icon={<Plus className="w-4 h-4 text-primary" />}
                    color="bg-primary/10"
                    title="Add Media"
                    desc="Drag from Media panel into a matching track"
                  />
                  <GuideItem
                    icon={<Layers className="w-4 h-4 text-blue-500" />}
                    color="bg-blue-500/10"
                    title="Add Tracks"
                    desc="Hover near the bottom of the last track while dragging"
                  />
                </div>

                <DropdownMenuSeparator />

                {/* Editing tips */}
                <div className="p-3 space-y-3">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    Editing
                  </div>
                  <GuideItem
                    icon={<Move className="w-4 h-4 text-green-500" />}
                    color="bg-green-500/10"
                    title="Move Clips"
                    desc="Drag horizontally or vertically to another track"
                  />
                  <GuideItem
                    icon={
                      <ArrowLeftRight className="w-4 h-4 text-purple-500" />
                    }
                    color="bg-purple-500/10"
                    title="Resize Clip"
                    desc="Drag the right edge handle of a clip"
                  />
                  <GuideItem
                    icon={<Scissors className="w-4 h-4 text-orange-500" />}
                    color="bg-orange-500/10"
                    title="Cut Clip"
                    desc="Position playhead and click the cut button"
                  />
                  <GuideItem
                    icon={<Trash2 className="w-4 h-4 text-red-500" />}
                    color="bg-red-500/10"
                    title="Cut Before/After"
                    desc="Remove everything before or after playhead"
                  />
                </div>

                <DropdownMenuSeparator />

                {/* Keyboard shortcuts */}
                <div className="p-3 space-y-3">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    Controls
                  </div>
                  <GuideItem
                    icon={<Undo2 className="w-4 h-4 text-amber-500" />}
                    color="bg-amber-500/10"
                    title="Undo/Redo"
                    desc="Revert or reapply cut operations"
                  />
                  <GuideItem
                    icon={<Volume2 className="w-4 h-4 text-pink-500" />}
                    color="bg-pink-500/10"
                    title="Adjust Volume"
                    desc="Right-click audio/video clip for volume slider"
                  />
                  <GuideItem
                    icon={<ZoomIn className="w-4 h-4 text-cyan-500" />}
                    color="bg-cyan-500/10"
                    title="Zoom"
                    desc={
                      <>
                        <kbd className="px-1 py-0.5 bg-muted rounded text-foreground text-[10px]">
                          CTRL
                        </kbd>{" "}
                        +{" "}
                        <kbd className="px-1 py-0.5 bg-muted rounded text-foreground text-[10px]">
                          Scroll
                        </kbd>
                      </>
                    }
                  />
                  <GuideItem
                    icon={<ArrowLeftRight className="w-4 h-4 text-cyan-500" />}
                    color="bg-cyan-500/10"
                    title="Horizontal Scroll"
                    desc={
                      <>
                        <kbd className="px-1 py-0.5 bg-muted rounded text-foreground text-[10px]">
                          ALT
                        </kbd>{" "}
                        +{" "}
                        <kbd className="px-1 py-0.5 bg-muted rounded text-foreground text-[10px]">
                          Scroll
                        </kbd>
                      </>
                    }
                  />
                  <GuideItem
                    icon={<PlayCircle className="w-4 h-4 text-rose-500" />}
                    color="bg-rose-500/10"
                    title="Playhead"
                    desc="Click or drag the red playhead to scrub"
                  />
                  <GuideItem
                    icon={<Maximize2 className="w-4 h-4 text-indigo-500" />}
                    color="bg-indigo-500/10"
                    title="Resize Guides"
                    desc="Double-click clip to toggle guidelines in player"
                  />
                </div>
              </DropdownMenuContent>
            </DropdownMenu>



            {/* ── Layout switcher (desktop only) ── */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 hidden lg:flex"
                >
                  <LayoutTemplate className="w-4 h-4" />
                  Layout
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setLayoutMode("default")}>
                  {layoutMode === "default" && (
                    <Check className="w-4 h-4 mr-2" />
                  )}
                  Default (Side-by-Side Top)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLayoutMode("player_top")}>
                  {layoutMode === "player_top" && (
                    <Check className="w-4 h-4 mr-2" />
                  )}
                  Player on Top
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLayoutMode("library_top")}>
                  {layoutMode === "library_top" && (
                    <Check className="w-4 h-4 mr-2" />
                  )}
                  Library on Top
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* ── Mobile: show/hide media library button ── */}
            <button
              onClick={() => setIsMobileLibraryOpen(!isMobileLibraryOpen)}
              className="lg:hidden flex items-center space-x-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="text-sm font-medium">
                {isMobileLibraryOpen ? "Hide" : "Show"} Media
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* ══ Main Content ════════════════════════════════════════════════════════ */}
      <div className="flex flex-col my-2 gap-4">
        {/* ──────────────────────────────────────────────────────────────────────
            Layout: DEFAULT
            Library panel (left 40%) + Player (right 60%) on top,
            full-width Timeline strip below.
        ────────────────────────────────────────────────────────────────────── */}
        {layoutMode === "default" && (
          <>
            <div
              className={`flex ${isMobileLibraryOpen ? "flex-col-reverse" : "flex-col"} lg:flex-row gap-2`}
            >
              {/* Library — hidden on mobile unless the toggle button is pressed */}
              <div
                className={`${isMobileLibraryOpen ? "block" : "hidden"} lg:block w-full lg:w-[40%] h-[352px] sm:h-[402px] flex-shrink-0 transition-all duration-300`}
              >
                <LibraryPanel
                  {...sharedLibraryProps}
                  roundTopLeft
                  subtitleStylingRef={subtitleStylingRef}
                  mediaStylingRef={mediaStylingRef}
                />
              </div>

              {/* Player preview */}
              <div className="relative bg-muted/20 w-full overflow-hidden h-[250px] sm:h-[400px]">
                <Player />
              </div>
            </div>

            {/* Timeline */}
            <div className="border-2 -mb-2 w-full border-border rounded-[20px] overflow-hidden">
              <Controls />
              <div
                className="w-full bg-card border-t-2 border-border rounded-b-lg transition-[height] duration-200 ease-in-out"
                style={{ height: timelineHeight }}
              >
                <div className="h-full p-2 sm:p-4">
                  <div
                    ref={canvasContainerRef}
                    className="w-full border-2 border-border rounded-lg bg-muted/30 transition-[height] duration-200 ease-in-out"
                    style={{ height: timelineHeight - 32 }}
                    data-timeline-container
                  >
                    <TimelineCanvas
                      width={canvasSize.width + 500}
                      height={timelineHeight - 32}
                    />
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ──────────────────────────────────────────────────────────────────────
            Layout: PLAYER TOP
            Full-width Player on top, Library + Timeline side-by-side below.
        ────────────────────────────────────────────────────────────────────── */}
        {layoutMode === "player_top" && (
          <div className="flex flex-col gap-2">
            {/* Full-width player */}
            <div className="relative bg-muted/20 w-full overflow-hidden h-[300px] sm:h-[500px] border-2 border-border rounded-[20px] ">
              <Player />
            </div>

            {/* Library | drag-splitter | Timeline */}
            <div className="flex flex-row h-[600px] gap-0 overflow-hidden">
              <div
                style={{ width: `${splitRatio}%` }}
                className="border-2 border-border rounded-[20px] rounded-bl-[20px] h-full pb-2"
              >
                <LibraryPanel {...sharedLibraryProps} />
              </div>

              <ResizableSplitter
                id="splitter-1"
                splitRatio={splitRatio}
                setSplitRatio={setSplitRatio}
                minRatio={30}
                maxRatio={50}
              />

              <div
                style={{ width: `${100 - splitRatio}%` }}
                className="h-full flex flex-col border-2 border-border rounded-lg rounded-br-[20px] bg-card"
              >
                <Controls />
                <div className="flex-1 p-2 overflow-hidden">
                  <div
                    ref={canvasContainerRef}
                    className="w-full h-full border-2 border-border rounded-lg bg-muted/30"
                    data-timeline-container
                  >
                    <TimelineCanvas
                      width={canvasSize.width + 500}
                      height={500}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ──────────────────────────────────────────────────────────────────────
            Layout: LIBRARY TOP
            Full-width Library on top, Player + Timeline side-by-side below.
        ────────────────────────────────────────────────────────────────────── */}
        {layoutMode === "library_top" && (
          <div className="flex flex-col gap-2">
            {/* Full-width library panel (centered, half-width) */}
            <div className="h-[400px] w-[50%] mx-auto bg-card border-2 border-border rounded-[20px] flex flex-col">
              <LibraryPanel {...sharedLibraryProps} roundTopLeft />
            </div>

            {/* Player | drag-splitter | Timeline */}
            <div className="flex flex-row h-[600px] gap-0 rounded-lg rounded-bl-[20px] pb-2 overflow-hidden">
              <div
                style={{ width: `${splitRatio}%` }}
                className="h-full relative bg-muted/20"
                data-player-container
              >
                <Player />
              </div>

              <ResizableSplitter
                id="splitter-2"
                splitRatio={splitRatio}
                setSplitRatio={setSplitRatio}
                minRatio={30}
                maxRatio={50}
              />

              <div
                style={{ width: `${99 - splitRatio}%` }}
                className="h-full flex flex-col border-2 border-border rounded-lg rounded-br-[20px] bg-card pr-4"
              >
                <Controls />
                <div className="flex-1 p-2 overflow-hidden">
                  <div
                    ref={canvasContainerRef}
                    className="w-full h-full border-2 border-border rounded-lg bg-muted/30"
                    data-timeline-container
                  >
                    <TimelineCanvas
                      width={canvasSize.width + 500}
                      height={500}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const Timeline: React.FC = () => {
  return (
    <Provider store={store}>
      <TimelineInner />
    </Provider>
  );
};

export default Timeline;
