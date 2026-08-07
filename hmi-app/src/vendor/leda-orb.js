// <leda-orb> — real-time WebGL voice orb. Transparent background, premultiplied alpha.
// Attributes: speaking, intensity, speed, core, glow, size
// Properties/methods: .level = 0..1 (drive from real audio), .setSpeaking(bool)
(function () {
  const VERT = `attribute vec2 aPos; void main(){ gl_Position = vec4(aPos,0.0,1.0); }`;

  const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime, uLevel, uIntensity, uRays;
uniform vec3 uCore, uGlow;

float hash(vec3 p){ p = fract(p*0.3183099 + vec3(0.71,0.113,0.419)); p *= 17.0;
  return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x),
                 mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
                 mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*noise(p); p=p*2.03+vec3(1.7,9.2,4.3); a*=0.5; } return s; }
float smoothfbm(vec3 p){ return 0.62*noise(p) + 0.38*noise(p*2.07+vec3(4.1,1.3,7.7)); }

// radial beams: field varies mostly with direction, so it reads as light shot inward from the rim
float beams(vec3 dir, float rad, float rp, float t, float lvl){
  float a = smoothfbm(dir*5.0 + vec3(0.0, t*0.06, t*0.045) + vec3(rad*0.30));
  float b = smoothfbm(dir*9.0 + vec3(t*0.09, -t*0.05, 0.0) + vec3(rad*0.5));
  float f = a*0.70 + b*0.30;
  float streak = smoothstep(0.44, 0.80, f);
  streak *= streak;
  float len = mix(0.08, 0.34, uRays);
  float depth = exp(-max(0.0, 1.0 - rp)/len);
  float gate0 = mix(0.62, 0.10, uRays);
  float core = smoothstep(gate0, gate0+0.22, rp);
  return streak*depth*core*uRays*(0.6 + 0.7*lvl);
}

float dens(vec3 p, float t, float lvl, out float hot){
  vec3 dir = normalize(p);
  float rad = length(p);
  float rp = length(p.xy);
  vec3 q = dir*1.05 + vec3(0.0, t*0.045, t*0.06);
  float w1 = smoothfbm(q*1.35 + vec3(-t*0.05, t*0.03, 0.0));
  float w = smoothfbm(q + vec3(w1)*(1.15 + 0.3*lvl));
  float fold = smoothfbm(dir*0.95 + vec3(t*0.05, -t*0.038, t*0.022));
  // membrane radius: folds inward where the field peaks — deeper while speaking
  float R = 1.0 - (0.05 + 0.20*lvl) * pow(max(fold-0.52,0.0)*2.2, 1.15);
  float d = rad - R;
  float sig = 0.011 + 0.030*fold + 0.016*lvl;
  float band = exp(-d*d/(2.0*sig*sig));
  float r = abs(fract(w*1.9 + t*0.03) - 0.5);
  float ribbon = smoothstep(0.085, 0.006, r);
  float veil = smoothstep(0.28, 0.07, r);
  float sw = sig*2.0;
  float bandWide = exp(-d*d/(2.0*sw*sw));
  hot = smoothstep(0.022, 0.0, r);
  float mask = smoothstep(0.52, 0.88, rp);
  return (ribbon*band + veil*bandWide*0.06)*mask + beams(dir, rad, rp, t, lvl)*0.72;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*uRes) / min(uRes.x, uRes.y) * 2.32;
  float len = length(uv);
  vec3 col = vec3(0.0);
  float lvl = uLevel;

  if (len < 1.02) {
    float h = sqrt(max(1.02*1.02 - len*len, 0.0));
    vec3 ro = vec3(uv, h);
    vec3 rd = vec3(0.0, 0.0, -1.0);
    const int STEPS = 44;
    float span = 2.0*h;
    float dt = span/float(STEPS);
    float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453);
    vec3 p = ro + rd*dt*jitter;
    for (int i=0;i<STEPS;i++){
      float hot;
      float d = dens(p, uTime, lvl, hot);
      float depth = 0.55 + 0.45*smoothstep(-1.0, 1.0, p.z);
      col += d*dt*depth*mix(uCore, uGlow, hot*0.85);
      p += rd*dt;
    }
    col *= 12.5*(0.9 + 0.28*lvl);
  }

  // membrane edge: crisp ring + soft outer bloom
  float e = len - 1.0;
  float ring = exp(-e*e/(2.0*0.0125*0.0125));
  float bloom = exp(-e*e/(2.0*0.075*0.075));
  float inner = exp(-e*e/(2.0*0.30*0.30)) * step(len, 1.0);
  float shimmer = 0.75 + 0.25*fbm(vec3(normalize(vec3(uv,0.35))*3.0 + vec3(0.0,uTime*0.12,0.0)));
  col += uGlow*(ring*1.25*shimmer + bloom*0.42*shimmer)*(0.9 + 0.55*lvl);
  col += uCore*(inner*0.16 + bloom*0.30)*(0.9 + 0.4*lvl);

  col *= uIntensity;
  float a = clamp(max(max(col.r,col.g),col.b), 0.0, 1.0);
  gl_FragColor = vec4(clamp(col,0.0,1.0), a); // premultiplied
}`;

  function hex(c, fb) {
    const m = /^#?([0-9a-f]{6})$/i.exec((c || '').trim());
    const v = m ? parseInt(m[1], 16) : fb;
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }

  class LedaOrb extends HTMLElement {
    static get observedAttributes() { return ['speaking', 'intensity', 'speed', 'core', 'glow', 'rays']; }
    constructor() {
      super();
      this._level = 0; this._target = 0; this._t = 0; this._last = 0;
      this._env = { next: 0, hold: 0 };
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML =
        '<style>:host{display:block;width:100%;height:100%}canvas{display:block;width:100%;height:100%;background:transparent}</style><canvas></canvas>';
      this.canvas = this.shadowRoot.querySelector('canvas');
    }
    get level() { return this._level; }
    set level(v) { this._target = Math.max(0, Math.min(1, v)); this._manual = true; }
    setSpeaking(v) { v ? this.setAttribute('speaking', '') : this.removeAttribute('speaking'); }

    connectedCallback() {
      const gl = this.canvas.getContext('webgl', {
        alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true
      });
      if (!gl) return;
      this.gl = gl;
      const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(sh)); return sh; };
      const prog = gl.createProgram();
      gl.attachShader(prog, mk(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog); gl.useProgram(prog);
      this.prog = prog;
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.u = {};
      ['uRes','uTime','uLevel','uIntensity','uRays','uCore','uGlow'].forEach(n => this.u[n] = gl.getUniformLocation(prog, n));
      this._ro = new ResizeObserver(() => this._resize()); this._ro.observe(this);
      this._resize();
      this._last = performance.now();
      const loop = (now) => {
        this._raf = requestAnimationFrame(loop);
        const dt = Math.min(0.05, (now - this._last) / 1000); this._last = now;
        this._tick(dt); this._draw();
      };
      this._raf = requestAnimationFrame(loop);
    }
    disconnectedCallback() { cancelAnimationFrame(this._raf); if (this._ro) this._ro.disconnect(); }

    _resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = this.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w; this.canvas.height = h;
        this.gl.viewport(0, 0, w, h);
      }
    }
    // synthetic speech envelope: syllabic pulses + breath, never a repeating pattern
    _tick(dt) {
      const speed = parseFloat(this.getAttribute('speed') || '1') || 1;
      this._t += dt * speed * (0.55 + 2.1 * this._level);
      const speaking = this.hasAttribute('speaking');
      if (!this._manual) {
        if (speaking) {
          this._env.hold -= dt;
          if (this._env.hold <= 0) {
            this._env.hold = 0.09 + Math.random() * 0.22;
            const gap = Math.random() < 0.16;
            this._target = gap ? 0.10 + Math.random() * 0.12 : 0.42 + Math.random() * 0.58;
          }
        } else {
          this._target = 0.06 + 0.05 * (0.5 + 0.5 * Math.sin(this._t * 0.55));
        }
      }
      const k = this._target > this._level ? 9.5 : 4.0;
      this._level += (this._target - this._level) * Math.min(1, k * dt);
    }
    _draw() {
      const gl = this.gl; if (!gl) return;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(this.u.uRes, this.canvas.width, this.canvas.height);
      gl.uniform1f(this.u.uTime, this._t);
      gl.uniform1f(this.u.uLevel, this._level);
      gl.uniform1f(this.u.uIntensity, parseFloat(this.getAttribute('intensity') || '1') || 1);
      const rays = parseFloat(this.getAttribute('rays'));
      gl.uniform1f(this.u.uRays, isNaN(rays) ? 0.45 : rays);
      gl.uniform3fv(this.u.uCore, hex(this.getAttribute('core'), 0x1b6ee0));
      gl.uniform3fv(this.u.uGlow, hex(this.getAttribute('glow'), 0x8ff0ff));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }
  if (!customElements.get('leda-orb')) customElements.define('leda-orb', LedaOrb);
})();
