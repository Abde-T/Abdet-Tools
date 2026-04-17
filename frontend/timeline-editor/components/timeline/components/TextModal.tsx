import React, { useState } from 'react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Textarea } from '../../ui/textarea';
import { X } from 'lucide-react';

/**
 * TextModal.tsx
 *
 * A simple modal overlay allowing the user to type in a new text string
 * that will be converted into a new Text clip on the timeline.
 */
interface TextModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAddText: (text: string) => void;
}

const TextModal: React.FC<TextModalProps> = ({ isOpen, onClose, onAddText }) => {
    const [text, setText] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (text.trim()) {
            onAddText(text.trim());
            setText('');
            onClose();
        }
    };

    const handleClose = () => {
        setText('');
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[20010]">
            <div className="bg-background rounded-[40px] border-2 border-border p-6 max-w-md w-full mx-4 shadow-xl ">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-foreground">Add Text</h2>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleClose}
                        className="h-8 w-8 p-0"
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="text-input">Text Content</Label>
                        <Textarea
                            id="text-input"
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            placeholder="Enter your text here..."
                            className="min-h-[100px] resize-none"
                            autoFocus
                        />
                    </div>

                    <div className="flex justify-end space-x-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleClose}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={!text.trim()}
                        >
                            Add Text
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default TextModal;
