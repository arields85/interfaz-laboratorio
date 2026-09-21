# UI Style Guide — Design System Base v1

**Proyecto:** interfaz HMI\
**Estado:** Histórico — no normativo (estado original: ✅ Activo · Baseline Visual Oficial)\
**Versión:** 1.0.0  
**Fecha de baseline:** 2026-03-11  
**Complementa a:**
- `Directiva_maestra_v3.1.md`
- `Arquitectura Técnica de Implementación HMI v1.3.md`
- `Especificación funcional_Modo Administrador.md`

> **Aviso histórico — no normativo.**
> Este documento es un antecedente histórico del proyecto **interfaz HMI**. Registra el baseline visual de una etapa anterior del proyecto y puede contener información obsoleta o superada. No es fuente de requisitos ni de verdad de implementación vigente.
> Para el estado actual, consultá [`../AGENTS.md`](../AGENTS.md) y la documentación activa en `../docs/`.

---

> **Propósito de este documento.**
> Este archivo es el baseline visual oficial del proyecto. Define el lenguaje visual ya implementado y validado en la interfaz. Cualquier nueva pantalla, widget, componente o variante visual **debe respetar estos fundamentos** antes de introducir cualquier cambio estético. Ningún valor visual puede quedar hardcodeado fuera de los tokens aquí definidos.

---

## Índice

1. [Principios de Diseño](#1-principios-de-diseño)
2. [Tokens — Paleta de Colores](#2-tokens--paleta-de-colores)
3. [Tokens — Tipografía](#3-tokens--tipografía)
4. [Tokens — Animaciones](#4-tokens--animaciones)
5. [Utilities CSS](#5-utilities-css)
6. [Fondos y Superficies](#6-fondos-y-superficies)
7. [Tipografía y Jerarquías de Texto](#7-tipografía-y-jerarquías-de-texto)
8. [Spacing y Layout](#8-spacing-y-layout)
9. [Radios, Bordes y Elevaciones](#9-radios-bordes-y-elevaciones)
10. [Glows y Sombras](#10-glows-y-sombras)
11. [Estados Visuales Semánticos](#11-estados-visuales-semánticos)
12. [Reglas de Hover / Focus / Active / Selected / Disabled](#12-reglas-de-hover--focus--active--selected--disabled)
13. [Topbar](#13-topbar)
14. [Sidebar](#14-sidebar)
15. [Cards y Widgets — Anatomía](#15-cards-y-widgets--anatomía)
16. [Gráficos (Recharts)](#16-gráficos-recharts)
17. [Iconografía](#17-iconografía)
18. [Principios de Composición Visual para Dashboards](#18-principios-de-composición-visual-para-dashboards)
19. [Clasificación de valores: tokens, utilities y hardcoded prohibidos](#19-clasificación-de-valores-tokens-utilities-y-hardcoded-prohibidos)

---

## 1. Principios de Diseño

La plataforma HMI se rige por siete principios visuales no negociables:

| # | Principio | Descripción |
|---|-----------|-------------|
| 1 | **Dark-first** | El fondo es siempre negro profundo. No existen modos claros. La interfaz pertenece al entorno industrial de sala de control. |
| 2 | **Semántica cromática** | El color no es decoración. Cada acento tiene un significado operativo fijo. Usarlo fuera de ese contexto es un error de diseño. |
| 3 | **Densidad con respiración** | Alta densidad de información, pero con padding generoso y `gap` consistente. Nunca espacio vacío improductivo ni amontonamiento. |
| 4 | **Estado siempre visible** | Todo componente debe comunicar su estado operativo incluso cuando no hay dato disponible. El "silencio" visual no existe. |
| 5 | **Jerarquía de 3 niveles** | L1 = KPIs globales / estado de planta. L2 = variables clave y alertas activas. L3 = contexto histórico, tendencias, detalles. |
| 6 | **Glass sobre oscuro** | Los paneles usan glassmorphism controlado (blur + transparencia mínima) para dar profundidad sin conflicto con el fondo. |
| 7 | **Sin placeholder visual** | No existe estado "vacío decorativo". Cada posición en el layout siempre tiene contenido activo o un estado explícito de sin-datos. |

---

## 2. Tokens — Paleta de Colores

Todos los tokens están declarados en `src/index.css` bajo `@theme {}` y son la única fuente de verdad de color.

### 2.1 Fondos y superficies base

| Token CSS | Valor | Uso obligatorio |
|-----------|-------|-----------------|
| `--color-industrial-bg` | `#05070a` | Fondo global de la aplicación. El negro más profundo. Body y Sidebar. |
| `--color-industrial-surface` | `#0e1117` | Superficie base de paneles, cards y contenedores. Primer nivel sobre bg. |
| `--color-industrial-hover` | `#161b22` | Superficie en estado hover interactivo. Segundo nivel sobre surface. |
| `--color-industrial-border` | `rgba(255,255,255,0.08)` | Bordes sutiles entre elementos. Separación suave sin contraste duro. |

### 2.2 Texto

| Token CSS | Valor | Uso |
|-----------|-------|-----|
| `--color-industrial-text` | `#f1f5f9` | Texto principal, valores primarios, headings activos. |
| `--color-industrial-muted` | `#94a3b8` | Labels, subtítulos, textos secundarios, nav inactivo. |
| — (sin token) | `#8F9BB3` | Ejes de gráficos, timestamps, metadata técnica. No usar fuera de charts. |
| — (sin token) | `#4a5568` | Placeholders, inputs no activos, texto deshabilitado. |

### 2.3 Acentos funcionales

| Token CSS | Valor hex | Semántica de uso | ⚠️ Restricción |
|-----------|-----------|------------------|----------------|
| `--color-accent-purple` | `#a855f7` | **Acento estructural primario**. Etiquetas (badges), tipos, recuadros y marca. | Nuevo acento base. No usar para dar semántica de alerta. |
| `--color-accent-blue` | `#3b82f6` | **Acento interactivo primario**. Botones, toggles, selecciones y hovers. | Único color para acciones y estados (On/Off). |
| `--color-accent-blue-glow` | `#60a5fa` | Variante luminosa del azul. Solo para glows de elementos interactivos. | Solo en CSS shadow/filter. |
| `--color-accent-cyan` | `#22d3ee` | Acento para gráficos y visualización de datos numéricos brutos. | 🚫 **PROHIBIDO** para botones, switches y recuadros. |
| `--color-accent-green` | `#10b981` | Estado running, online, produciendo, OK. | Solo para semántica operativa positiva. |
| `--color-accent-amber` | `#f59e0b` | Estado warning, advertencia, umbral próximo, degradado. | Solo para semántica de precaución. |
| `--color-accent-ruby` | `#ef4444` | Estado critical, alarma activa, offline confirmado, error fatal. | Solo para emergencias y errores. No usar para decoración. |
| `--color-accent-pink` | `#ec4899` | Acento terciario. Uso decorativo muy controlado. | Máximo un elemento por vista. |

### 2.4 Regla semántica de color — resumen operativo

```
🟣 Purple (#a855f7)                  →  Acento de Marca · Etiquetas base · Estructura
🔵 Azul (#3b82f6)                    →  Interactive UI · Botones · Toggles · Foco · Hover
🟢 Verde (#10b981)                   →  Normal · Online · Produciendo · OK
🟡 Amber (#f59e0b)                   →  Warning · Umbral próximo · Degradado
🔴 Ruby (#ef4444)                    →  Crítico · Alarma · Offline · Error
💠 Cyan (#22d3ee)                    →  Visualización (Charts) · Líneas gráficas exclusivas
```

---

## 3. Tokens — Tipografía

| Token CSS | Valor | Fallback |
|-----------|-------|---------|
| `--font-sans` | `"Plus Jakarta Sans"` | `system-ui, sans-serif` |
| `--font-mono` | `"Roboto Mono"` | `monospace` |

**Fuente principal:** Plus Jakarta Sans — usada en el 100% de la UI.  
**Fuente mono:** Roboto Mono — reservada para valores numéricos técnicos de precisión (timestamps de log, códigos de error, valores de telemetría RAW cuando se requiera máxima legibilidad de dígitos).

---

## 4. Tokens — Animaciones

| Token CSS | Definición | Uso |
|-----------|-----------|-----|
| `--animate-pulse-slow` | `pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite` | Dot indicador de estado activo que requiere atención. |

Clase de uso: `animate-pulse-slow` en Tailwind (disponible vía token).

---

## 5. Utilities CSS

Declaradas en `src/index.css` bajo `@layer utilities`. Son la única forma de aplicar estilos compuestos de la plataforma. **No replicar su lógica inline.**

### 5.1 `.glass-panel`

```css
.glass-panel {
  background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--color-industrial-border);
  border-radius: 1.5rem;   /* = 24px */
  position: relative;
  overflow: hidden;
  transition: all 0.3s ease;
}
```

**Regla:** Todo contenido dentro de un `.glass-panel` debe tener `position: relative; z-index: 1` (automático vía `glass-panel > *`).

### 5.2 `.glass-panel-danger`

```css
.glass-panel-danger {
  background: linear-gradient(135deg, rgba(239,68,68,0.1) 0%, rgba(239,68,68,0.02) 100%);
  border: 1px solid rgba(239, 68, 68, 0.2);
}
```

Variante del glass-panel para paneles en estado de alarma/crítico. Se combina encima de `.glass-panel` como modificador.

### 5.3 `.neon-cyan-glow`

```css
.neon-cyan-glow {
  filter: drop-shadow(0 0 8px rgba(34, 211, 238, 0.5));
}
```

Para líneas principales de gráficos y elementos SVG primarios.

### 5.4 `.neon-violet-glow`

```css
.neon-violet-glow {
  filter: drop-shadow(0 0 8px rgba(139, 92, 246, 0.5));
}
```

Para líneas secundarias de gráficos (producción, volumen).

### 5.5 `.rotor-glow`

```css
.rotor-glow {
  filter: drop-shadow(0 0 15px rgba(168, 85, 247, 0.4));
}
```

Para íconos de activos rotativos (compresores, mezcladores) en estado activo.

### 5.6 `.charcoal-gradient`

```css
.charcoal-gradient {
  background: radial-gradient(circle at top left, var(--color-industrial-hover), var(--color-industrial-bg));
}
```

Fondo alternativo para secciones que necesitan diferenciarse sutilmente del body sin usar un color diferente.

### 5.7 `.button-glow-bg`

```css
.button-glow-bg {
  position: relative;
  background: #151824;
  border: 1px solid rgba(255,255,255,0.1);
}
.button-glow-bg::before {
  content: "";
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 110%; height: 120%;
  background: radial-gradient(circle at center, rgba(139,92,246,0.5), rgba(0,229,255,0.3), transparent 70%);
  z-index: -1;
  filter: blur(15px);
  opacity: 0.8;
}
```

Para botones de acción primaria con brillo de fondo (ej. "Subir CSV", "Publicar", "Aplicar cambios").

### 5.8 `.text-gradient`

```css
.text-gradient {
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-image: linear-gradient(90deg, #A78BFA, var(--color-accent-cyan));
}
```

Solo para la palabra "HMI" en el branding del Topbar. Uso restringido — máximo una instancia por layout.

### 5.9 `.nav-link-gradient-underline`

```css
.nav-link-gradient-underline::after {
  content: '';
  position: absolute;
  bottom: -4px; left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg, #A78BFA, #22d3ee);
  border-radius: 2px;
}
```

Subrayado activo para nav links del Topbar. Solo el link activo lo recibe.

### 5.10 `.border-l-active`

```css
.border-l-active {
  border-left: 3px solid var(--color-accent-blue);
  position: relative;
}
```

Borde izquierdo de acento para listas o filas con dato activo resaltado.

---

## 6. Fondos y Superficies

### Jerarquía de profundidad

```
Nivel 0  →  Body global           →  --color-industrial-bg    (#05070a)
Nivel 1  →  Cards / Panels        →  --color-industrial-surface  (#0e1117)
Nivel 2  →  Hover interactivo     →  --color-industrial-hover   (#161b22)
Nivel 3  →  Glass overlay         →  glass-panel (gradient + blur)
```

### Fondos tintados para estados semánticos

Estos fondos se usan en cards de área y paneles de equipo que necesitan comunicar estado mediante tinte:

| Estado | Fondo base | Borde | Clase Tailwind equivalente |
|--------|-----------|-------|---------------------------|
| `running` / Normal | `#05130e` | `accent-green/30` | `bg-[#05130e] border-emerald-500/30` |
| `warning` | `#15100a` | `accent-amber/30` | `bg-[#15100a] border-amber-500/30` |
| `critical` | `#1a0b0f` | `accent-ruby/30` | `bg-[#1a0b0f] border-red-500/30` |
| `offline` / `idle` / `standby` | `#0e1117` | `industrial-border` | `bg-industrial-surface border-white/8` |
| `stale` | `#0b0e14` | `slate-700/30` | `bg-[#0b0e14] border-slate-700/30` |
| `unknown` / `no-data` | `#0e1117` | `slate-800/40` | `bg-industrial-surface border-slate-800/40` |

### Indicador lateral de estado (barra)

Para cards de área y alarmas, una barra rectangular izquierda refuerza el color semántico:

```html
<!-- Barra en cards de área (1.5px) -->
<div class="absolute left-0 top-0 bottom-0 w-1.5 rounded-l-3xl bg-accent-green"></div>

<!-- Barra en cards de alarma crítica (5px) -->
<div class="absolute left-0 top-0 bottom-0 w-[5px] bg-accent-ruby"></div>
```

---

## 7. Tipografía y Jerarquías de Texto

### 7.1 Tamaños y estilos por nivel

| Nivel | Descripción | Clases Tailwind | Ejemplo de uso |
|-------|-------------|-----------------|----------------|
| **H1 / Título de página** | Heading principal de cada vista | `text-5xl font-black tracking-tight` | "Visión General de Planta", "Comprimidora FETTE-2090" |
| **Nombre de equipo grande** | Heading de detalle de equipo | `text-4xl lg:text-5xl font-black tracking-tight` | "Comprimidora FETTE-2090" |
| **KPI principal** | Valor numérico de primera línea | `text-4xl lg:text-5xl font-black tracking-tighter` | `78.4`, `1,250`, `42.8` |
| **KPI unidad / sufijo** | Unidad inline con el KPI | `text-lg font-bold text-slate-400` | `%`, `RPM`, `kN`, `°C`, `MW/h` |
| **H2 / Subtítulo de sección** | Cabecera de sección dentro de vista | `text-xs font-black text-slate-400 uppercase tracking-[0.3em]` | "Estado por Áreas", "Critical Events" |
| **Label de card / widget** | Etiqueta superior de la card | `text-[10px] font-black uppercase tracking-[0.2em] text-slate-400` | "OEE Global", "Velocidad de Rotor", "Alarmas Activas" |
| **Dato secundario / contexto** | Subvalor dentro de la card | `text-[9px] font-bold uppercase tracking-widest text-slate-400` | "Límite: 45.0 °C", "+2.1% vs ayer", "Promedio Turno" |
| **Texto de body / descripción** | Texto narrativo en paneles de insight | `text-sm font-normal text-slate-300 leading-relaxed` | Descripción de eventos, notas del asistente |
| **Nav link activo (Topbar)** | Link de navegación seleccionado | `text-xs font-bold tracking-widest uppercase text-white` | "OVERVIEW" |
| **Nav link inactivo (Topbar)** | Link no seleccionado | `text-xs font-bold tracking-widest uppercase text-slate-500` | "DIAGNOSTICS", "LOGS" |
| **Nav item (Sidebar)** | Ítem de menú lateral | `text-sm font-medium` | "Visión General", "Alarmas" |
| **Branding Topbar** | Nombre de la aplicación | `text-xl font-extrabold tracking-tight uppercase` | "interfaz **HMI**" |
| **Metadata técnica** | Timestamps, códigos, IDs | `text-[9px] font-mono text-slate-500` | "ERR-CP-402", "2026-03-11 10:05" |
| **Badge / Tag** | Etiquetas de categoría o lote | `text-[10px] font-bold uppercase tracking-widest` | "RECIPE ASRP-500mg", "BATCH #BCTX-109" |

### 7.2 Reglas tipográficas

- **Nunca** usar `font-light` excepto en la palabra "HMI" del branding.
- **Siempre** aplicar `tracking-tight` o superior en headings (−0.025em mínimo).
- Los KPI numéricos usan `font-black` (900). Nunca menos de `font-bold` (700).
- El texto muted (`text-slate-400`) es el default para labels; el texto más claro está reservado para valores activos.

---

## 8. Spacing y Layout

### 8.1 Padding interno de componentes

| Componente | Padding |
|------------|---------|
| Cards KPI principales | `p-5` (20px) |
| Panel/card de equipo grande | `p-6` (24px) |
| Cards de área pequeñas | `p-4` (16px) |
| Topbar | `px-6 lg:px-10 py-5` |
| Sidebar — sección nav | `py-6 px-4` |
| Sidebar — items de nav | `px-3 py-2.5` |
| Contenido principal (content area) | `pt-[81px]` (compensa la Topbar fija) |

### 8.2 Gap entre elementos

| Contexto | Gap |
|----------|-----|
| Cards del mismo nivel (grid row) | `gap-5` (20px) |
| Elementos del mismo bloque (flex) | `gap-4` (16px) |
| Logo + nombre en Topbar | `gap-4` |
| Logo/búsqueda / nav en Topbar | `gap-12` |
| Nav links entre ellos (Topbar) | `gap-10` |
| Íconos de acción (Topbar) | `gap-4` |
| Ítems de sidebar | `space-y-2` (8px) |

### 8.3 Separación entre secciones

| Contexto | Clase |
|----------|-------|
| Entre secciones del Dashboard | `space-y-8` (32px) |
| Entre fila de KPIs y fila de estados | `pt-4` (16px título) |
| Entre chart y sección superior | `gap-5` o `mt-5` |

### 8.4 Grid de layout

| Vista | Columnas | Clases |
|-------|----------|--------|
| KPIs globales (Dashboard) | 4 cols en XL, 2 en MD, 1 en SM | `grid-cols-1 md:grid-cols-2 xl:grid-cols-4` |
| Cards de área | 4 cols en LG, 2 en MD | `grid-cols-1 md:grid-cols-2 lg:grid-cols-4` |
| Layout de detalle (chart + eventos) | 2/3 + 1/3 | CSS Grid o `flex gap-5` con `flex-[2]` + `flex-[1]` |
| KPIs de telemetría (detail page) | 4 cols en XL, 2 en MD | `grid-cols-2 xl:grid-cols-4` |

---

## 9. Radios, Bordes y Elevaciones

### 9.1 Border radius por contexto

| Elemento | Clase Tailwind | Valor |
|----------|---------------|-------|
| Cards y paneles principales | `rounded-3xl` | 24px |
| Input de búsqueda / badge | `rounded-2xl` | 16px |
| Logo del Topbar | `rounded-xl` | 12px |
| Ítems de Sidebar (nav) | `rounded-lg` | 8px |
| Cards de alarma inline | `rounded-lg` | 8px |
| Tooltip de charts | `rounded-md` (8px) | 8px |
| Dot / indicador de estado | `rounded-full` | 50% |
| Barra lateral de estado | Sin border-radius lateral (`rounded-l-3xl` opcional) | — |
| Botones de acción | `rounded-2xl` | 16px |

### 9.2 Grosor de borde

| Contexto | Valor |
|----------|-------|
| Bordes de cards / paneles | `border` (1px) |
| Barra lateral de estado en área | `w-1.5` (6px) |
| Barra lateral en alarma crítica | `w-[5px]` (5px) |
| `.border-l-active` | 3px sólido |
| Subrayado nav activo (CSS) | 2px |

### 9.3 Elevaciones / z-index

| Elemento | z-index |
|----------|---------|
| Topbar (fixed) | `z-50` |
| Modales y overlays | `z-40` (convención) |
| Tooltips y dropdowns | `z-30` (convención) |
| Contenido normal | `z-auto` |

---

## 10. Glows y Sombras

### 10.1 Glows de elementos de UI

```css
/* Logo del Topbar — glow cyan */
shadow-[0_0_20px_rgba(34,211,238,0.3)]

/* Dot de notificación en campana — glow rojo */
shadow-[0_0_8px_rgba(239,68,68,0.8)]

/* Punto rojo de alarma activa en panel */
shadow-[0_0_10px_rgba(239,68,68,0.5)]

/* Ícono activo en Sidebar — drop-shadow cyan */
drop-shadow-[0_0_8px_rgba(34,211,238,0.6)]
```

### 10.2 Glows de charts (filter CSS)

```css
.neon-cyan-glow   → filter: drop-shadow(0 0 8px  rgba(34,211,238,0.5))   /* Línea principal */
.neon-violet-glow → filter: drop-shadow(0 0 8px  rgba(139,92,246,0.5))   /* Línea secundaria */
.rotor-glow       → filter: drop-shadow(0 0 15px rgba(168,85,247,0.4))   /* Ícono rotativo */
```

### 10.3 Reglas de uso de glow

- ✅ Permitido: íconos activos, puntos de estado, líneas de gráficos, logo de branding.
- ❌ Prohibido: texto de cuerpo, fondos completos de cards, bordes de sección.
- La opacidad de los glows debe estar entre **0.3 y 0.6** como máximo.
- No apilar más de un glow en el mismo elemento.

---

## 11. Estados Visuales Semánticos

Esta es la tabla de verdad de los estados operativos del sistema.

| Estado | Código | Color principal | Fondo | Borde | Dot animado | Descripción |
|--------|--------|-----------------|-------|-------|-------------|-------------|
| `running` | 🟢 | `accent-green` `#10b981` | `#05130e` | `accent-green/30` | ✅ Sí (`pulse-slow`) | Equipo en producción nominal |
| `idle` | ⬜ | `industrial-muted` `#94a3b8` | `#0e1117` | `industrial-border` | ❌ No | Stand-by, detenido voluntariamente |
| `warning` | 🟡 | `accent-amber` `#f59e0b` | `#15100a` | `accent-amber/30` | ✅ Sí | Umbral próximo, temperatura alta |
| `critical` | 🔴 | `accent-ruby` `#ef4444` | `#1a0b0f` | `accent-ruby/30` | ✅ Sí (rápido) | Alarma activa, presión inestable |
| `offline` | ⚫ | `#4a5568` | `#0e1117` | `slate-700/20` | ❌ No | Sin señal confirmada |
| `stale` | 🔵 | `accent-blue` `#3b82f6` | `#0b0e14` | `blue-700/20` | ❌ No | Dato recibido pero desactualizado (timeout) |
| `maintenance` | 🟣 | `accent-purple` `#a855f7` | `#100a1a` | `purple-700/30` | ❌ No | Fuera de servicio por mantenimiento programado |
| `unknown` | ⬜ | `#64748b` | `#0e1117` | `slate-800/30` | ❌ No | Estado desconocido, sin info del PLC |
| `no-data` | ⬜ | `#475569` | `#0e1117` | `slate-800/20` | ❌ No | Punto de datos sin valor disponible |
| `loading` | 🔵 | `accent-blue` | `#0e1117` | `blue-700/20` | ⏳ Spinner | Dato en tránsito, primera carga |
| `error` | 🔴 | `accent-ruby` | `#1a0b0f` | `accent-ruby/30` | ❌ No (estático) | Error de comunicación o fallo de servicio |

### 11.1 Representación visual del estado

Cada estado debe expresarse con **al menos dos** de los siguientes recursos visuales:

1. **Color del borde** de la card o panel
2. **Color del dot indicator** (esquina superior derecha o izquierda)
3. **Fondo tintado** de la card
4. **Barra lateral izquierda** (para cards de área y equipo)
5. **Texto del label de estado** dentro de la card
6. **Animación** (solo para estados que requieren acción inmediata)

---

## 12. Reglas de Hover / Focus / Active / Selected / Disabled

### Cards y paneles

| Superficie | Estado normal | Estado hover | Estado selected/active |
|------------|---------------|--------------|----------------------|
| Card KPI (`glass-panel`) | `border-industrial-border` | `hover:border-accent-cyan` (o variante semántica) | No aplica |
| Card de área | Borde semántico fijo | `hover:brightness-110` | Borde semántico siempre visible |
| Panel de alarma | Borde semántico fijo | `hover:bg-industrial-hover` (leve) | No aplica |

### Navegación

| Elemento | Inactivo | Hover | Activo |
|----------|----------|-------|--------|
| Nav link (Topbar) | `text-slate-500` | `hover:text-white transition-colors` | `text-white nav-link-gradient-underline` |
| Nav item (Sidebar) | `text-industrial-muted border-transparent` | `hover:bg-industrial-hover hover:text-industrial-text` | `bg-white/3 border-industrial-border` + glow ícono |

### Botones y acciones

| Estado | Clase |
|--------|-------|
| Normal | `bg-white/5 border border-white/10 text-slate-400` |
| Hover | `hover:text-white hover:bg-white/10 transition-all` |
| Active | `active:scale-95` |
| Pressed (CTA) | `hover:scale-105 active:scale-95 transition-transform` |
| Disabled | `opacity-40 cursor-not-allowed pointer-events-none` |

### Focus (accesibilidad)

- Todo elemento interactivo debe tener `focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1 focus-visible:ring-offset-industrial-surface`.
- Los inputs de búsqueda usan `focus:ring-0 focus:outline-none` (el estilo de foco lo provee el contenedor).

---

## 13. Topbar

### Especificaciones estructurales

```
Posición:        fixed top-0 left-0 right-0 z-50
Altura total:    ~81px  (py-5 = 20px top + 20px bottom + contenido ~41px)
Fondo:           backdrop-blur-xl bg-black/40
Borde inferior:  border-b border-white/5
Compensación:    El layout principal usa pt-[81px] para no quedar debajo
```

### Zona izquierda

| Elemento | Especificación |
|----------|---------------|
| Logo | `size-10` (40×40px), `rounded-xl`, gradiente `from-[#A78BFA] to-[#22d3ee]`, ícono `Activity` size 22, shadow glow cyan |
| Nombre app | `text-xl font-extrabold tracking-tight uppercase` — "interfaz" en blanco + "HMI" con `.text-gradient` |
| Separación logo→nombre | `gap-4` |
| Input de búsqueda | `bg-white/5 border border-white/5 rounded-2xl px-4 py-2 w-80`, placeholder `text-slate-600` |
| Separación branding→búsqueda | `gap-12` |

### Zona derecha

| Elemento | Especificación |
|----------|---------------|
| Nav links | `text-xs font-bold tracking-widest uppercase`, gap `gap-10`, activo: `text-white nav-link-gradient-underline`, inactivo: `text-slate-500 hover:text-white transition-colors` |
| Botón campana | `size-11 rounded-2xl bg-white/5 border border-white/10 text-slate-400 hover:text-white` |
| Dot de notificación | `size-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)] border border-black/40` en `-top-1 -right-1` |
| Avatar | `size-11 rounded-2xl bg-slate-800 border border-white/10 p-0.5`, ícono `User` size 20 |
| Separación acciones | `gap-4` |
| Separación nav→acciones | `gap-8` |

---

## 14. Sidebar

### Especificaciones estructurales

```
Ancho:          w-64 (256px) — fijo, no colapsable (v1)
Alto:           h-full (100% del viewport, bajo la Topbar)
Fondo:          bg-industrial-bg (#05070a)
Borde derecho:  border-r border-[var(--color-industrial-border)]
Visibilidad:    hidden md:flex (oculto en mobile)
```

### Sección de navegación

```
Padding:         py-6 px-4
Gap entre items: space-y-2 (8px)
```

**Item de nav inactivo:**
```
flex items-center gap-3 px-3 py-2.5 rounded-lg
text-industrial-muted border border-transparent
hover:bg-industrial-hover hover:text-industrial-text
transition-all duration-200
```

**Item de nav activo:**
```
flex items-center gap-3 px-3 py-2.5 rounded-lg
bg-[rgba(255,255,255,0.03)] border border-industrial-border shadow-sm
text-white
Ícono: stroke="url(#icon-gradient)" drop-shadow-[0_0_8px_rgba(34,211,238,0.6)]
```

### Sección inferior (Configuración)

```
Padding:       p-4
Borde:         border-t border-[var(--color-industrial-border)]
Mismo estilo inactivo que ítems de nav
```

### Íconos usados (Lucide React)

| Ítem | Ícono Lucide |
|------|-------------|
| Visión General | `Home` |
| Explorador | `FolderTree` |
| Tendencias | `Activity` |
| Alarmas | `AlertTriangle` |
| Trazabilidad | `Box` |
| Configuración | `Settings` |

---

## 15. Cards y Widgets — Anatomía

### 15.1 KPI Card estándar (glass-panel)

```
┌──────────────────────────────────────────┐
│ [LABEL 10px UPPERCASE]         [🔵 ícono]│  ← header: label izquierda + ícono acento
│                                          │
│         78.4  %                          │  ← KPI: text-4xl/5xl font-black + unidad text-lg
│                                          │
│ +2.1% vs ayer              ESTABLE       │  ← footer: contexto + badge semántico
└──────────────────────────────────────────┘
  padding: p-5 | radius: rounded-3xl | clase: glass-panel
```

**Ícono de card:** `size={24} strokeWidth={2}` con color de acento correspondiente. Flotan a la esquina superior derecha (`justify-between`).

### 15.1.1 Convención Visual de Jerarquía y Color (KPIs)

1. **Título del Widget:** 
   - Mantiene color neutro fijo (`text-slate-400` / `#94a3b8`).
   - Actúa como etiqueta inmutable sin competir con el valor principal. **No** usa colores semánticos.
2. **Subtexto Aclaratorio:** 
   - Asume el rol expresivo cromático secundario.
   - *Modo Estático (Default):* Usa el color editorial Purple (`accent-purple` / `#a855f7`).
   - *Modo Color Dinámico (Thresholds ON):* Adopta el color semántico de su estado actual:
     - **Normal:** Verde (`accent-green` / `#10b981`)
     - **Alerta (Warning):** Ámbar (`accent-amber` / `#f59e0b`)
     - **Crítico (Critical):** Ruby (`accent-ruby` / `#ef4444`)
3. **Ícono del Widget:** 
   - Adopta **exactamente** el mismo color semántico que el subtexto.

### 15.1.2 Gradientes Dinámicos para Gráficos y Barras de Progreso

Para medidores circulares o barras horizontales con **Color Dinámico Activado**:
- **Normal:** Transición suave de **Cyan** (`#22d3ee` - color teal/cian vibrante) a **Verde** (`#10b981`).
- **Alerta (Warning):** Transición de **Ámbar** (`#f59e0b`) a **Ruby** (`#ef4444`).
- **Crítico (Critical):** Rojo sólido **Ruby** (`#ef4444`).

Para indicadores con **Color Dinámico Desactivado**:
- Gradiente premium por defecto desde **Azul** (`#3b82f6`) hacia **Púrpura** (`#a855f7`).

**Uso del efecto Glow (`drop-shadow`):**
Acompaña a la barra css o anillo SVG con un difuminado (`drop-shadow(0 0 15px rgba(Color, 0.5))`). Se utiliza exclusivamente para resaltar el trazo de progreso activo y destacar el nivel de urgencia o "salud" del indicador, aportando profundidad luminosa al widget.

### 15.2 Card de área de estado

```
┌──────────────────────────────────────────┐
│▌ [STATUS 10px]                      🟢 ● │  ← barra izquierda + label status + dot animado
│                                          │
│   COMPRESIÓN                             │  ← nombre del área (text-xl font-black uppercase)
│   Equipos: 4/5              Lote: BCTX   │  ← metadata (text-9px)
└──────────────────────────────────────────┘
  padding: p-4 | radius: rounded-3xl | fondo tintado semántico
```

### 15.3 Card de telemetría de equipo (detalle)

```
┌──────────────────────────────────────────┐
│ [LABEL MÉTRICA]                   [ícono]│
│                                          │
│         1,250  RPM                       │  ← KPI grande
│                                          │
│  ████████████░░░░  (barra progreso)      │  ← progress bar con color semántico
└──────────────────────────────────────────┘
  padding: p-5 | radius: rounded-3xl | glass-panel o fondo tintado si hay alerta
```

### 15.4 Card de alarma / evento crítico

```
┌──────────────────────────────────────────┐
│▌ CRÍTICA • HACE 5 MIN                    │  ← barra roja 5px + severity + timestamp
│  PRESIÓN DE COMPACTACIÓN INESTABLE       │  ← título (text-sm font-bold)
│  Código: ERR-CP-402       [Acknowledge]  │  ← código + acción
└──────────────────────────────────────────┘
  background: bg-[#1a0b0f] | borde: border-accent-ruby/30 | radius: rounded-lg
```

### 15.5 Panel de gráfico (glass-panel)

```
Header: 
  - Título izquierda: text-xs font-black uppercase tracking-[0.3em] text-slate-400
  - Dot animado: bg-accent-cyan animate-pulse-slow
  - Timestamp derecha: text-xs text-slate-500

Chart area:
  - ResponsiveContainer width="100%" height={280}
  - Sin borde ni fondo adicional (hereda el glass-panel)

Leyenda (si aplica):
  - Derecha del header: dots de color + labels text-xs text-slate-400
```

### 15.6 Tamaños estándar de componentes

| Componente | Dimensión estándar |
|------------|-------------------|
| Botones de acción circulares/cuadrados | `size-11` (44×44px) |
| Logo / avatar cuadrado | `size-10` (40×40px) |
| Dot de estado inline | `size-2.5` (10×10px) |
| Dot de notificación (badge) | `size-2.5` (10×10px) |
| Input de búsqueda | `w-80` (320px) |
| Sidebar | `w-64` (256px) |
| Ícono estándar en card | `size={24}` |
| Ícono en sidebar/topbar | `size={20}` |
| Ícono en logo topbar | `size={22}` |

---

## 16. Gráficos (Recharts)

### 16.1 Configuración base de AreaChart / LineChart

```tsx
<CartesianGrid
  strokeDasharray="3 3"
  stroke="rgba(255,255,255,0.05)"
  vertical={false}
/>
<XAxis
  tick={{ fill: '#8F9BB3', fontSize: 11 }}
  tickLine={false}
  axisLine={false}
/>
<YAxis
  tick={{ fill: '#8F9BB3', fontSize: 11 }}
  tickLine={false}
  axisLine={false}
/>
<Tooltip
  contentStyle={{
    background: '#0e1117',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    color: '#f1f5f9',
    fontSize: '12px',
  }}
/>
```

### 16.2 Colores de series

| Serie | Stroke | Stroke width | Fill gradient | Clase glow |
|-------|--------|-------------|---------------|-----------|
| Principal (OEE / métrica 1) | `#22d3ee` / `#00BEFF` | 3 | `rgba(0,190,255,0.3)` → `rgba(0,190,255,0)` | `neon-cyan-glow` |
| Secundaria (Producción / métrica 2) | `#a855f7` / `#B258FF` | 3 | `rgba(178,88,255,0.3)` → `rgba(178,88,255,0)` | `neon-violet-glow` |

### 16.3 Configuración de puntos activos

```tsx
activeDot={{ r: 6, stroke: '#0e1117', strokeWidth: 2 }}
```

### 16.4 Gradiente de relleno (LinearGradient)

```tsx
<defs>
  <linearGradient id="colorPrimary" x1="0" y1="0" x2="0" y2="1">
    <stop offset="5%"  stopColor="#00BEFF" stopOpacity={0.3} />
    <stop offset="95%" stopColor="#00BEFF" stopOpacity={0}   />
  </linearGradient>
</defs>
```

### 16.5 Reglas de charts

- **Grid:** Solo líneas horizontales. `vertical={false}` siempre.
- **Ejes:** Sin `axisLine`, sin `tickLine`. Color de ticks: `#8F9BB3`, fontSize 11.
- **Tooltip:** Background `#0e1117`, border `rgba(255,255,255,0.08)`, borderRadius 8px.
- **StrokeWidth:** 3px para líneas principales. No usar valores menores a 2.
- **Gradient fill:** Siempre de opacidad 0.3 arriba a 0 abajo. Nunca fill sólido.
- **Glow:** Aplicar clase `.neon-cyan-glow` o `.neon-violet-glow` al contenedor del path/area.
- **ResponsiveContainer:** `width="100%"`, height fijo por contexto (generalmente 280px en trend principal).

---

## 17. Iconografía

### 17.1 Librería

**Lucide React** es la única fuente de íconos del sistema. No se admiten otras librerías de íconos.

### 17.2 Tamaños estándar

| Contexto | size | strokeWidth |
|----------|------|-------------|
| Cards y widgets de datos | `{24}` | `{1.5}` |
| Sidebar (nav items) | `{20}` | `{1.5}` |
| Topbar (acciones) | `{20}` | `{1.5}` |
| Logo branding | `{22}` | `{1.5}` |
| Ícono pequeño inline (badge/label) | `{16}` | `{2}` |

### 17.3 Apariencia

- **strokeWidth 1.5:** Íconos decorativos y de estructura. Da apariencia liviana y moderna.
- **strokeWidth 2:** Íconos de acción, atención o alerta. Mayor peso visual.
- **Opacidad en icons decorativos:** `opacity-80` cuando el ícono es contextual (no interactivo).
- **Ícono activo (sidebar):** `stroke="url(#icon-gradient)"` + `drop-shadow-[0_0_8px_rgba(34,211,238,0.6)]`.

### 17.4 Mapa de íconos del sistema (v1)

| Función | Ícono Lucide |
|---------|-------------|
| Dashboard / Visión general | `Home` |
| Explorador de activos | `FolderTree` |
| Tendencias / Analítica | `Activity` |
| Alarmas | `AlertTriangle` |
| Trazabilidad | `Box` |
| Configuración | `Settings` |
| Logo de la app | `Activity` |
| Búsqueda | `Search` |
| Notificaciones | `Bell` |
| Usuario / Perfil | `User` |
| Producción / Turno | `Package` (convención) |
| Energía / Consumo | `Zap` |
| OEE / Eficiencia | `Gauge` (convención) |

---

## 18. Principios de Composición Visual para Dashboards

### 18.1 Jerarquía de lectura

Todo dashboard debe seguir el orden de escaneo visual natural:

```
1. Topbar      →  Contexto global, branding, búsqueda, alertas pendientes
2. Sidebar     →  Orientación en el sistema, vista activa
3. KPI Row     →  Estado global de planta de un solo vistazo (L1)
4. Status Row  →  Estado por área / equipo / sectores (L2)
5. Chart Area  →  Histórico, tendencias, análisis temporal (L3)
```

### 18.2 Reglas de composición

| Regla | Descripción |
|-------|-------------|
| **Máximo 4 KPIs en L1** | La fila KPI nunca supera 4 elementos en desktop. |
| **Un CTA visible por vista** | No más de un botón de acción primaria visible sin scroll. |
| **Color solo para semántica** | No usar acentos sin significado operativo. |
| **Sin elementos mudos** | Todo espacio en el grid debe tener contenido o estado explícito de vacío. |
| **Densidad media-alta** | Padding generoso (`p-5`) pero sin espacios blancos improductivos. |
| **Respiración entre secciones** | `space-y-8` (32px) entre bloques de secciones distintas. |
| **Grid consistente** | No mezclar grids de 3 y 4 columnas en el mismo nivel del layout. |
| **Charts siempre en glass-panel** | Nunca el gráfico flota sin un contenedor con borde y fondo definido. |

### 18.3 Anti-patrones a evitar

- ❌ Cards sin label de identificación
- ❌ Fondo blanco o claro en cualquier superficie
- ❌ Uso de rojo/amber sin que haya una condición operativa que lo justifique
- ❌ Texto sin jerarquía (todos los textos del mismo tamaño y peso)
- ❌ Glow aplicado a fondos completos
- ❌ Más de dos colores de acento coexistiendo en la misma card
- ❌ Estado "vacío" sin indicación visual del motivo (no-data, loading, error)

---

## 19. Clasificación de valores: tokens, utilities y hardcoded prohibidos

### 19.1 Tokens oficiales (usar siempre)

Definidos en `src/index.css @theme {}`. Uso obligatorio vía clase Tailwind o `var()`:

```
--color-industrial-bg
--color-industrial-surface
--color-industrial-hover
--color-industrial-border
--color-industrial-text
--color-industrial-muted
--color-accent-cyan
--color-accent-green
--color-accent-amber
--color-accent-ruby
--color-accent-purple
--color-accent-pink
--color-accent-blue
--color-accent-blue-glow
--font-sans
--font-mono
--animate-pulse-slow
```

### 19.2 Utilities oficiales (usar siempre, no replicar inline)

Definidas en `src/index.css @layer utilities`:

```
.glass-panel
.glass-panel-danger
.neon-cyan-glow
.neon-violet-glow
.rotor-glow
.charcoal-gradient
.button-glow-bg
.text-gradient
.nav-link-gradient-underline
.border-l-active
```

### 19.3 Valores numéricos permitidos hardcoded (casos especiales justificados)

| Valor | Justificación |
|-------|---------------|
| `#05130e`, `#15100a`, `#1a0b0f`, `#0b0e14` | Fondos tintados semánticos — no tienen token porque son derivados de los acentos con opacidad |
| `#8F9BB3` | Color de ejes de charts — valor técnico específico de Recharts |
| `#151824` | Fondo base de `.button-glow-bg` — valor interno de la utilidad |
| `pt-[81px]` | Compensación exacta de la altura del Topbar — valor funcional |
| `tracking-[0.3em]`, `tracking-[0.2em]` | Espaciado de letras especial para labels de sección — no disponible en escala Tailwind estándar |

### 19.4 Valores prohibidos como hardcoded

Se considera un error de diseño introducir cualquiera de los siguientes directamente en JSX o CSS sin pasar por token o utility:

- ❌ Colores hexadecimales de paleta (`#22d3ee`, `#ef4444`, etc.) fuera de los archivos de token/utility
- ❌ Valores de `rgba()` para colores semánticos inline en componentes
- ❌ `backdrop-blur` o `background: linear-gradient(...)` para glassmorphism — usar `.glass-panel`
- ❌ `filter: drop-shadow(...)` inline — usar `.neon-cyan-glow` o `.neon-violet-glow`
- ❌ Fuentes distintas de `--font-sans` o `--font-mono`

---

*Documento mantenido por el equipo de diseño y arquitectura del proyecto.*  
*Versión 1.0.0 — Baseline validada sobre implementación real de la UI.*  
*Próxima revisión programada: Fase 2 del roadmap (Modo Administrador).*
