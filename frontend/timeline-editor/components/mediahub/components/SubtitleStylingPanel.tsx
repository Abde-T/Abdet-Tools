"use client";

/**
 * SubtitleStylingPanel.tsx
 *
 * A tabbed styling panel for subtitle and text clips.  Lets the user control:
 *   - Font family and size
 *   - Primary text colour
 *   - Stroke/outline colour and width
 *   - Drop shadow colour and depth
 *   - On-screen position (hidden for plain text clips via `hidePosition`)
 *   - Animation presets (pop-in, word-pop, typewriter, word-highlight / karaoke)
 *   - Style presets (one-click style bundles like "Gaming Fun" or "Cyber Glow")
 *
 * It is reused for both subtitle clips and plain text clips via the
 * `hideKaraoke` and `hidePosition` props.  All changes are propagated
 * immediately to the parent via `onStylingChange` which dispatches to Redux.
 */

import React, { useState, useEffect } from "react";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Slider } from "../../ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card";
import { Separator } from "../../ui/separator";
import { RotateCcw, Palette, Type, Moon, Layers, Sparkles } from "lucide-react";
import { Carousel, CarouselContent, CarouselItem } from "../../ui/carousel";
import { Button } from "../../ui/button";

export type SubtitleAnimationPreset =
  | "none"
  | "word-highlight"
  | "pop-in"
  | "word-pop"
  | "typewriter";

export interface SubtitleStylingOptions {
  fontSize?: number;
  fontName?: string;
  primaryColor?: string;
  outlineColor?: string;
  outlineWidth?: number;
  shadowColor?: string;
  shadowDepth?: number;
  position?: string;
  enableKaraoke?: boolean;
  highlightColor?: string;
  animationPreset?: SubtitleAnimationPreset;
}

/**
 * Props for the SubtitleStylingPanel.
 *
 * @param titleOverride     - Replaces the default "Customize Subtitle Styling" heading
 * @param hideKaraoke       - When true, the Karaoke/highlight-color control is hidden
 *                            (used for plain text clips that don’t support word-level timing)
 * @param hidePosition      - When true, the Position tab is hidden (for text clips whose
 *                            position is fixed and controlled elsewhere)
 */
interface SubtitleStylingPanelProps {
  stylingOptions: SubtitleStylingOptions;
  onStylingChange: (options: SubtitleStylingOptions) => void;
  titleOverride?: string;
  hideKaraoke?: boolean;
  hidePosition?: boolean;
}

/** Font families available in the font picker.
 *  These must be loaded via a @font-face / Google Fonts link in the host app
 *  for the preview to render correctly. */
const FONT_FAMILIES = [
  "Montserrat",
  "Bungee",
  "Luckiest Guy",
  "Komika Axis",
  "Bebas Neue",
  "The Bold Font",
  "Fredoka",
  "Impact",
  "Inter",
  "Geist Sans",
];

/** Valid on-screen positions for subtitle placement */
const POSITIONS = [
  "top",
  "bottom",
  "center",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

/** Quick-pick colour swatches shown below the colour picker input */
const PRESET_COLORS = [
  "#FFFFFF", // White
  "#000000", // Black
  "#FF0000", // Red
  "#00FF00", // Green
  "#0000FF", // Blue
  "#FFFF00", // Yellow
  "#FF00FF", // Magenta
  "#00FFFF", // Cyan
  "#FFA500", // Orange
  "#800080", // Purple
  "#FFC0CB", // Pink
  "#A52A2A", // Brown
  "#808080", // Gray
  "#FFD700", // Gold
  "#32CD32", // Lime
];

/** Styling values applied when the user clicks "Reset" */
const DEFAULT_STYLING: SubtitleStylingOptions = {
  fontSize: 24,
  fontName: "Arial",
  primaryColor: "#FFFFFF",
  outlineColor: "#000000",
  outlineWidth: 0,
  shadowColor: "#000000",
  shadowDepth: 1,
  position: "bottom",
  animationPreset: "none",
};

/** Animation presets the user can apply; each maps to a renderer in the player */
const ANIMATION_PRESETS = [
  { id: "none", label: "None" },
  { id: "word-highlight", label: "Highlight" },
  { id: "pop-in", label: "Pop-In" },
  { id: "word-pop", label: "Word Pop" },
  { id: "typewriter", label: "Typewriter" },
];

/**
 * Pre-built style bundles that apply a cohesive combination of font, colour,
 * outline, shadow, and animation in one click.  Each preset is previewed in
 * the carousel using the actual font and colour via inline styles.
 */
const SUBTITLE_PRESETS: {
  id: string;
  label: string;
  config: SubtitleStylingOptions;
}[] = [
  {
    id: "impact-modern",
    label: "Impact Modern",
    config: {
      fontName: "Montserrat",
      primaryColor: "#FFFFFF",
      outlineColor: "#000000b7",
      outlineWidth: 1,
      shadowColor: "#000000",
      shadowDepth: 1,
      animationPreset: "pop-in",
    },
  },
  {
    id: "gaming-fun",
    label: "Gaming Fun",
    config: {
      fontName: "Luckiest Guy",
      primaryColor: "#FFFF00",
      outlineColor: "#000000",
      outlineWidth: 1,
      shadowColor: "#000000",
      shadowDepth: 0,
      animationPreset: "word-pop",
    },
  },
  {
    id: "bold-statement",
    label: "Bold Statement",
    config: {
      fontName: "Bebas Neue",
      primaryColor: "#FFFFFF",
      outlineColor: "#000000",
      outlineWidth: 0,
      shadowColor: "#FF0000",
      shadowDepth: 3,
      animationPreset: "none",
    },
  },
  {
    id: "comic-vibes",
    label: "Comic Vibes",
    config: {
      fontName: "Komika Axis",
      primaryColor: "#FFFFFF",
      outlineColor: "#000000",
      outlineWidth: 3,
      shadowColor: "#000000",
      shadowDepth: 0,
      animationPreset: "word-pop",
    },
  },
  {
    id: "urban-bold",
    label: "Urban Bold",
    config: {
      fontName: "The Bold Font",
      primaryColor: "#FFFFFF",
      outlineColor: "#000000",
      outlineWidth: 0,
      shadowColor: "#000000",
      shadowDepth: 3,
      animationPreset: "pop-in",
    },
  },
  {
    id: "soft-rounded",
    label: "Soft Rounded",
    config: {
      fontName: "Fredoka",
      primaryColor: "#00FFFF",
      outlineColor: "#FFFFFF",
      outlineWidth: 0,
      shadowColor: "#FFFFFF",
      shadowDepth: 1,
      animationPreset: "word-highlight",
      enableKaraoke: true,
      highlightColor: "#FFFFFF",
    },
  },
  {
    id: "blocky-high",
    label: "Blocky High",
    config: {
      fontName: "Bungee",
      primaryColor: "#FFA500",
      outlineColor: "#000000",
      outlineWidth: 2,
      shadowColor: "#000000",
      shadowDepth: 0,
      animationPreset: "typewriter",
    },
  },
  {
    id: "cyber-glow",
    label: "Cyber Glow",
    config: {
      fontName: "Impact",
      primaryColor: "#00FFCC",
      outlineColor: "#000000",
      outlineWidth: 1,
      shadowColor: "#006666",
      shadowDepth: 3,
      animationPreset: "pop-in",
    },
  },
  {
    id: "retro-pop",
    label: "Retro Pop",
    config: {
      fontName: "Bungee",
      primaryColor: "#FF00FF",
      outlineColor: "#FFFF00",
      outlineWidth: 1,
      shadowColor: "#000000",
      shadowDepth: 0,
      animationPreset: "word-pop",
    },
  },
  {
    id: "midnight",
    label: "Midnight",
    config: {
      fontName: "Montserrat",
      primaryColor: "#8888FF",
      outlineColor: "#000000",
      outlineWidth: 0,
      shadowColor: "#000000",
      shadowDepth: 5,
      animationPreset: "none",
    },
  },
  {
    id: "sunshine",
    label: "Sunshine",
    config: {
      fontName: "Fredoka",
      primaryColor: "#FFD700",
      outlineColor: "#FFFFFF",
      outlineWidth: 0,
      shadowColor: "#ffffffff",
      shadowDepth: 3,
      animationPreset: "word-pop",
    },
  },
  {
    id: "lush-green",
    label: "Lush Green",
    config: {
      fontName: "Montserrat",
      primaryColor: "#00FF00",
      outlineColor: "#000000",
      outlineWidth: 0,
      shadowColor: "#000000",
      shadowDepth: 3,
      animationPreset: "typewriter",
    },
  },
];

const SubtitleStylingPanel: React.FC<SubtitleStylingPanelProps> = ({
  stylingOptions,
  onStylingChange,
  titleOverride,
  hideKaraoke = false,
  hidePosition = false,
}) => {
  // Keep a local copy of the options so changes feel instant without waiting
  // for the Redux round-trip.  Changes are mirrored to the parent immediately
  // via onStylingChange so they also persist to the store.
  const [localOptions, setLocalOptions] =
    useState<SubtitleStylingOptions>(stylingOptions);

  // Active tab in the top navigation (text / outline / shadow / position / presets)
  const [activeTab, setActiveTab] = useState<
    "text" | "outline" | "shadow" | "position" | "presets"
  >("text");

  /**
   * Updates a single styling option, keeping local state in sync with the parent.
   * Any change here will immediately call onStylingChange, which dispatches to Redux.
   */
  const handleOptionChange = (
    key: keyof SubtitleStylingOptions,
    value: any,
  ) => {
    const newOptions = { ...localOptions, [key]: value };
    setLocalOptions(newOptions);
    onStylingChange(newOptions);
  };

  const resetToDefaults = () => {
    setLocalOptions(DEFAULT_STYLING);
    onStylingChange(DEFAULT_STYLING);
  };

  const ColorPicker = ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
  }) => (
    <div className="space-y-3 ">
      <Label className="text-[10px] font-bold text-muted-foreground uppercase opacity-70">
        {label}
      </Label>
      <div className="flex items-center gap-3">
        <Input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-10 h-10 p-1 border border-border bg-muted/30 rounded-lg cursor-pointer flex-shrink-0"
        />
        <div className="flex flex-wrap gap-1.5">
          {PRESET_COLORS.map((color) => (
            <Button
              key={color}
              onClick={() => onChange(color)}
              className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
                value === color ? "border-primary scale-110" : "border-border"
              }`}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </div>
    </div>
  );

  const renderTextTab = () => (
    <div className="space-y-4 mb-4 overflow-y-auto">
      <div className="space-y-2 mt-2">
        <Label className="text-sm font-medium">Font Family</Label>
        <Select
          value={localOptions.fontName}
          onValueChange={(value) => handleOptionChange("fontName", value)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select font" />
          </SelectTrigger>
          <SelectContent>
            {FONT_FAMILIES.map((font) => (
              <SelectItem key={font} value={font}>
                <span style={{ fontFamily: font }}>{font}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">
          Font Size: {localOptions.fontSize}px
        </Label>
        <Slider
          value={[localOptions.fontSize || 24]}
          onValueChange={([value]) => handleOptionChange("fontSize", value)}
          min={12}
          max={72}
          step={1}
          className="w-full"
        />
      </div>

      <ColorPicker
        label="Primary Color"
        value={localOptions.primaryColor || "#FFFFFF"}
        onChange={(color) => handleOptionChange("primaryColor", color)}
      />
    </div>
  );

  const renderOutlineTab = () => (
    <div className="space-y-4 mt-3">
      <ColorPicker
        label="Outline Color"
        value={localOptions.outlineColor || "#000000"}
        onChange={(color) => handleOptionChange("outlineColor", color)}
      />

      <div className="space-y-2 mb-3">
        <Label className="text-sm font-medium">
          Outline Width: {localOptions.outlineWidth}px
        </Label>
        <Slider
          value={[localOptions.outlineWidth || 0]}
          onValueChange={([value]) => handleOptionChange("outlineWidth", value)}
          min={0}
          max={10}
          step={0.5}
          className="w-full"
        />
      </div>
    </div>
  );

  const renderShadowTab = () => (
    <div className="space-y-4 mt-3">
      <ColorPicker
        label="Shadow Color"
        value={localOptions.shadowColor || "#000000"}
        onChange={(color) => handleOptionChange("shadowColor", color)}
      />

      <div className="space-y-2 mb-3">
        <Label className="text-sm font-medium">
          Shadow Depth: {localOptions.shadowDepth}px
        </Label>
        <Slider
          value={[localOptions.shadowDepth || 1]}
          onValueChange={([value]) => handleOptionChange("shadowDepth", value)}
          min={0}
          max={10}
          step={0.5}
          className="w-full"
        />
      </div>
    </div>
  );

  const renderPositionTab = () => (
    <div className="space-y-4 mt-3">
      <div className="space-y-2">
        <Label className="text-sm font-medium">Position</Label>
        <Select
          value={localOptions.position}
          onValueChange={(value) => handleOptionChange("position", value)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select position" />
          </SelectTrigger>
          <SelectContent>
            {POSITIONS.map((position) => (
              <SelectItem key={position} value={position}>
                {position.charAt(0).toUpperCase() + position.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="p-3 sm:p-4 mb-3 bg-muted/20 rounded-lg border border-border">
        <Label className="text-sm font-medium mb-2 block text-foreground">
          Position Preview
        </Label>
        <div className="relative w-full h-24 sm:h-32 bg-muted/50 rounded border border-border">
          <div
            className="absolute w-12 sm:w-16 h-6 sm:h-8 bg-primary text-primary-foreground text-xs flex items-center justify-center rounded"
            style={{
              left: localOptions.position?.includes("left")
                ? "10%"
                : localOptions.position?.includes("right")
                  ? "70%"
                  : "50%",
              top: localOptions.position?.includes("top")
                ? "10%"
                : localOptions.position?.includes("bottom")
                  ? "70%"
                  : "50%",
              transform: "translate(-50%, -50%)",
            }}
          >
            Text
          </div>
        </div>
      </div>
    </div>
  );

  // The Karaoke tab was removed; its controls were merged into the Presets tab
  // (karaoke highlight colour only appears when the "word-highlight" animation is active)

  const renderPresetsTab = () => (
    <div className="space-y-6 mt-3">
      <div className="space-y-3">
        <Label className="text-sm font-medium">Style Presets</Label>
        <Carousel
          opts={{
            align: "start",
            loop: true,
          }}
          className="w-full relative group"
        >
          <CarouselContent className="-ml-2">
            {SUBTITLE_PRESETS.map((preset) => (
              <CarouselItem key={preset.id} className=" basis-2/5">
                <Button
                  variant="outline"
                  className={`w-full h-auto py-3 px-3 flex flex-col items-center justify-center gap-2 text-center transition-all bg-muted/20 border-border/50 hover:bg-primary/5 hover:border-primary/30 group ${
                    localOptions.fontName === preset.config.fontName &&
                    localOptions.primaryColor === preset.config.primaryColor
                      ? "ring-2 ring-primary border-primary bg-primary/5"
                      : ""
                  }`}
                  onClick={() => {
                    const newOptions = { ...localOptions, ...preset.config };
                    setLocalOptions(newOptions);
                    onStylingChange(newOptions);
                  }}
                >
                  <span
                    className="text-lg font-black leading-none group-hover:scale-110 transition-transform"
                    style={{
                      fontFamily: preset.config.fontName,
                      color: preset.config.primaryColor,
                      WebkitTextStroke:
                        (preset.config.outlineWidth ?? 0) > 0
                          ? `${(preset.config.outlineWidth ?? 0) / 3}px ${
                              preset.config.outlineColor
                            }`
                          : "none",
                      textShadow:
                        (preset.config.shadowDepth ?? 0) > 0
                          ? `${(preset.config.shadowDepth ?? 0) / 2}px ${
                              (preset.config.shadowDepth ?? 0) / 2
                            }px 0 ${preset.config.shadowColor}`
                          : "none",
                    }}
                  >
                    ABC
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-tight opacity-70">
                    {preset.label}
                  </span>
                </Button>
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>
      </div>

      <Separator className="opacity-50" />

      {!hideKaraoke && localOptions.animationPreset === "word-highlight" && (
        <div className="pb-4 space-y-4 border-b border-border animate-in fade-in slide-in-from-top-2 duration-300">
          {localOptions.enableKaraoke && (
            <ColorPicker
              label="Highlight Color"
              value={localOptions.highlightColor || "#FFD700"}
              onChange={(color) => handleOptionChange("highlightColor", color)}
            />
          )}
        </div>
      )}

      <div className="space-y-3">
        <Label className="text-sm font-medium ">Animation Presets</Label>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {ANIMATION_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              variant={
                localOptions.animationPreset === preset.id
                  ? "default"
                  : "outline"
              }
              className={`h-auto py-2 px-1 flex flex-col items-center gap-1 text-[10px] transition-all ${
                localOptions.animationPreset === preset.id
                  ? "ring-2 ring-primary ring-offset-1 ring-offset-background shadow-md"
                  : "hover:bg-muted/50"
              }`}
              onClick={() => {
                const presetId = preset.id as SubtitleAnimationPreset;
                const isWordHighlight = presetId === "word-highlight";
                const newOptions = {
                  ...localOptions,
                  animationPreset: presetId,
                  enableKaraoke: isWordHighlight
                    ? !localOptions.enableKaraoke
                    : false,
                };
                setLocalOptions(newOptions);
                onStylingChange(newOptions);
              }}
            >
              <span className="font-bold">{preset.label}</span>
            </Button>
          ))}
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground italic mt-1">
        Presets apply specific animation and visual styles to your subtitles.
      </p>
    </div>
  );

  /**
   * Delegates rendering to the correct tab function.
   * Position tab is skipped entirely when `hidePosition` is true
   * (e.g. for text clips whose position is fixed).
   */
  const renderActiveTab = () => {
    switch (activeTab) {
      case "text":
        return renderTextTab();
      case "outline":
        return renderOutlineTab();
      case "shadow":
        return renderShadowTab();
      case "position":
        return hidePosition ? null : renderPositionTab();
      case "presets":
        return renderPresetsTab();
      default:
        return renderTextTab();
    }
  };

  /**
   * Number of visible tabs determines the CSS grid column count.
   * Removing the position tab reduces it from 5 to 4 columns.
   */
  const tabCount = (hidePosition ? 4 : 5) as number;

  return (
    <Card className="w-full h-full">
      <CardHeader className="-mb-0 px-3 sm:px-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <CardTitle className="text-base  w-full sm:text-lg flex justify-between items-center gap-2">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 sm:w-5 sm:h-5" />
              <span className="hidden sm:inline">
                {titleOverride || "Customize Subtitle Styling"}
              </span>
              <span className="sm:hidden">
                {titleOverride || "Subtitle Styling"}
              </span>
            </div>
            <div className=" flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={resetToDefaults}
                className="h-8 px-2 text-xs sm:text-sm"
                title="Reset to defaults"
              >
                <RotateCcw className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden sm:ml-1 sm:inline">Reset</span>
              </Button>
            </div>
          </CardTitle>
        </div>
      </CardHeader>

      <CardContent className="px-3 sm:px-6 overflow-y-auto">
        {/* Tab Navigation */}
        <div
          className={`grid ${
            tabCount === 3
              ? "grid-cols-3"
              : tabCount === 4
                ? "grid-cols-4"
                : "grid-cols-5"
          } space-y-1 sm:space-y-0 sm:space-x-1 bg-muted/30 p-1 border-2 border-border rounded-lg mb-3`}
        >
          <button
            onClick={() => setActiveTab("text")}
            className={`flex-1 px-2 sm:px-3 py-2 text-xs font-medium rounded-md transition-colors ${
              activeTab === "text"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Type className="w-3 h-3 sm:w-4 sm:h-4 mx-auto mb-1" />
            <span className="block sm:hidden">Text</span>
            <span className="hidden sm:block">Text</span>
          </button>
          <button
            onClick={() => setActiveTab("outline")}
            className={`flex-1 px-2 sm:px-3 py-2 text-xs font-medium rounded-md transition-colors ${
              activeTab === "outline"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Layers className="w-3 h-3 sm:w-4 sm:h-4 mx-auto mb-1" />
            <span className="block sm:hidden">Outline</span>
            <span className="hidden sm:block">Outline</span>
          </button>
          <button
            onClick={() => setActiveTab("shadow")}
            className={`flex-1 px-2 sm:px-3 py-2 text-xs font-medium rounded-md transition-colors ${
              activeTab === "shadow"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Moon className="w-3 h-3 sm:w-4 sm:h-4 mx-auto mb-1" />
            <span className="block sm:hidden">Shadow</span>
            <span className="hidden sm:block">Shadow</span>
          </button>
          {!hidePosition && (
            <button
              onClick={() => setActiveTab("position")}
              className={`flex-1 px-2 sm:px-3 py-2 text-xs font-medium rounded-md transition-colors ${
                activeTab === "position"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Palette className="w-3 h-3 sm:w-4 sm:h-4 mx-auto mb-1" />
              <span className="block sm:hidden">Position</span>
              <span className="hidden sm:block">Position</span>
            </button>
          )}
          <button
            onClick={() => setActiveTab("presets")}
            className={`flex-1 px-2 sm:px-3 py-2 text-xs font-medium rounded-md transition-colors ${
              activeTab === "presets"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Sparkles className="w-3 h-3 sm:w-4 sm:h-4 mx-auto mb-1" />
            <span className="block sm:hidden">Presets</span>
            <span className="hidden sm:block">Presets</span>
          </button>
        </div>

        <Separator />

        {/* Tab Content */}
        <div className="">{renderActiveTab()}</div>
      </CardContent>
    </Card>
  );
};

export default SubtitleStylingPanel;
