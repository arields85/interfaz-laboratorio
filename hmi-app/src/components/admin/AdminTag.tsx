// =============================================================================
// AdminTag
// Primitive reutilizable para tags/badges en el admin UI.
// UN solo estilo visual: misma tipografía, mismo alto, mismo padding.
// Lo único que varía es el color (variant) y el texto (label).
// =============================================================================

interface AdminTagProps {
    label: string;
    /** Color variant that controls the tag's own color (`--tc`) and text color */
    variant: 'cyan' | 'green' | 'amber' | 'red' | 'muted' | 'pink' | 'purple' | 'admin';
    className?: string;
}

// Radius/fill/border/blur come from the theme tag tokens via `.theme-tag`
// (see `index.css`'s tag theme engine, P5 2026-09-28) instead of literal
// Tailwind utilities, so a theme change (`themeStyle.service.ts`) restyles
// every tag without touching this component.
const BASE_CLS = 'theme-tag inline-flex items-center px-2 py-0.5 uppercase';

const VARIANT_CLS: Record<AdminTagProps['variant'], string> = {
    cyan: 'text-accent-cyan [--tc:var(--color-accent-cyan)]',
    green: 'text-accent-green [--tc:var(--color-accent-green)]',
    amber: 'text-accent-amber [--tc:var(--color-accent-amber)]',
    red: 'text-accent-ruby [--tc:var(--color-accent-ruby)]',
    // "muted" and "admin" don't fit the shared --tc/--tag-border overlay
    // (muted's border is a neutral white/10, not its own color at the
    // theme's border %; admin's fill/border use its own color at 20%/30%,
    // not white/the theme's %) -- `.theme-tag-muted`/`.theme-tag-admin` in
    // index.css hold their fixed local overrides.
    muted: 'theme-tag-muted text-industrial-muted',
    pink: 'text-accent-pink [--tc:var(--color-accent-pink)]',
    purple: 'text-accent-purple [--tc:var(--color-accent-purple)]',
    admin: 'theme-tag-admin text-admin-accent',
};

export default function AdminTag({ label, variant, className }: AdminTagProps) {
    return (
        <span className={`${BASE_CLS} ${VARIANT_CLS[variant]}${className ? ` ${className}` : ''}`}>
            {label}
        </span>
    );
}

export type { AdminTagProps };
