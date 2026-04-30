# Proposal: hmi-focus-resume-layout-flash

## Intent
Eliminar el flash esporádico de layout/ tipografía malformados al volver de otra pestaña o restaurar la ventana, extendiendo la arquitectura de shield root-owned ya aprobada sin introducir hacks por widget ni romper el HMI read-only.

## Scope

### In Scope
- Extender el shield de arranque/recarga para cubrir focus/visibility resume cuando la UI todavía no recuperó tipografías, shader y layout estables.
- Alinear la readiness del shield con las fuentes/tokens tipográficos reales del HMI.
- Endurecer la medición compartida de canvas/layout para ignorar tamaños transitorios inválidos antes de exponer métricas a builder/viewer.
- Agregar tests de hooks/utilidades para el ciclo de resume y el filtrado de mediciones inválidas.

### Out of Scope
- Cambios de producto, widgets nuevos o parches específicos por renderer.
- Cambios al policy actual de aspect-fit / letterboxing del canvas; este change solo endurece la primitive compartida frente a mediciones transitorias inválidas.
- Escrituras a planta, nuevos endpoints mutativos o cambios al loader typewriter final.

## Capabilities

### New Capabilities
- `runtime-boot-shield`: shield root-owned reutilizable para boot, reload y resume sin exponer frames intermedios corruptos.

### Modified Capabilities
- `canvas-bounds`: la medición compartida debe resistir resize/restore transitorios sin publicar dimensiones cero o inválidas que deformen el layout.

## Approach
Reusar `index.html` + `useBootShield` + `useReloadShield` como único punto de control visual. El cambio agrega un flujo de resume shielded basado en `visibilitychange`/focus, reutiliza los mismos criterios de salida del shield y reemplaza checks de fuentes legacy por checks alineados al typography stack real. En paralelo, `useCanvasReference` conservará la última métrica válida hasta recibir una medición estable, evitando colapsos de una frame en builder/viewer.

## Affected Areas
| Area | Impact | Description |
|------|--------|-------------|
| `openspec/changes/hmi-focus-resume-layout-flash/proposal.md` | New | Propuesta del cambio |
| `hmi-app/index.html` | Modified | Punto root-owned del shield |
| `hmi-app/src/hooks/useBootShield.ts` | Modified | Readiness y hide/show en resume |
| `hmi-app/src/hooks/useReloadShield.ts` | Modified | Integración con ciclo compartido del shield |
| `hmi-app/src/utils/useCanvasReference.ts` | Modified | Filtro de métricas transitorias inválidas |
| `hmi-app/src/hooks/useBootShield.test.tsx` | Modified | Casos boot/resume |
| `hmi-app/src/utils/useCanvasReference.test.tsx` | Modified | Casos ResizeObserver inválidos |

## Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Shield demasiado conservador y visible de más | Med | Reusar timeout/min visible existentes y cubrir con tests |
| Regresión entre builder y viewer | Med | Endurecer solo la primitive compartida de métricas |

## Rollback Plan
Revertir el flujo de resume del shield y el filtro de métricas, conservando intacta la solución #1088 de boot/reload y el loader final.

## Dependencies
- Restricción arquitectónica: respetar la solución final #1088.

## Success Criteria
- [ ] Al restaurar foco/ventana no aparece flash visible de layout o tipografía corruptos.
- [ ] El shield sigue siendo root-owned, mantiene el loader actual y no agrega hacks por widget.
- [ ] Builder y viewer no publican métricas transitorias inválidas durante resume/resize abrupto.
