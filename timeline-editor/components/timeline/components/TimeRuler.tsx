import React, { useMemo, memo } from "react";
import { Rect, Line, Text, Group } from "react-konva";
import { THEME } from "../../../utils/themeConstants";

/**
 * TimeRuler.tsx
 *
 * Renders the top ruler of the timeline canvas. Shows time demarcations
 * and the current playhead position.
 *
 * - Virtualizes tick rendering: computes a fixed set of "nice" step intervals
 *   (1s, 5s, 10s, etc.) based on current viewport zoom, drawing only ticks
 *   that fall within the visible `scrollX` window.
 * - Allows double-clicking on the ruler to jump the playhead to that time.
 */
interface TimeRulerProps {
  width: number; // viewport width in pixels
  height: number;
  zoom: number;
  timelineWidth: number; // total content width in pixels
  currentTime: number;
  scrollX: number; // horizontal scroll offset in pixels
  onDblClick?: (time: number) => void;
}

const TimeRuler: React.FC<TimeRulerProps> = ({
  width,
  height,
  zoom,
  timelineWidth,
  currentTime,
  scrollX,
  onDblClick,
}) => {
  const { majorTicks } = useMemo(() => {
    const calcMajorInterval = (z: number) => {
      const desiredPxLower = 80; // aim >= 80px spacing between major ticks
      const niceSteps = [
        0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600,
      ];
      let major = niceSteps[niceSteps.length - 1];
      for (const step of niceSteps) {
        if (step * z >= desiredPxLower) {
          major = step;
          break;
        }
      }
      return major;
    };

    // Compute visible window in time based on scroll position and viewport width
    const visibleStartTime = Math.max(0, scrollX / zoom);
    const visibleEndTime = Math.min(
      (scrollX + width) / zoom,
      Math.max(visibleStartTime, timelineWidth / zoom),
    );
    const majorStep = calcMajorInterval(zoom);

    const majorTicks: { x: number; time: number }[] = [];
    const eps = Math.max(1e-6, majorStep / 1000);

    // Start from the nearest major tick before the visible window
    const firstTickTime = Math.max(
      0,
      Math.floor(visibleStartTime / majorStep) * majorStep,
    );
    const endTime = visibleEndTime + majorStep; // small buffer

    for (let time = firstTickTime; time <= endTime + eps; time += majorStep) {
      const x = Math.round(time * zoom - scrollX) + 0.5;
      if (x >= -20 && x <= width + 20) {
        // only include visible ticks
        majorTicks.push({ x, time });
      }
    }

    return { majorTicks };
  }, [timelineWidth, zoom, scrollX, width]);

  const formatTime = (seconds: number) => {
    const totalSeconds = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, "0")}:${secs
        .toString()
        .padStart(2, "0")}`;
    }
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <Group>
      {/* Ruler background */}
      <Rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill={`${THEME.background}99`} // Semi-transparent for timeline overlay effect
        onDblClick={(e) => {
          if (onDblClick) {
            const stage = e.target.getStage();
            if (!stage) return;
            const pointerPosition = stage.getPointerPosition();
            if (!pointerPosition) return;
            const newTime = (pointerPosition.x + scrollX) / zoom;
            onDblClick(Math.max(0, newTime));
          }
        }}
      />

      {/* Ticks and Labels */}
      {majorTicks.map((tick) => (
        <Group key={`${tick.time}`}>
          {/* Vertical tick mark - refined */}
          <Line
            x={tick.x}
            y={0}
            points={[0, 0, 0, 10]}
            stroke={THEME.line}
            strokeWidth={1}
          />

          {/* Time labels - premium Typography */}
          {tick.x + 4 >= 0 && tick.x <= width - 24 && (
            <Text
              x={tick.x + 4}
              y={14}
              text={formatTime(tick.time)}
              fontSize={10}
              fill={THEME.textMuted}
              fontFamily="Inter, system-ui, sans-serif"
              fontStyle="bold"
              letterSpacing={0.5}
            />
          )}
        </Group>
      ))}

      {/* Current time indicator - Primary color glow */}
      <Line
        x={Math.min(
          width,
          Math.max(0, Math.round(currentTime * zoom - scrollX) - 0.2),
        )}
        y={0}
        points={[0, 0, 0, height]}
        stroke={THEME.playhead}
        strokeWidth={2}
        opacity={0.8}
      />
    </Group>
  );
};

// Avoid unnecessary re-renders when props are unchanged
export default memo(TimeRuler, (prev, next) => {
  return (
    prev.width === next.width &&
    prev.height === next.height &&
    prev.zoom === next.zoom &&
    prev.timelineWidth === next.timelineWidth &&
    prev.currentTime === next.currentTime &&
    prev.scrollX === next.scrollX
  );
});
