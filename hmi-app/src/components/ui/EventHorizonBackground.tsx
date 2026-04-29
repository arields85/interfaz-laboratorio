// =============================================================================
// EventHorizonBackground -- WebGL shader background + tweaks panel
// All visual parameters are runtime-controllable via uniform floats.
// =============================================================================
import { useEffect, useRef } from 'react';
import { useShaderParamsStore, UNIFORM_MAP } from '../../store/shaderParams.store';
import type { ShaderParams } from '../../store/shaderParams.store';
import { SHADER_READY_ATTRIBUTE, WEBGL_FIRST_DRAW_EVENT } from '../../hooks/useBootShield';

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;

uniform vec2  u_res;
uniform float u_time;
uniform vec2  u_mouse;
uniform float u_press;

// Nebula
uniform float u_nebShow;
uniform float u_nebSpeed;
uniform float u_nebIntensity;
uniform float u_nebVariation;
uniform float u_nebHue;
uniform float u_nebContrast;
uniform float u_nebDensity;
uniform float u_nebSat;
uniform float u_nebColorVar;
uniform float u_nebColorShift;

// Stars
uniform float u_starShow;
uniform float u_starDensity;
uniform float u_starBrightness;
uniform float u_starTwinkle;
uniform float u_starSize;
uniform float u_starParallax;

// Lensing
uniform float u_lensShow;
uniform float u_lensMass;
uniform float u_lensSize;
uniform float u_lensOpacity;

// Chromatic aberration
uniform float u_chromShow;
uniform float u_chromIntensity;

// Mouse nebula displacement
uniform float u_nebMouseShow;
uniform float u_nebMouseIntensity;
uniform vec2  u_mouseNeb;

// Cursor nebula
uniform float u_cursorNebShow;
uniform float u_cursorNebIntensity;
uniform float u_cursorNebRadius;
uniform vec2  u_mouseCursorNeb;

// Cursor halo
uniform float u_haloShow;
uniform float u_haloIntensity;
uniform vec2  u_mouseHalo;

// Click ring
uniform float u_ringShow;
uniform float u_ringIntensity;
uniform float u_ringSpeed;
uniform float u_ringWidth;
uniform float u_ringHue;
uniform float u_ringLife;
uniform float u_ringSaturation;
uniform vec4  u_clicks[8];

// Vignette
uniform float u_vigShow;

float hash12(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
vec2 hash22(vec2 p){
  p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3)));
  return fract(sin(p)*43758.5453);
}
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  float a=hash12(i), b=hash12(i+vec2(1,0));
  float c=hash12(i+vec2(0,1)), d=hash12(i+vec2(1,1));
  vec2 u=f*f*(3.0-2.0*f);
  return mix(a,b,u.x)+(c-a)*u.y*(1.0-u.x)+(d-b)*u.x*u.y;
}
float fbm(vec2 p){
  float v=0.0, a=0.5;
  for(int i=0;i<6;i++){ v+=a*noise(p); p=p*2.03+vec2(1.7,3.1); a*=0.5; }
  return v;
}

vec3 hueShift(vec3 col, float h){
  vec3 k = vec3(0.57735);
  float cosA = cos(h*6.2831);
  float sinA = sin(h*6.2831);
  return col*cosA + cross(k, col)*sinA + k*dot(k, col)*(1.0-cosA);
}

vec3 stars(vec2 p, float density, float seed){
  vec2 g = floor(p);
  vec2 f = fract(p);
  float s = hash12(g + seed);
  if(s < 1.0 - density) return vec3(0.0);
  vec2 cp = hash22(g + seed + 17.0);
  float d = length(f - cp);
  float sz = 0.06 * u_starSize;
  float br = smoothstep(sz, 0.0, d);
  float twinkleFreq = 1.5 + hash12(g + seed + 7.0) * 3.0;
  float tw = mix(1.0, 0.6 + 0.4*sin(u_time * twinkleFreq + s*40.0), u_starTwinkle);
  float hue = hash12(g + seed + 3.0);
  vec3 c = mix(vec3(0.8,0.9,1.0), vec3(1.0,0.85,0.7), hue);
  return c * br * tw * smoothstep(0.0, 1.0, s) * u_starBrightness;
}

vec3 starfield(vec2 p){
  vec3 c = vec3(0.0);
  float dens = u_starDensity;
  c += stars(p*9.0 + vec2(u_time*0.001*u_starParallax, u_time*0.0005*u_starParallax), 0.02*dens, 1.0) * 0.5;
  c += stars(p*18.0 + vec2(u_time*0.003*u_starParallax, u_time*0.002*u_starParallax), 0.015*dens, 2.0) * 0.8;
  c += stars(p*36.0 + vec2(u_time*0.008*u_starParallax, u_time*0.005*u_starParallax), 0.010*dens, 3.0) * 1.0;
  return c * u_starShow;
}

vec3 ringPalette(float h){
  vec3 base = vec3(1.0, 0.85, 0.55);
  return hueShift(base, h);
}

vec3 clickRings(vec2 p){
  if(u_ringShow < 0.5) return vec3(0.0);
  float aspect = u_res.x / u_res.y;
  vec3 acc = vec3(0.0);
  vec3 col = ringPalette(u_ringHue);
  float lum = dot(col, vec3(0.299,0.587,0.114));
  col = mix(vec3(lum), col, u_ringSaturation);
  float w = mix(20.0, 4.0, clamp(u_ringWidth, 0.0, 1.0));
  for(int i=0;i<8;i++){
    vec4 c = u_clicks[i];
    if(c.w <= 0.0) continue;
    vec2 cp = c.xy*2.0 - 1.0; cp.x *= aspect;
    float dd = length(p - cp);
    float r = c.z * u_ringSpeed;
    float ring = exp(-abs(dd - r)*w) * exp(-c.z*(1.5 / max(u_ringLife, 0.2))) * c.w;
    acc += col * ring * u_ringIntensity;
  }
  return acc;
}

vec3 ambientBG(vec2 p){
  vec3 bg = vec3(0.01, 0.012, 0.03);
  float t = u_time * u_nebSpeed;
  vec2 mp = u_mouseNeb * 2.0 - 1.0;
  mp.x *= u_res.x / u_res.y;
  vec2 toM = p - mp;
  float dM = length(toM);
  vec2 drift = normalize(toM + 1e-5) * exp(-dM*0.35) * u_nebMouseIntensity * u_nebMouseShow;
  vec2 np = p + drift;
  float scale = mix(0.6, 1.6, u_nebVariation);
  float neb  = fbm(np*scale + vec2(t*0.6, t*0.45));
  float neb2 = fbm(np*scale*1.7 + vec2(-t*0.4, t*0.3) + 11.0);
  neb = pow(clamp(neb, 0.0, 1.0), mix(2.2, 0.35, clamp(u_nebDensity, 0.0, 1.0)));
  float edge0 = mix(0.45, 0.25, u_nebContrast);
  float edge1 = mix(0.65, 0.90, u_nebContrast);
  vec3 dark   = vec3(0.02,0.03,0.08);
  vec3 lightA = vec3(0.35, 0.18, 0.55);
  vec3 lightB = vec3(0.15, 0.45, 0.60);
  lightA = hueShift(lightA, u_nebHue);
  lightB = hueShift(lightB, u_nebHue + u_nebColorShift);
  dark   = hueShift(dark,   u_nebHue * 0.4);
  vec3 light = mix(lightA, lightB, smoothstep(0.3, 0.8, neb2) * u_nebColorVar);
  vec3 nebCol = mix(dark, light, smoothstep(edge0, edge1, neb)) * u_nebIntensity * u_nebShow;
  float nebLum = dot(nebCol, vec3(0.299,0.587,0.114));
  nebCol = mix(vec3(nebLum), nebCol, u_nebSat);
  bg += nebCol;
  bg += starfield(p + vec2(10.0,10.0));
  return bg;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_res.xy;
  float aspect = u_res.x / u_res.y;
  vec2 p = uv*2.0 - 1.0;
  p.x *= aspect;
  vec2 mp = u_mouse*2.0 - 1.0;
  mp.x *= aspect;
  vec2 toC = p - mp;
  float d = length(toC);
  float mass = u_lensMass + u_press*0.06;
  float horizon = mass*0.9;

  // Lensing (toggleable)
  float bend = (mass / max(d*d, 0.002)) * u_lensShow;
  vec2 sdir = normalize(toC + 1e-5);
  vec2 sampP = mix(p, p - sdir * bend * u_lensSize, u_lensOpacity);
  vec3 bg = ambientBG(sampP);

  // Chromatic aberration (toggleable)
  if(u_chromShow > 0.5 && u_lensShow > 0.5){
    vec2 r_off = sampP - sdir * bend * 0.03;
    vec2 b_off = sampP + sdir * bend * 0.03;
    float rn = fbm(r_off*0.9 + vec2(u_time*0.02, u_time*0.015));
    float bn = fbm(b_off*0.9 + vec2(u_time*0.02, u_time*0.015));
    vec3 lensCol = vec3(
      0.12 + 0.6*smoothstep(0.35,0.75,rn),
      bg.g,
      0.12 + 0.9*smoothstep(0.35,0.75,bn)
    );
    bg = mix(bg, lensCol, smoothstep(0.5, horizon*2.0, 1.0/(d+0.01)) * u_chromIntensity);
  }

  vec3 col = bg;

  // Cursor nebula - organic purple cloud following cursor
  if(u_cursorNebShow > 0.5){
    vec2 cnP = u_mouseCursorNeb * 2.0 - 1.0;
    cnP.x *= aspect;
    float cnDist = length(p - cnP);
    float cnFalloff = exp(-cnDist * (3.0 / max(u_cursorNebRadius, 0.1)));
    float cnPattern = fbm(p * 1.5 + vec2(u_time * 0.08, u_time * 0.06));
    vec3 cnColor = hueShift(vec3(0.35, 0.18, 0.55), u_nebHue);
    col += cnColor * cnFalloff * cnPattern * u_cursorNebIntensity;
  }

  // Click rings
  col += clickRings(p);

  // Cursor halo (uses separate u_mouseHalo position)
  vec2 haloP = u_mouseHalo*2.0-1.0;
  haloP.x *= aspect;
  float dHalo = length(p - haloP);
  col += vec3(0.9,0.8,0.6) * exp(-dHalo*14.0) * u_haloIntensity * u_haloShow;

  // Vignette
  float vig = mix(1.0, 0.85 + 0.2*smoothstep(1.8, 0.2, length(p)), u_vigShow);
  col *= vig;

  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
// WebGL helpers
// ---------------------------------------------------------------------------

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
    const s = gl.createShader(type);
    if (!s) { console.error('WebGL: createShader returned null'); return null; }
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
    }
    return s;
}

function createProgram(gl: WebGLRenderingContext, vsSrc: string, fsSrc: string): WebGLProgram | null {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    const p = gl.createProgram();
    if (!p) return null;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'a_pos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.error('Program link error:', gl.getProgramInfoLog(p));
        gl.deleteProgram(p);
        return null;
    }
    return p;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function EventHorizonBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const params = useShaderParamsStore((s) => s.params);
    const paramsRef = useRef<ShaderParams>(params);

    // Sync state to ref (ref is read in the frame loop without re-renders)
    useEffect(() => {
        paramsRef.current = params;
    }, [params]);

    // WebGL setup
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // --- Mutable state shared across init/frame/cleanup ---
        const mouse = { x: 0.5, y: 0.5 };
        const smoothMouseNeb = { x: 0.5, y: 0.5 };
        const smoothMouseCursorNeb = { x: 0.5, y: 0.5 };
        const smoothMouseHalo = { x: 0.5, y: 0.5 };
        const clicks: { x: number; y: number; t: number; strength: number }[] = [];
        let startTime = performance.now();
        let rafId = 0;
        let prevT = 0;
        let gl: WebGLRenderingContext | null = null;
        let prog: WebGLProgram | null = null;
        let buf: WebGLBuffer | null = null;
        let uRes: WebGLUniformLocation | null = null;
        let uTime: WebGLUniformLocation | null = null;
        let uMouse: WebGLUniformLocation | null = null;
        let uMouseNeb: WebGLUniformLocation | null = null;
        let uMouseCursorNeb: WebGLUniformLocation | null = null;
        let uMouseHalo: WebGLUniformLocation | null = null;
        let uPress: WebGLUniformLocation | null = null;
        let uClicks: WebGLUniformLocation | null = null;
        let paramUniforms: Partial<Record<keyof ShaderParams, WebGLUniformLocation | null>> = {};


        // --- Resize helper (returns false if canvas has no size) ---
        function resize() {
            if (!gl || !canvas) return false;
            const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
            const w = Math.floor(canvas.clientWidth * dpr);
            const h = Math.floor(canvas.clientHeight * dpr);
            if (w === 0 || h === 0) return false;
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
                gl.viewport(0, 0, w, h);
            }
            return true;
        }

        // --- Full GL init (called on mount AND on context restore) ---
        function initGL(): boolean {
            gl = canvas!.getContext('webgl', {
                alpha: false,
                antialias: false,
                premultipliedAlpha: false,
                powerPreference: 'high-performance',
            });
            if (!gl) return false;
            if (gl.isContextLost()) return false;

            gl.clearColor(0.02, 0.027, 0.04, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);

            prog = createProgram(gl, VERT, FRAG);
            if (!prog) return false;

            buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

            uRes = gl.getUniformLocation(prog, 'u_res');
            uTime = gl.getUniformLocation(prog, 'u_time');
            uMouse = gl.getUniformLocation(prog, 'u_mouse');
            uMouseNeb = gl.getUniformLocation(prog, 'u_mouseNeb');
            uMouseCursorNeb = gl.getUniformLocation(prog, 'u_mouseCursorNeb');
            uMouseHalo = gl.getUniformLocation(prog, 'u_mouseHalo');
            uPress = gl.getUniformLocation(prog, 'u_press');
            uClicks = gl.getUniformLocation(prog, 'u_clicks[0]');

            paramUniforms = {};
            for (const key of Object.keys(UNIFORM_MAP) as (keyof ShaderParams)[]) {
                paramUniforms[key] = gl.getUniformLocation(prog, UNIFORM_MAP[key]!);
            }

            // ── SYNCHRONOUS FIRST DRAW — eliminates blank frame on mount ──
            if (resize()) {
                const p = paramsRef.current;
                gl.useProgram(prog);
                if (uRes) gl.uniform2f(uRes, canvas!.width, canvas!.height);
                if (uTime) gl.uniform1f(uTime, 0);
                if (uMouse) gl.uniform2f(uMouse, 0.5, 0.5);
                if (uMouseNeb) gl.uniform2f(uMouseNeb, 0.5, 0.5);
                if (uMouseCursorNeb) gl.uniform2f(uMouseCursorNeb, 0.5, 0.5);
                if (uMouseHalo) gl.uniform2f(uMouseHalo, 0.5, 0.5);
                if (uPress) gl.uniform1f(uPress, 0);
                for (const key of Object.keys(paramUniforms) as (keyof ShaderParams)[]) {
                    const loc = paramUniforms[key];
                    if (loc) gl.uniform1f(loc, p[key]);
                }
                if (uClicks) gl.uniform4fv(uClicks, new Float32Array(32));
                gl.drawArrays(gl.TRIANGLES, 0, 3);
                canvas!.setAttribute(SHADER_READY_ATTRIBUTE, 'true');
                canvas!.dispatchEvent(new CustomEvent(WEBGL_FIRST_DRAW_EVENT, { bubbles: true }));
            }

            return true;
        }

        // --- Context lost/restored handlers ---
        const handleContextLost = (e: Event) => {
            e.preventDefault();
            cancelAnimationFrame(rafId);
        };
        const handleContextRestored = () => {
            if (initGL()) {
                startTime = performance.now();
                prevT = 0;
                rafId = requestAnimationFrame(frame);
            }
        };
        canvas.addEventListener('webglcontextlost', handleContextLost);
        canvas.addEventListener('webglcontextrestored', handleContextRestored);

        // --- Frame loop ---
        function frame(now: number) {
            if (!gl || gl.isContextLost() || !prog) return;
            if (!resize()) {
                rafId = requestAnimationFrame(frame);
                return;
            }
            gl.clear(gl.COLOR_BUFFER_BIT);
            const t = (now - startTime) / 1000;
            const p = paramsRef.current;
            const lensSpeed = p.lensDriftSpeed;
            const autoLensX = 0.5 + 0.35 * Math.sin(t * 0.1 * lensSpeed) * Math.cos(t * 0.07 * lensSpeed);
            const autoLensY = 0.5 + 0.3 * Math.cos(t * 0.08 * lensSpeed) * Math.sin(t * 0.13 * lensSpeed);
            smoothMouseNeb.x += (mouse.x - smoothMouseNeb.x) * p.nebMouseLag;
            smoothMouseNeb.y += (mouse.y - smoothMouseNeb.y) * p.nebMouseLag;
            smoothMouseCursorNeb.x += (mouse.x - smoothMouseCursorNeb.x) * p.cursorNebLag;
            smoothMouseCursorNeb.y += (mouse.y - smoothMouseCursorNeb.y) * p.cursorNebLag;
            smoothMouseHalo.x += (mouse.x - smoothMouseHalo.x) * p.haloLag;
            smoothMouseHalo.y += (mouse.y - smoothMouseHalo.y) * p.haloLag;

            const dt = Math.min(0.05, t - (prevT || t));
            for (const c of clicks) { c.t += dt; c.strength *= Math.pow(0.35, dt); }
            for (let i = clicks.length - 1; i >= 0; i--) {
                if (clicks[i].t > 4.5 || clicks[i].strength < 0.02) clicks.splice(i, 1);
            }

            gl.useProgram(prog);
            if (uRes) gl.uniform2f(uRes, canvas!.width, canvas!.height);
            if (uTime) gl.uniform1f(uTime, t);
            if (uMouse) gl.uniform2f(uMouse, autoLensX, autoLensY);
            if (uMouseNeb) gl.uniform2f(uMouseNeb, smoothMouseNeb.x, smoothMouseNeb.y);
            if (uMouseCursorNeb) gl.uniform2f(uMouseCursorNeb, smoothMouseCursorNeb.x, smoothMouseCursorNeb.y);
            if (uMouseHalo) gl.uniform2f(uMouseHalo, smoothMouseHalo.x, smoothMouseHalo.y);
            if (uPress) gl.uniform1f(uPress, 0);

            let effectiveLensOpacity = p.lensOpacity;
            if (p.lensAutoOpacity > 0.5) {
                const s = p.lensAutoSpeed;
                const breath = 0.5 + 0.25 * Math.sin(t * s) + 0.15 * Math.sin(t * s * 1.7) + 0.1 * Math.sin(t * s * 0.6);
                effectiveLensOpacity = p.lensOpacity * Math.max(0, Math.min(1, breath));
            }

            for (const key of Object.keys(paramUniforms) as (keyof ShaderParams)[]) {
                const loc = paramUniforms[key];
                if (loc) gl.uniform1f(loc, p[key]);
            }

            if (uClicks) {
                const arr = new Float32Array(8 * 4);
                for (let i = 0; i < clicks.length && i < 8; i++) {
                    arr[i * 4 + 0] = clicks[i].x;
                    arr[i * 4 + 1] = clicks[i].y;
                    arr[i * 4 + 2] = clicks[i].t;
                    arr[i * 4 + 3] = clicks[i].strength;
                }
                gl.uniform4fv(uClicks, arr);
            }

            const uLensOpacityLoc = paramUniforms.lensOpacity;
            if (uLensOpacityLoc) gl.uniform1f(uLensOpacityLoc, effectiveLensOpacity);

            gl.drawArrays(gl.TRIANGLES, 0, 3);



            prevT = t;
            rafId = requestAnimationFrame(frame);
        }

        // --- Input handlers ---
        const handleMouseMove = (e: MouseEvent) => {
            mouse.x = e.clientX / window.innerWidth;
            mouse.y = 1 - e.clientY / window.innerHeight;
        };
        window.addEventListener('pointermove', handleMouseMove);

        const handleClick = (e: MouseEvent) => {
            const nx = e.clientX / window.innerWidth;
            const ny = 1 - (e.clientY / window.innerHeight);
            clicks.push({ x: nx, y: ny, t: 0, strength: 1 });
            if (clicks.length > 8) clicks.shift();
        };
        window.addEventListener('pointerdown', handleClick);

        // --- Init and start ---
        if (initGL()) {
            rafId = requestAnimationFrame(frame);
        }

        // --- Cleanup (StrictMode safe: releases GL resources) ---
        return () => {
            cancelAnimationFrame(rafId);
            window.removeEventListener('pointermove', handleMouseMove);
            window.removeEventListener('pointerdown', handleClick);
            canvas.removeEventListener('webglcontextlost', handleContextLost);
            canvas.removeEventListener('webglcontextrestored', handleContextRestored);

            if (gl && !gl.isContextLost()) {
                if (prog) gl.deleteProgram(prog);
                if (buf) gl.deleteBuffer(buf);
            }
            gl = null;
            prog = null;
            buf = null;
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            className="fixed inset-0 w-full h-full"
            data-hmi-shader-canvas="true"
            style={{ zIndex: 1, pointerEvents: 'none', backgroundColor: 'var(--color-industrial-bg)' }}
            aria-hidden="true"
        />
    );
}
