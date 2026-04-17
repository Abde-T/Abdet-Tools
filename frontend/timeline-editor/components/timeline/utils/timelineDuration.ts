/**
 * timelineDuration.ts
 * 
 * Logic for calculating the total temporal span of the timeline based on clip positions.
 */
import { Clip } from "../../../redux/timelineSlice";

/**
 * Calculate timeline duration accounting for live duration overrides during resize
 * @param clips - Object containing all clips
 * @param liveDurationOverrides - Live duration overrides during resize operations
 * @returns The actual end position of all media in the timeline
 */
export const calculateTimelineDuration = (
    clips: Record<string, Clip>,
    liveDurationOverrides?: Record<string, number>
): number => {
    let maxEnd = 0;
    Object.values(clips).forEach((clip) => {
        // Use live duration override if available, otherwise use clip duration
        const duration = liveDurationOverrides?.[clip.id] ?? clip.duration;
        const end = clip.start + duration;
        if (end > maxEnd) maxEnd = end;
    });
    return maxEnd;
};
