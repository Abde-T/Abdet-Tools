import React from 'react';
import { Button } from '../../ui/button';
import { Monitor, Smartphone, Tablet, Square } from 'lucide-react';

/**
 * AspectRatioSettings
 *
 * A compact row of toggle buttons that lets the user switch the player canvas
 * aspect ratio.  The selected ratio is highlighted with the primary colour;
 * all others render as ghost buttons.
 *
 * Supported ratios and their intended use cases:
 *  • 16:9 (Widescreen) – YouTube, presentations, desktop
 *  • 9:16 (Vertical)   – TikTok, Instagram Reels, YouTube Shorts
 *  • 4:3  (Standard)   – legacy video formats
 *  • 1:1  (Square)     – Instagram posts
 *
 * @param currentRatio  - the currently active ratio string (e.g. "16:9")
 * @param onRatioChange - callback invoked with the newly selected ratio string
 * @param className     - optional extra class names for the wrapper div
 */

interface AspectRatioSettingsProps {
    currentRatio: string;
    onRatioChange: (ratio: string) => void;
    className?: string;
}

/** Maps each ratio value to its display label, icon, and description */
const ASPECT_RATIOS = [
    { value: '16:9', label: '16:9', icon: Monitor, description: 'Widescreen' },
    { value: '9:16', label: '9:16', icon: Smartphone, description: 'Vertical' },
    { value: '4:3', label: '4:3', icon: Tablet, description: 'Standard' },
    { value: '1:1', label: '1:1', icon: Square, description: 'Square' },
];

const AspectRatioSettings: React.FC<AspectRatioSettingsProps> = ({
    currentRatio,
    onRatioChange,
    className = ''
}) => {
    return (
        <div className={`p-2 ${className}`}>
            <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Aspect:</span>
                <div className="flex gap-1">
                    {ASPECT_RATIOS.map((ratio) => {
                        const Icon = ratio.icon;
                        const isSelected = currentRatio === ratio.value;

                        return (
                            <Button
                                key={ratio.value}
                                variant={isSelected ? "default" : "ghost"}
                                size="sm"
                                onClick={() => onRatioChange(ratio.value)}
                                className={`h-6 w-8 p-0 ${isSelected
                                    ? 'bg-primary text-primary-foreground'
                                    : 'hover:bg-muted/50'
                                    }`}
                                title={`${ratio.label} - ${ratio.description}`}
                            >
                                <Icon className="w-3 h-3" />
                            </Button>
                        );
                    })}
                </div>
                <span className="text-xs text-muted-foreground ml-1">{currentRatio}</span>
            </div>
        </div>
    );
};

export default AspectRatioSettings;
