import React from 'react';

interface AlertModalProps {
    open: boolean;
    title?: string;
    description?: string;
    variant?: 'error' | 'warning' | 'info' | 'success';
    onClose: () => void;
    actions?: Array<{
        label: string;
        variant?: 'primary' | 'secondary' | 'destructive';
        onClick: () => void;
        autoFocus?: boolean;
    }>;
}

const variantIcon: Record<NonNullable<AlertModalProps['variant']>, React.ReactNode> = {
    info: (
        <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 20a8 8 0 100-16 8 8 0 000 16z" />
        </svg>
    ),
    success: (
        <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
    ),
    warning: (
        <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
    ),
    error: (
        <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
    )
};

const buttonClasses = (variant?: 'primary' | 'secondary' | 'destructive') => {
    if (variant === 'primary') return 'bg-primary text-primary-foreground hover:bg-primary/90';
    if (variant === 'destructive') return 'bg-red-600 text-white hover:bg-red-700';
    return 'bg-muted text-foreground hover:bg-muted/80';
};

const AlertModal: React.FC<AlertModalProps> = ({ open, title, description, variant = 'info', onClose, actions }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[30000] flex items-center justify-center ">
            <div className="absolute inset-0" onClick={onClose} />
            <div className="relative z-[1001] w-full max-w-md rounded-[40px] p-4 overflow-hidden border border-border bg-card shadow-lg">
                <div className="flex items-start space-x-3 p-4">
                    <div className="mt-0.5">{variantIcon[variant]}</div>
                    <div className="flex-1 min-w-0">
                        {title && <h3 className="text-base font-semibold text-foreground">{title}</h3>}
                        {description && <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{description}</p>}
                    </div>
                    <button
                        className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                        onClick={onClose}
                        aria-label="Close"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                {(actions && actions.length > 0) && (
                    <div className="flex justify-end gap-2 p-3 border-t border-border">
                        {actions.map((action, idx) => (
                            <button
                                key={idx}
                                onClick={action.onClick}
                                autoFocus={action.autoFocus}
                                className={`px-3 py-1.5 rounded-md text-sm ${buttonClasses(action.variant)}`}
                            >
                                {action.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AlertModal;


