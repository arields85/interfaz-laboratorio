import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewFrameShape, resetFrameShapeOnDocument } from '../../services/frameShape.service';
import { GridFrameScope } from './GridFrameScope';
import WidgetFrame from './WidgetFrame';

// The frame radius (theme preset or the Tema tab's radius override) reaches the tab shell through the
// `--frame-radius-rest` token: the shell takes it as its own `border-radius`, and the silhouette is
// built from the radius the browser computes from it. jsdom has no layout, so the computed radius is
// injected per render.
const TOKENS: Record<string, string> = {
    '--tab-frame-height': '25px',
    '--tab-frame-tab-cut': '19px',
    '--tab-frame-body-cut': '0px',
    '--tab-frame-glow-spread': '2px',
};

function mockLayout(radiusPx: number) {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(90);
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
        getPropertyValue: (name: string) => TOKENS[name] ?? '',
        borderTopLeftRadius: `${radiusPx}px`,
        fontSize: '16px',
        paddingTop: '20px',
        borderTopWidth: '1px',
    }) as unknown as CSSStyleDeclaration);
}

function renderTabFrame(radiusPx: number) {
    previewFrameShape('tab');
    mockLayout(radiusPx);

    return render(
        <GridFrameScope>
            <WidgetFrame widgetType="kpi" title="Temperatura" frameClassName="glass-panel" className="p-5 group relative w-full h-full">
                <p>Body</p>
            </WidgetFrame>
        </GridFrameScope>,
    );
}

function glowClipPath(): string {
    const glow = document.querySelector<HTMLElement>('.hmi-tab-frame-glow, [style*="clip-path"]');
    expect(glow).not.toBeNull();

    return glow?.style.clipPath ?? '';
}

describe('WidgetFrame tab shell follows the frame radius token', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        resetFrameShapeOnDocument();
    });

    it('takes the radius from --frame-radius-rest instead of a fixed value', () => {
        const { container } = renderTabFrame(8);

        expect((container.firstElementChild as HTMLElement).style.borderRadius).toBe('var(--frame-radius-rest)');
        expect(screen.getByText('Body')).toBeInTheDocument();
    });

    it('builds a different silhouette when the computed frame radius changes', () => {
        const small = renderTabFrame(4);
        const smallPath = glowClipPath();
        small.unmount();

        renderTabFrame(16);
        const largePath = glowClipPath();

        expect(smallPath).not.toBe('');
        expect(largePath).not.toBe('');
        expect(largePath).not.toBe(smallPath);
    });
});
