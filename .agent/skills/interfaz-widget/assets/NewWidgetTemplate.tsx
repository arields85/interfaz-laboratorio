import type { WidgetConfig } from '../../../../hmi-app/src/domain/admin.types';
import type { EquipmentSummary } from '../../../../hmi-app/src/domain/equipment.types';
import WidgetCenteredContentLayout from '../../../../hmi-app/src/components/ui/WidgetCenteredContentLayout';
import WidgetHeader from '../../../../hmi-app/src/components/ui/WidgetHeader';

interface NewWidgetTemplateProps {
  widget: WidgetConfig;
  equipmentMap: Map<string, EquipmentSummary>;
  isLoadingData?: boolean;
  className?: string;
}

/**
 * Template base para widgets nuevos.
 *
 * Reglas:
 * - usar `glass-panel`
 * - usar `WidgetHeader` si hay encabezado
 * - `subtitle` en header / `subtext` en footer
 * - no inventar focus/hover actions propios
 * - `navigationTargetDashboardId` ya viene heredado desde `WidgetConfigBase`
 * - NO agregar `onClick` de navegación en el renderer: el wrapper compartido de `WidgetRenderer` lo resuelve en viewer
 * - el PropertyDock compartido agrega `Navegación` al final del panel automáticamente
 */
export default function NewWidgetTemplate({
  widget,
  equipmentMap: _equipmentMap,
  isLoadingData = false,
  className,
}: NewWidgetTemplateProps) {
  // Elegí el patrón correcto para tu caso:
  // - false => flujo natural (header + body + footer)
  // - true  => contenido centrado respecto de toda la superficie del widget
  const useOpticalCenterLayout = false;

  if (isLoadingData) {
    return (
      <div className={`glass-panel group p-5 w-full h-full flex items-center justify-center ${className ?? ''}`}>
        <div className="animate-pulse text-industrial-muted text-xs font-bold uppercase tracking-widest">
          Cargando datos...
        </div>
      </div>
    );
  }

  return (
    <div className={`glass-panel group p-5 w-full h-full flex flex-col ${className ?? ''}`}>
      {useOpticalCenterLayout ? (
        <WidgetCenteredContentLayout
          header={(
            <WidgetHeader
              title={widget.title ?? 'Nuevo widget'}
              // iconPosition="left"  ← descomentar si el ícono debe preceder al título
            />
          )}
        >
          <>
            {/* Contenido principal centrado en la superficie completa */}
          </>
        </WidgetCenteredContentLayout>
      ) : (
        <>
          <WidgetHeader
            title={widget.title ?? 'Nuevo widget'}
            // iconPosition="left"  ← descomentar si el ícono debe preceder al título
            className="mb-2 shrink-0"
          />

          <div className="flex-1 min-h-0">
            {/* Contenido principal del widget */}
          </div>
        </>
      )}

      {/* Footer opcional: usar subtext abajo, NO en el header */}
      {/* <div className="mt-3 text-[10px] font-bold uppercase tracking-widest text-industrial-muted"> */}
      {/*   {displayOptions?.subtext} */}
      {/* </div> */}

      {/* Patrón C — Controles flotantes (overlay):
          Si el widget tiene controles interactivos (selectores, toggles),
          posicionarlos como overlay absolute FUERA del WidgetHeader:

          <div className="absolute right-5 top-5 z-10 flex flex-col items-end gap-2">
              {controls}
          </div>

          NO usar WidgetHeader.trailing para bloques multi-fila.
          Ver ProduccionHistoricaWidget como referencia. */}
    </div>
  );
}
