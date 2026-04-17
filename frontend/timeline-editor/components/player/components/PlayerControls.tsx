import React from "react";
import { Maximize, Minimize, Eye, EyeOff } from "lucide-react";
import { Button } from "../../ui/button";
import { togglePlayerScrubber } from "../../../redux/timelineSlice";

/**
 * PlayerControls
 *
 * The scrubber bar and utility buttons rendered at the bottom of the player
 * canvas.  Always visible when not in fullscreen; in fullscreen mode it fades
 * out when `showPlayerScrubber` is false (toggled with the Eye button).
 *
 * Controls rendered:
 *  • Progress bar  – shows current position as a filled primary bar;
 *                    clicking or dragging seeks the playhead
 *  • Timestamps    – currentTime and totalDuration in mm:ss.d format
 *  • Scrubber toggle – Eye / EyeOff button (visible in fullscreen only)
 *  • Fullscreen toggle – Maximize / Minimize button
 */
export const PlayerControls: React.FC<{
  currentTime: number;
  totalDuration: number;
  isFullscreen: boolean;
  showPlayerScrubber: boolean;
  handleTimelineClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleTimelineMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  toggleFullscreen: () => void;
  dispatch: any;
}> = ({
  currentTime,
  totalDuration,
  isFullscreen,
  showPlayerScrubber,
  handleTimelineClick,
  handleTimelineMouseDown,
  toggleFullscreen,
  dispatch,
}) => {
  return (
    <div
      className={`absolute bottom-0 left-4 right-4 z-[2000] transition-all duration-300 ${
        !isFullscreen || showPlayerScrubber
          ? "opacity-100"
          : "opacity-0 pointer-events-none" // hide without unmounting in fullscreen
      }`}
    >
      {/* Seek bar: click positions the playhead; hover reveals the thumb handle */}
      <div
        className="bg-background/20 backdrop-blur-md rounded-full h-2 border border-white/10 cursor-pointer group hover:bg-background/30 transition-all"
        onClick={handleTimelineClick}
        onMouseDown={handleTimelineMouseDown}
      >
        <div
          className="bg-primary h-full rounded-full transition-all duration-75 relative"
          style={{
            width: `${Math.min(100, (currentTime / totalDuration) * 100)}%`,
          }}
        >
          {/* Circular thumb — only appears on hover */}
          <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-4 h-4 bg-white border-4 border-primary rounded-full shadow-lg scale-0 group-hover:scale-100 transition-transform" />
        </div>
      </div>

      <div className="flex justify-between items-center px-1">
        {/* Timestamp display */}
        <div className="flex gap-4">
          <span className="text-[10px] font-mono text-muted-foreground/70">
            {Math.floor(currentTime / 60)}:
            {(currentTime % 60).toFixed(1).padStart(4, "0")}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground/70">
            {Math.floor(totalDuration / 60)}:
            {(totalDuration % 60).toFixed(1).padStart(4, "0")}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Scrubber visibility toggle — only shown in fullscreen */}
          {isFullscreen && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 mb-1 text-muted-foreground hover:text-primary transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                dispatch(togglePlayerScrubber());
              }}
              title={showPlayerScrubber ? "Hide Scrubber" : "Show Scrubber"}
            >
              {showPlayerScrubber ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
            </Button>
          )}

          {/* Fullscreen toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 mb-1 text-muted-foreground hover:text-primary transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              toggleFullscreen();
            }}
            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          >
            {isFullscreen ? (
              <Minimize className="w-4 h-4" />
            ) : (
              <Maximize className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
