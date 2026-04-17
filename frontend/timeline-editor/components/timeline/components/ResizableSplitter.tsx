import React, { useState, useEffect, useRef } from "react";
import { GripVertical } from "lucide-react";

/**
 * ResizableSplitter.tsx
 *
 * A generic UI component that renders a draggable divider between two panels.
 * Computes a percentage-based `splitRatio` based on mouse movement relative
 * to its parent container. Supports both horizontal and vertical orientations.
 */
interface ResizableSplitterProps {
  id: string;
  splitRatio: number;
  setSplitRatio: (ratio: number) => void;
  minRatio?: number;
  maxRatio?: number;
  isHorizontal?: boolean; // If true, splits horizontally (left/right)
}

const ResizableSplitter: React.FC<ResizableSplitterProps> = ({
  id,
  splitRatio,
  setSplitRatio,
  minRatio = 10,
  maxRatio = 90,
  isHorizontal = true,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const splitterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !splitterRef.current) return;

      const parent = splitterRef.current.parentElement;
      if (!parent) return;

      const parentRect = parent.getBoundingClientRect();

      let newRatio;
      if (isHorizontal) {
        const relativeX = e.clientX - parentRect.left;
        newRatio = (relativeX / parentRect.width) * 100;
      } else {
        const relativeY = e.clientY - parentRect.top;
        newRatio = (relativeY / parentRect.height) * 100;
      }

      // Clamp ratio
      newRatio = Math.max(minRatio, Math.min(newRatio, maxRatio));

      setSplitRatio(newRatio);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = "default";
      document.body.style.userSelect = "auto";
    };

    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = isHorizontal ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none"; // Prevent text selection while dragging
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "default";
      document.body.style.userSelect = "auto";
    };
  }, [isDragging, isHorizontal, minRatio, maxRatio, setSplitRatio]);

  return (
    <div
      ref={splitterRef}
      className={`relative flex bg-primary mx-1 my-auto rounded-full items-center justify-center hover:bg-primary/20 transition-colors z-10 shrink-0
        ${
          isHorizontal
            ? "w-2 h-[90%] cursor-col-resize"
            : "h-2 w-full cursor-row-resize"
        }`}
      onMouseDown={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
    >
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <GripVertical
          size={12}
          className={`text-gray-400 ${!isHorizontal && "rotate-90"}`}
        />
      </div>
    </div>
  );
};

export default ResizableSplitter;
