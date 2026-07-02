---
name: interfaz-widget
description: >
  Crea widgets nuevos para Interfaz-Laboratorio reutilizando el sistema visual y estructural existente.
  Trigger: cuando se agregue un widget nuevo, un renderer nuevo, un widget del dashboard o una variante de widget.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

- Cuando se cree un widget nuevo en `hmi-app/src/widgets/renderers/`
- Cuando se agregue un tipo nuevo al dashboard builder
- Cuando un widget deba soportar grid, header o ambos

## Critical Patterns

- Usar `glass-panel` como shell visual base.
- Si el widget tiene encabezado, usar `hmi-app/src/components/ui/WidgetHeader.tsx`.
- `subtitle` = header, `subtext` = footer. Nunca mezclar.
- No crear focus rings ni hover actions custom; reutilizar primitives del sistema.
- Registrar el renderer en `hmi-app/src/widgets/WidgetRenderer.tsx`.
- Tipar `displayOptions` en `hmi-app/src/domain/admin.types.ts`.
- Exponer configuración en admin solo si tiene sentido para ese tipo de widget.
- No hardcodear colores ni fuentes; usar tokens de `hmi-app/src/index.css`.
- Solo Lucide React para íconos.
- Incluir clase `group` en `glass-panel` para que funcionen las transiciones hover de `WidgetHeader`.
- `WidgetHeader` soporta `iconPosition: 'left' | 'right'` (default `'right'`).
- Para widgets con charts: usar primitives `ChartTooltip` + `ChartHoverLayer`, NO Recharts tooltip/hover.
- Helpers matemáticos compartidos en `hmi-app/src/utils/chartHelpers.ts` — importar, no duplicar.
- Estados runtime/fallback por defecto con `hmi-app/src/components/ui/WidgetRuntimeState.tsx`.

## Decision Table

| Necesidad | Patrón correcto |
|---|---|
| Header de widget | `WidgetHeader` |
| Acciones hover en grid/header | `WidgetHoverActions` |
| Foco en grid | `GridSelectionFrame` |
| Foco en header | `HeaderSelectionFrame` |
| Tooltip de chart | `ChartTooltip` |
| Hover layer SVG de chart | `ChartHoverLayer` |
| Math helpers SVG (smoothPath, etc.) | `utils/chartHelpers.ts` |
| Runtime/fallback loading-empty-error | `WidgetRuntimeState` |
| Controles flotantes sobre header | Overlay `absolute` (Patrón C) |
| Ícono a la izquierda del título | `WidgetHeader iconPosition="left"` |
| Dispatcher del renderer | `WidgetRenderer.tsx` |
| Template base | `assets/NewWidgetTemplate.tsx` |

## Runtime State Rule

- Todo widget nuevo usa `WidgetRuntimeState` por defecto para overlays runtime/fallback.
- Estados canónicos: `loading` / `preparing` / `layout` / `chart-not-ready` → `Cargando_`; `disconnected` → `Sin conexión`; `error` → `No se pudieron cargar los datos`; `invalid-config` → `Configuración incompleta`; `empty` → `Sin datos`; `empty-comparable` → `Sin datos comparables`; `stale` → `Dato desactualizado`.
- Si necesitás copy puntual del dominio, usar `labelOverride`; NO rehacer la tarjeta/overlay.
- NO hacer `Cargando datos...`, NO usar card rica con ícono + mensaje para runtime/fallback, NO mostrar errores raw del backend, NO poner `--` arriba de la leyenda y NO usar leyendas uppercase.
- Excepciones: estados operacionales/de dominio no se reemplazan por la primitive. `KpiWidget` y `MetricWidget` siguen excluidos salvo cambio de dirección de producto.

## Code Examples

```tsx
import WidgetHeader from '../../../hmi-app/src/components/ui/WidgetHeader';

// El widget real debe seguir el template del asset.
```

## Commands

```bash
# Registrar el renderer nuevo
# 1. Crear archivo en hmi-app/src/widgets/renderers/
# 2. Actualizar hmi-app/src/widgets/WidgetRenderer.tsx
# 3. Actualizar hmi-app/src/domain/admin.types.ts
```

## Resources

- **Template**: See [assets/NewWidgetTemplate.tsx](assets/NewWidgetTemplate.tsx)
- **Documentation**: See [references/widget-authoring.md](references/widget-authoring.md)
