import React, { memo, useState } from "react";
import { Rect, Text, Group, Path } from "react-konva";
import { useSelector, useDispatch } from "react-redux";
import { RootState } from "../../../redux/store";
import { Track as TrackType, removeTrack } from "../../../redux/timelineSlice";
import { THEME } from "../../../utils/themeConstants";


/**
 * Track.tsx
 *
 * Renders the background strip for a single track on the timeline canvas,
 * including its colour-coded theme, hover highlight, track name label,
 * and a contextual delete button (if the track is empty and not the last of its type).
 * Clips are not rendered here; they are overlaid by TimelineCanvas above the tracks.
 */
interface TrackProps {
  track: TrackType;
  y: number;
  width: number;
  height: number;
  /** zoom is passed by parent but not needed for rendering the label/background */
  zoom?: number;
  isHighlighted?: boolean;
}

const Track: React.FC<TrackProps> = ({
  track,
  y,
  width,
  height,
  zoom,
  isHighlighted,
}) => {
  const dispatch = useDispatch();
  const tracksCount = useSelector(
    (state: RootState) =>
      state.timeline.tracks.filter((t) => t.type === track.type).length,
  );
  const isTrackEmpty = track.clips.length === 0;
  const canDelete = tracksCount > 1 && isTrackEmpty;
  const [showDeleteButton, setShowDeleteButton] = useState(false);
  const getTrackColor = (type: string) => {
      switch (type) {
        case "video":
          return `${THEME.trackVideo}15`;
        case "audio":
          return `${THEME.trackAudio}15`;
        case "subtitle":
          return `${THEME.trackSubtitle}15`;
        default:
          return THEME.background;
      }
  };

  // A track can be deleted only when it is empty AND it is not the last track of its type

  const handleDelete = (e: any) => {
    e.cancelBubble = true;
    if (canDelete) dispatch(removeTrack(track.id));
  };

  const handleMouseEnter = () => {
    if (canDelete) setShowDeleteButton(true);
  };

  const handleMouseLeave = () => setShowDeleteButton(false);

  return (
    <Group onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      {/* Track background */}
      <Rect
        x={0}
        y={y}
        width={width}
        height={height}
        fill={getTrackColor(track.type)}
        strokeWidth={isHighlighted ? 2 : 1}
      />

      {isHighlighted && (
        <Rect
          x={0}
          y={y}
          width={width}
          height={height}
          fill="#fbbf24"
          opacity={0.15}
        />
      )}

      {/* Delete button */}
      {showDeleteButton && canDelete && (
        <Group>
          <Rect
            x={0}
            y={y + 5}
            width={20}
            height={20}
            fill="rgba(239, 68, 68, 0.9)"
            stroke="rgba(220, 38, 38, 1)"
            strokeWidth={1}
            cornerRadius={3}
            onClick={handleDelete}
          />
          <Group
            x={2.5}
            y={y + 8}
            onClick={handleDelete}
            scaleX={0.6}
            scaleY={0.6}
          >
            <Path
              data="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"
              fill="white"
              stroke="#000"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Group>
        </Group>
      )}

      {/* Track label */}
      <Text
        x={showDeleteButton && canDelete ? 36 : 16}
        y={y + height / 2 - 6}
        text={track.name.toUpperCase()}
        fontSize={10}
        fill={THEME.textMuted}
        fontFamily="Inter, system-ui, sans-serif"
        fontStyle="900"
        letterSpacing={1.5}
      />
    </Group>
  );
};

export default memo(Track);
