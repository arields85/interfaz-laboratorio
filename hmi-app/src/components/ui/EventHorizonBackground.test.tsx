import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EventHorizonBackground from './EventHorizonBackground';

function createMockGl(): WebGLRenderingContext {
    const shader = {} as WebGLShader;
    const program = {} as WebGLProgram;
    const buffer = {} as WebGLBuffer;
    const uniform = {} as WebGLUniformLocation;

    return {
        ARRAY_BUFFER: 0x8892,
        COLOR_BUFFER_BIT: 0x4000,
        COMPILE_STATUS: 0x8B81,
        FLOAT: 0x1406,
        FRAGMENT_SHADER: 0x8B30,
        LINK_STATUS: 0x8B82,
        STATIC_DRAW: 0x88E4,
        TRIANGLES: 0x0004,
        VERTEX_SHADER: 0x8B31,
        attachShader: vi.fn(),
        bindAttribLocation: vi.fn(),
        bindBuffer: vi.fn(),
        bufferData: vi.fn(),
        clear: vi.fn(),
        clearColor: vi.fn(),
        compileShader: vi.fn(),
        createBuffer: vi.fn(() => buffer),
        createProgram: vi.fn(() => program),
        createShader: vi.fn(() => shader),
        deleteBuffer: vi.fn(),
        deleteProgram: vi.fn(),
        deleteShader: vi.fn(),
        drawArrays: vi.fn(),
        enableVertexAttribArray: vi.fn(),
        getProgramInfoLog: vi.fn(() => ''),
        getProgramParameter: vi.fn(() => true),
        getShaderInfoLog: vi.fn(() => ''),
        getShaderParameter: vi.fn(() => true),
        getUniformLocation: vi.fn(() => uniform),
        isContextLost: vi.fn(() => false),
        linkProgram: vi.fn(),
        shaderSource: vi.fn(),
        uniform1f: vi.fn(),
        uniform2f: vi.fn(),
        uniform4fv: vi.fn(),
        useProgram: vi.fn(),
        vertexAttribPointer: vi.fn(),
        viewport: vi.fn(),
    } as unknown as WebGLRenderingContext;
}

describe('EventHorizonBackground', () => {
    const mockGl = createMockGl();

    beforeEach(() => {
        vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());

        Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
            configurable: true,
            value: vi.fn(() => mockGl),
        });

        Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', {
            configurable: true,
            get: () => 120,
        });

        Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', {
            configurable: true,
            get: () => 80,
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('requests an opaque WebGL context and marks the first draw as ready', () => {
        const readyListener = vi.fn();
        document.addEventListener('webgl-first-draw', readyListener);

        const { container } = render(<EventHorizonBackground />);

        const canvas = container.querySelector('canvas');
        expect(canvas).toHaveAttribute('data-hmi-webgl-ready', 'true');
        expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith('webgl', expect.objectContaining({ alpha: false }));
        expect(readyListener).toHaveBeenCalledTimes(1);
    });
});
