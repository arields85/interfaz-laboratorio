import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EventHorizonBackground from './EventHorizonBackground';
import { SHADER_BLEND_DEFAULTS, useShaderParamsStore } from '../../store/shaderParams.store';

const SUPPORTED_COLOR_CONTROL_UNIFORMS = {
    u_nebBrightness: 1.4,
    u_starSaturation: 1.6,
    u_starContrast: 0.7,
    u_chromSaturation: 1.3,
    u_chromBrightness: 0.8,
    u_chromContrast: 1.25,
    u_cursorNebSaturation: 1.5,
    u_cursorNebBrightness: 0.9,
    u_cursorNebContrast: 1.1,
    u_haloSaturation: 0.85,
    u_haloBrightness: 1.2,
    u_haloContrast: 1.4,
    u_ringBrightness: 0.75,
    u_ringContrast: 1.35,
} as const;

const BLEND_UNIFORM_NAMES = [
    'u_nebBlendMode',
    'u_starBlendMode',
    'u_chromBlendMode',
    'u_cursorNebBlendMode',
    'u_haloBlendMode',
    'u_ringBlendMode',
] as const;

const UNSUPPORTED_UNIFORM_NAMES = [
    'u_lensBlendMode',
    'u_nebMouseBlendMode',
    'u_vigBlendMode',
] as const;

const UNSUPPORTED_LAYER_COLOR_UNIFORM_NAMES = [
    'u_lensSaturation',
    'u_lensBrightness',
    'u_lensContrast',
    'u_nebMouseSaturation',
    'u_nebMouseBrightness',
    'u_nebMouseContrast',
    'u_vigSaturation',
    'u_vigBrightness',
    'u_vigContrast',
] as const;

function countUniformOccurrences(source: string, uniformName: string): number {
    const escapedUniformName = uniformName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return source.match(new RegExp(escapedUniformName, 'g'))?.length ?? 0;
}

function createMockGl(): WebGLRenderingContext {
    type MockShader = WebGLShader & { __source?: string };
    type MockProgram = WebGLProgram & { __shaders?: MockShader[] };

    const shader = {} as MockShader;
    const program = { __shaders: [] } as MockProgram;
    const buffer = {} as WebGLBuffer;

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
        attachShader: vi.fn((attachedProgram: MockProgram, attachedShader: MockShader) => {
            attachedProgram.__shaders ??= [];
            attachedProgram.__shaders.push(attachedShader);
        }),
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
        getUniformLocation: vi.fn((targetProgram: MockProgram, name: string) => {
            const shaderSource = targetProgram.__shaders?.map((entry) => entry.__source ?? '').join('\n') ?? '';
            return countUniformOccurrences(shaderSource, name) > 1
                ? (name as unknown as WebGLUniformLocation)
                : null;
        }),
        isContextLost: vi.fn(() => false),
        linkProgram: vi.fn(),
        shaderSource: vi.fn((targetShader: MockShader, source: string) => {
            targetShader.__source = source;
        }),
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
        vi.clearAllMocks();

        useShaderParamsStore.setState({
            params: { ...useShaderParamsStore.getInitialState().params },
            blendModes: { ...SHADER_BLEND_DEFAULTS },
        });

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

    it('uploads mapped default blend uniforms and skips unsupported blend slots', () => {
        render(<EventHorizonBackground />);

        for (const uniformName of BLEND_UNIFORM_NAMES) {
            expect(mockGl.getUniformLocation).toHaveBeenCalledWith(expect.anything(), uniformName);
            expect(mockGl.uniform1f).toHaveBeenCalledWith(uniformName, 0);
        }

        for (const uniformName of UNSUPPORTED_UNIFORM_NAMES) {
            expect(mockGl.getUniformLocation).not.toHaveBeenCalledWith(expect.anything(), uniformName);
            expect(mockGl.uniform1f).not.toHaveBeenCalledWith(uniformName, expect.any(Number));
        }
    });

    it('keeps supported blend uniforms at normal even when the store contains non-normal values', () => {
        useShaderParamsStore.setState((state) => ({
            ...state,
            blendModes: {
                nebula: 'screen',
                stars: 'multiply',
                chromatic: 'overlay',
                cursorNebula: 'soft-light',
                cursorHalo: 'normal',
                clickRing: 'screen',
            },
        }));

        render(<EventHorizonBackground />);

        expect(mockGl.uniform1f).toHaveBeenCalledWith('u_nebBlendMode', 0);
        expect(mockGl.uniform1f).toHaveBeenCalledWith('u_starBlendMode', 0);
        expect(mockGl.uniform1f).toHaveBeenCalledWith('u_chromBlendMode', 0);
        expect(mockGl.uniform1f).toHaveBeenCalledWith('u_cursorNebBlendMode', 0);
        expect(mockGl.uniform1f).toHaveBeenCalledWith('u_haloBlendMode', 0);
        expect(mockGl.uniform1f).toHaveBeenCalledWith('u_ringBlendMode', 0);
    });

    it('uploads supported saturation, brightness, and contrast uniforms only for real color-emitting layers', () => {
        useShaderParamsStore.setState((state) => ({
            ...state,
            params: {
                ...state.params,
                nebBrightness: SUPPORTED_COLOR_CONTROL_UNIFORMS.u_nebBrightness,
                starSaturation: SUPPORTED_COLOR_CONTROL_UNIFORMS.u_starSaturation,
                starContrast: SUPPORTED_COLOR_CONTROL_UNIFORMS.u_starContrast,
                chromSaturation: SUPPORTED_COLOR_CONTROL_UNIFORMS.u_chromSaturation,
                chromBrightness: SUPPORTED_COLOR_CONTROL_UNIFORMS.u_chromBrightness,
                chromContrast: SUPPORTED_COLOR_CONTROL_UNIFORMS.u_chromContrast,
                cursorNebSaturation: SUPPORTED_COLOR_CONTROL_UNIFORMS.u_cursorNebSaturation,
                cursorNebBrightness: SUPPORTED_COLOR_CONTROL_UNIFORMS.u_cursorNebBrightness,
                cursorNebContrast: SUPPORTED_COLOR_CONTROL_UNIFORMS.u_cursorNebContrast,
                haloSaturation: SUPPORTED_COLOR_CONTROL_UNIFORMS.u_haloSaturation,
                haloBrightness: SUPPORTED_COLOR_CONTROL_UNIFORMS.u_haloBrightness,
                haloContrast: SUPPORTED_COLOR_CONTROL_UNIFORMS.u_haloContrast,
                ringBrightness: SUPPORTED_COLOR_CONTROL_UNIFORMS.u_ringBrightness,
                ringContrast: SUPPORTED_COLOR_CONTROL_UNIFORMS.u_ringContrast,
            },
        }));

        render(<EventHorizonBackground />);

        for (const [uniformName, expectedValue] of Object.entries(SUPPORTED_COLOR_CONTROL_UNIFORMS)) {
            expect(mockGl.getUniformLocation).toHaveBeenCalledWith(expect.anything(), uniformName);
            expect(mockGl.uniform1f).toHaveBeenCalledWith(uniformName, expectedValue);
        }
    });

    it('omits saturation, brightness, and contrast uniforms for unsupported non-color layers', () => {
        render(<EventHorizonBackground />);

        for (const uniformName of UNSUPPORTED_LAYER_COLOR_UNIFORM_NAMES) {
            expect(mockGl.getUniformLocation).not.toHaveBeenCalledWith(expect.anything(), uniformName);
            expect(mockGl.uniform1f).not.toHaveBeenCalledWith(uniformName, expect.any(Number));
        }
    });
});
