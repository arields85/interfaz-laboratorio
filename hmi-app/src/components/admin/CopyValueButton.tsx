import { Check, Copy } from 'lucide-react';
import AdminIconToolbarButton from './AdminIconToolbarButton';

// =============================================================================
// CopyValueButton
// Icon-only button that copies a value. The parent owns the clipboard call and
// the `copied` state so a single live region can announce the outcome.
// =============================================================================

interface CopyValueButtonProps {
    label: string;
    copied: boolean;
    onCopy: () => void;
}

export default function CopyValueButton({ label, copied, onCopy }: CopyValueButtonProps) {
    return (
        <span className="shrink-0">
            <AdminIconToolbarButton
                label={label}
                icon={copied ? Check : Copy}
                tooltipPosition="top"
                iconProps={{ size: 16, className: copied ? 'text-status-normal' : undefined }}
                onClick={onCopy}
            />
        </span>
    );
}
