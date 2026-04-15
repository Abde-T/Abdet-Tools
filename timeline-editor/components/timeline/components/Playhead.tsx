import React from "react";
import { Line, Circle, Group, Rect } from "react-konva";

/**
 * Playhead.tsx
 *
 * Renders the vertical red playhead line and its draggable top handle
 * using react-konva primitives.
 */
interface PlayheadProps {
  x: number;
  height: number;
  zoom: number;
  onPointerDown?: (e: any) => void;
  scrollTop?: number;
}

const Playhead: React.FC<PlayheadProps> = ({
  x,
  height,
  zoom,
  onPointerDown,
  scrollTop = 0,
}) => {
  return (
    <Group onMouseDown={onPointerDown} onTouchStart={onPointerDown}>
      {/* Vertical line with glow */}
      <Line
        x={x}
        y={0}
        points={[0, 0, 0, height]}
        stroke="#d31c1cff"
        strokeWidth={2}
        hitStrokeWidth={20}
        shadowColor="#d31c1cff"
        shadowBlur={10}
        shadowOpacity={0.5}
      />

      {/* Top handle - custom diamond/pill shape */}
      <Rect
        x={x - 6}
        y={scrollTop}
        width={12}
        height={18}
        fill="#d31c1cff"
        cornerRadius={4}
        shadowColor="#000"
        shadowBlur={10}
        shadowOpacity={0.3}
        stroke="#fff"
        strokeWidth={1.5}
      />

      {/* Inner tick */}
      <Rect
        x={x - 1}
        y={scrollTop + 4}
        width={2}
        height={10}
        fill="#fff"
        opacity={0.5}
        cornerRadius={1}
      />
    </Group>
  );
};

export default Playhead;
