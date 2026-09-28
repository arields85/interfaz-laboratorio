import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AdminTag from './AdminTag';

describe('AdminTag (P5: driven by the theme tag tokens, 2026-09-28)', () => {
    it('renders the label and applies the shared theme-tag class', () => {
        render(<AdminTag label="Asignado" variant="cyan" />);

        const tag = screen.getByText('Asignado');
        expect(tag).toHaveClass('theme-tag');
    });

    it('sets --tc to each variant\'s own color, without a variant-specific override', () => {
        render(
            <>
                <AdminTag label="Cyan" variant="cyan" />
                <AdminTag label="Green" variant="green" />
                <AdminTag label="Amber" variant="amber" />
                <AdminTag label="Red" variant="red" />
                <AdminTag label="Pink" variant="pink" />
                <AdminTag label="Purple" variant="purple" />
            </>,
        );

        expect(screen.getByText('Cyan')).toHaveClass('[--tc:var(--color-accent-cyan)]');
        expect(screen.getByText('Green')).toHaveClass('[--tc:var(--color-accent-green)]');
        expect(screen.getByText('Amber')).toHaveClass('[--tc:var(--color-accent-amber)]');
        expect(screen.getByText('Red')).toHaveClass('[--tc:var(--color-accent-ruby)]');
        expect(screen.getByText('Pink')).toHaveClass('[--tc:var(--color-accent-pink)]');
        expect(screen.getByText('Purple')).toHaveClass('[--tc:var(--color-accent-purple)]');
    });

    it('gives "muted" its own local border override class, independent of the shared --tag-border axis', () => {
        render(<AdminTag label="Planta" variant="muted" />);

        const tag = screen.getByText('Planta');
        expect(tag).toHaveClass('theme-tag', 'theme-tag-muted', 'text-industrial-muted');
    });

    it('gives "admin" its own local fill/border override class instead of --tc', () => {
        render(<AdminTag label="Draft" variant="admin" />);

        const tag = screen.getByText('Draft');
        expect(tag).toHaveClass('theme-tag', 'theme-tag-admin', 'text-admin-accent');
    });

    it('keeps every variant\'s own text color unchanged', () => {
        render(
            <>
                <AdminTag label="Cyan" variant="cyan" />
                <AdminTag label="Green" variant="green" />
                <AdminTag label="Amber" variant="amber" />
                <AdminTag label="Red" variant="red" />
                <AdminTag label="Muted" variant="muted" />
                <AdminTag label="Pink" variant="pink" />
                <AdminTag label="Purple" variant="purple" />
                <AdminTag label="Admin" variant="admin" />
            </>,
        );

        expect(screen.getByText('Cyan')).toHaveClass('text-accent-cyan');
        expect(screen.getByText('Green')).toHaveClass('text-accent-green');
        expect(screen.getByText('Amber')).toHaveClass('text-accent-amber');
        expect(screen.getByText('Red')).toHaveClass('text-accent-ruby');
        expect(screen.getByText('Muted')).toHaveClass('text-industrial-muted');
        expect(screen.getByText('Pink')).toHaveClass('text-accent-pink');
        expect(screen.getByText('Purple')).toHaveClass('text-accent-purple');
        expect(screen.getByText('Admin')).toHaveClass('text-admin-accent');
    });

    it('appends a custom className without dropping the theme-tag base', () => {
        render(<AdminTag label="Extra" variant="cyan" className="ml-2" />);

        const tag = screen.getByText('Extra');
        expect(tag).toHaveClass('theme-tag', 'ml-2');
    });

    it('keeps the layout utilities (flex/padding/uppercase) that carry no color', () => {
        render(<AdminTag label="Layout" variant="cyan" />);

        const tag = screen.getByText('Layout');
        expect(tag).toHaveClass('inline-flex', 'items-center', 'px-2', 'py-0.5', 'uppercase');
        // Radius/border/background are no longer literal Tailwind utilities --
        // they come from `.theme-tag` reading the `--tag-*` tokens instead.
        expect(tag.className).not.toMatch(/(?<!-)\brounded\b/);
        expect(tag.className).not.toMatch(/(?<!-)\bborder\b/);
        expect(tag.className).not.toMatch(/bg-white\/5/);
    });
});
