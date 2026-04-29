# Shader Background — Event Horizon

> Documentación técnica del fondo animado WebGL de la HMI.

---

## Arquitectura

El fondo es un **canvas WebGL** con shaders GLSL que se ejecutan directamente en la **GPU**. No usa imágenes, texturas ni assets externos — todo es matemática pura.

```
React Component (TSX)
  └── <canvas> (position: fixed, z-index: 0, behind all UI)
       └── WebGL 1.0 context
            └── Fragment shader (GLSL ES 1.00)
                 └── Se ejecuta por cada pixel, ~60 FPS
```

**Archivo principal:** [`hmi-app/src/components/ui/EventHorizonBackground.tsx`](../hmi-app/src/components/ui/EventHorizonBackground.tsx)

**Montaje:** [`hmi-app/src/layouts/MainLayout.tsx`](../hmi-app/src/layouts/MainLayout.tsx) — primer hijo del wrapper, detrás de Topbar y contenido.

---

## Efectos Visuales

| Efecto | Descripción | Controlable |
|--------|-------------|-------------|
| Nebulosa volumétrica | FBM (6 octavas), colores púrpura/cyan con hue shift | Speed, Intensity, Variation, Contrast, Density, Hue, Saturation, Color Variation, Color Shift |
| Campo de estrellas | 3 capas con parallax temporal, twinkle aleatorio por estrella | Density, Brightness, Size, Twinkle, Parallax Depth |
| Lensing gravitacional | Distorsión de coordenadas tipo lupa, movimiento autónomo Lissajous | Intensity, Size, Max Opacity, Auto Breathing, Breathing Speed, Drift Speed |
| Aberración cromática | Separación rojo/azul cerca del punto de lensing | Intensity (toggle + slider) |
| Mouse Nebula | Desplazamiento FBM de la nebulosa por posición del cursor | Intensity, Follow Delay |
| Cursor Nebula | Glow púrpura FBM-modulado que sigue al cursor | Intensity, Radius, Follow Delay |
| Cursor Halo | Punto dorado sutil en la posición del mouse | Intensity, Follow Delay |
| Click Ring | Onda de choque expansiva al hacer click (8 slots simultáneos) | Intensity, Expansion Speed, Width, Duration, Color Hue, Saturation |
| Viñeta | Oscurecimiento en los bordes de la pantalla | Toggle on/off |

---

## Posiciones de Mouse Independientes

El shader maneja 4 fuentes de posición independientes, cada una con su propio suavizado:

| Posición | Fuente | Uniform | Controla |
|----------|--------|---------|----------|
| Lensing | Autónomo (Lissajous desde tiempo) | `u_mouse` | Lupa + aberración cromática |
| Mouse Nebula drift | Mouse real + `nebMouseLag` | `u_mouseNeb` | Drift FBM en ambientBG |
| Cursor Nebula | Mouse real + `cursorNebLag` | `u_mouseCursorNeb` | Glow púrpura |
| Cursor Halo | Mouse real + `haloLag` | `u_mouseHalo` | Punto dorado |

---

## Compatibilidad

| Plataforma | Soporte |
|------------|---------|
| Chrome (Windows/Mac/Linux) | SI — WebGL 1.0 desde 2011 |
| Firefox | SI |
| Edge | SI (mismo motor que Chrome) |
| Safari (Mac/iOS) | SI — ANGLE puede tener quirks |
| Mobile (Android/iOS) | SI — rendimiento limitado en GPUs bajas |

**WebGL 1.0** tiene soporte en el **98%+ de navegadores activos**.

---

## Performance

| Factor | Implementación |
|--------|---------------|
| FBM (6 octavas) x ~4 por frame | Lo más costoso — cálculo de nebulosa |
| DPR capado a 1.5 | Reduce resolución del canvas |
| Sin texturas/assets | Cero network requests |
| `requestAnimationFrame` | Solo renderiza cuando la pestaña está visible |
| `powerPreference: 'high-performance'` | Usa GPU dedicada si existe |

- **GPU integrada moderna** (Intel UHD 630+): ~60 FPS
- **GPU dedicada** (NVIDIA/AMD): sin impacto perceptible
- **GPU vieja/mobile**: 30-40 FPS (mitigado por DPR cap)
- **Impacto en carga de página**: cero — se inicializa en `useEffect` post-mount

---

## Fallback

Si WebGL no está disponible o el shader falla:
1. El canvas se oculta (`display: none`)
2. El `body` mantiene `background-color: var(--color-industrial-bg)` (#05070a)
3. La aplicación funciona normalmente sin efecto visual

---

## Boot & Reload Shield

Para cubrir el hueco entre el HTML inicial, el mount de React y el teardown por reload, la shell ahora usa un **shield estático** (`#hmi-shield`) definido en [`hmi-app/index.html`](../hmi-app/index.html).

### Secuencia de boot

1. El navegador parsea `index.html` y pinta inmediatamente un fondo oscuro con `var(--color-industrial-bg, #05070a)`.
2. `#hmi-shield` queda visible por encima de todo el documento con el mensaje fijo `ACTUALIZANDO DATOS`, un cursor-loader monocromático CSS-only y fallback `Consolas, monospace`.
3. [`useBootShield`](../hmi-app/src/hooks/useBootShield.ts) espera:
   - `document.fonts.ready` si el navegador soporta FontFaceSet,
   - validación adicional con `document.fonts.check(...)` para las fuentes reales de la app cuando está disponible,
   - la señal real `webgl-first-draw` del canvas shader cuando existe,
   - múltiples `requestAnimationFrame` para garantizar un frame compuesto estable,
   - un tiempo mínimo visible conservador para no destapar tipografías/layout todavía inestables,
   - y un timeout acotado de 5s para no dejar la HMI bloqueada si algo no resuelve.
4. Cuando la shell está lista, el shield hace fade-out, queda oculto/inerte y se reutiliza si después hay un reload por teclado.

### Secuencia de reload por teclado

[`useReloadShield`](../hmi-app/src/hooks/useReloadShield.ts) vive en [`App`](../hmi-app/src/App.tsx) porque esto es lifecycle global de shell y debe cubrir tanto viewer como `/admin`, no solo `MainLayout`:

1. Intercepta en capture phase `Ctrl+R`, `Ctrl+Shift+R`, `F5` y también `Meta+R`.
2. Si el evento es cancelable y el documento tiene foco, hace `preventDefault()`.
3. Re-muestra `#hmi-shield`, oculta el canvas marcado con `data-hmi-shader-canvas` y espera un `requestAnimationFrame`.
4. Recién ahí dispara `location.reload()` para que el último frame visible siga siendo oscuro.

### Hardening WebGL

El canvas pide el contexto con `alpha: false`. Eso vuelve opaco el backbuffer y evita que el compositor muestre un frame blanco detrás del shader durante descartes/transiciones de unload.

- No cambia el output visual: el fragment shader ya escribe `gl_FragColor = vec4(col, 1.0)`.
- El canvas marca `data-hmi-webgl-ready="true"` y emite `webgl-first-draw` después del draw sincrónico inicial para que el gate de boot pueda resolver incluso si el evento ocurrió antes de enganchar el listener.

### Limitaciones conocidas

- **Toolbar / browser chrome reload**: no se puede interceptar desde JavaScript de página. Ahí solo ayudan el fondo oscuro temprano y `alpha: false`.
- **`location.reload()` no preserva hard-reload cache bypass**: visualmente protege, pero semánticamente se comporta como reload programático normal.
- **Si el JS no carga**: el shield queda visible en forma permanente. Es aceptable porque muestra un estado oscuro y legible en vez de UI rota o flash blanco.

---

## Panel de Control (Shader Tweaks)

Botón de engranaje en la esquina inferior izquierda. Permite ajustar TODOS los parámetros en tiempo real:
- Sliders con valores numéricos
- Toggles on/off por sección
- Secciones colapsables
- Botón Reset para restaurar defaults

---

## Gotchas y Decisiones Técnicas

1. **React StrictMode**: en desarrollo, los effects se ejecutan dos veces. No llamar `loseContext()` en el cleanup — el segundo mount encontraría un contexto muerto.

2. **GLSL en Windows/ANGLE**: evitar caracteres unicode en comentarios del shader. Algunos drivers fallan silenciosamente (`getShaderInfoLog` retorna `null`).

3. **Nebulosa reactiva al cursor**: la nube púrpura visible NO se genera con drift FBM (demasiado sutil). Es un efecto independiente (Cursor Nebula) con glow radial modulado por FBM.

4. **Lensing autónomo**: la "lupa" se mueve sola con un path Lissajous, no sigue al cursor. Esto separa el efecto visual del input del usuario.

5. **Auto-breathing**: la opacidad del lensing oscila orgánicamente usando múltiples senos con frecuencias irracionales, evitando repetición perceptible.

6. **Click rings**: los clicks en el panel de tweaks (`data-shader-panel`) no generan rings.

7. **Uniforms JS-only**: parámetros como `haloLag`, `nebMouseLag`, `lensDriftSpeed` NO son uniforms del shader — se procesan en JavaScript y no aparecen en `UNIFORM_MAP`.
