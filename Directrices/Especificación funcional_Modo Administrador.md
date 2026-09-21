# Especificación funcional — Modo Administrador
## Plataforma HMI/Observabilidad Industrial — Builder de estructura, dashboards y bindings

> **Aviso histórico — no normativo.**
> Este documento es un antecedente histórico del proyecto **interfaz HMI**. Registra decisiones de una etapa anterior del proyecto y puede contener información obsoleta o superada. No es fuente de requisitos ni de verdad de implementación vigente.
> Para el estado actual, consultá [`../AGENTS.md`](../AGENTS.md) y la documentación activa en `../docs/`.

---

## 0. Propósito

Este documento define la especificación funcional del **Modo Administrador** de la plataforma HMI/Observabilidad Industrial.

El Modo Administrador es la capa del sistema que permite a usuarios con permisos elevados:

- construir y mantener la **jerarquía de planta**;
- crear, editar, duplicar y publicar **dashboards**;
- agregar, configurar y organizar **widgets**;
- vincular widgets a **variables reales** o **valores simulados**;
- reutilizar dashboards mediante **duplicación** o **templates**;
- asignar dashboards a nodos jerárquicos y equipos;
- gobernar la estructura visual del sistema sin depender de desarrollo a medida para cada pantalla.

Esta especificación asume que la plataforma es **read-only respecto a planta**.  
Por lo tanto, el Modo Administrador no configura acciones de control ni escritura sobre equipos; solo modela estructura, visualización, simulación y bindings de lectura.

---

## 1. Objetivos del Modo Administrador

El Modo Administrador debe permitir:

1. construir una jerarquía editable tipo árbol, similar a carpetas y archivos;
2. crear dashboards completamente configurables a partir de widgets reutilizables;
3. decidir qué información se muestra, cómo se muestra y de dónde proviene;
4. permitir valores reales o simulados según el contexto de uso;
5. reutilizar configuraciones mediante duplicación y templates;
6. mantener el sistema ordenado, versionable y escalable;
7. desacoplar la construcción visual del sistema del desarrollo de código.

---

## 2. Principios funcionales

### 2.1 Libertad gobernada
El administrador debe tener amplia capacidad de configuración, pero dentro de un sistema estructurado, tipado y consistente.

No se busca libertad caótica tipo editor totalmente libre, sino un **builder potente pero gobernado**.

### 2.2 Reutilización por diseño
Todo lo que el administrador construya debería, cuando sea posible, poder:
- duplicarse;
- reutilizarse;
- convertirse en template;
- reasignarse a otros equipos o nodos.

### 2.3 Separación entre estructura, dashboard y binding
El sistema debe distinguir claramente entre:
- la **jerarquía** donde viven los elementos;
- el **dashboard** como composición visual;
- el **binding** como vínculo entre widget y fuente de dato.

### 2.4 Modo real y modo simulado
Los widgets deben poder trabajar con:
- **variables reales** del sistema;
- **valores simulados** definidos administrativamente.

### 2.5 Publicación controlada
Las configuraciones del administrador no deberían impactar automáticamente el runtime final sin algún modelo de guardado/publicación.

---

## 3. Alcance funcional

El Modo Administrador cubre las siguientes áreas:

- **Editor de jerarquía**
- **Gestor de dashboards**
- **Editor visual de dashboards**
- **Gestor de widgets**
- **Gestor de bindings**
- **Gestor de templates**
- **Gestor de publicación/versionado**
- **Asignación de dashboards a nodos/equipos**
- **Soporte para simulación de datos**

No forma parte de este alcance:
- control de proceso;
- escritura sobre PLCs o equipos;
- automatismos de actuación;
- comandos;
- setpoints;
- lógicas de intervención física.

---

## 4. Roles funcionales

## 4.1 Administrador absoluto
Usuario con capacidad total para:
- crear y modificar jerarquías;
- crear y publicar dashboards;
- crear templates;
- configurar bindings;
- usar variables simuladas;
- duplicar y reasignar pantallas;
- modificar la estructura global del sistema.

## 4.2 Administrador editor
Usuario con capacidad de edición sobre dashboards y estructura, pero con restricciones opcionales sobre publicación.

## 4.3 Revisor/publicador
Usuario que puede aprobar, publicar o revertir configuraciones.

## 4.4 Usuario final
No participa del Modo Administrador. Solo consume dashboards publicados.

---

## 5. Módulos funcionales del Modo Administrador

El Modo Administrador debe dividirse funcionalmente en los siguientes módulos:

1. **Editor de jerarquía**
2. **Gestor de dashboards**
3. **Editor visual de dashboard**
4. **Configurador de widgets**
5. **Editor de bindings**
6. **Gestor de templates**
7. **Gestor de publicación**
8. **Biblioteca de elementos reutilizables**

---

## 6. Editor de jerarquía

## 6.1 Objetivo
Permitir al administrador construir el árbol jerárquico del sistema como si se tratara de una estructura de carpetas y archivos.

## 6.2 Ejemplos de jerarquía
El sistema debe soportar estructuras del tipo:

- Planta
  - Área
    - Sector
      - Línea
        - Box
          - Equipo

o bien cualquier otra variante equivalente definida por el administrador.

## 6.3 Tipos de nodo
El sistema debe permitir nodos de al menos los siguientes tipos:

- `plant`
- `area`
- `sector`
- `line`
- `cell`
- `box`
- `equipment`
- `folder`
- `group`

El sistema puede permitir tipos adicionales configurables.

## 6.4 Operaciones soportadas
El administrador debe poder:

- crear nodo
- renombrar nodo
- mover nodo
- reordenar nodo
- cambiar nodo de padre
- eliminar nodo
- duplicar nodo cuando tenga sentido
- asignar dashboard a nodo
- desvincular dashboard de nodo
- asociar un activo/equipo a nodo
- crear nodos vacíos o contenedores

## 6.5 Comportamiento esperado
La experiencia debe ser similar a un explorador de archivos:
- árbol expandible/colapsable;
- drag and drop para reordenar;
- acciones contextuales por clic derecho o menú contextual;
- breadcrumbs o ruta visible;
- vista de propiedades del nodo seleccionado.

## 6.6 Restricciones
- no debe permitirse generar ciclos;
- un nodo no puede convertirse en hijo de sí mismo;
- deben aplicarse validaciones mínimas de nombre y tipo;
- eliminar nodos con hijos o dashboards asociados debe requerir confirmación.

---

## 7. Gestor de dashboards

## 7.1 Objetivo
Permitir la creación, edición, duplicación y organización de dashboards visuales.

## 7.2 Tipos de dashboard
El sistema debe soportar, como mínimo:

- `global`
- `area`
- `line`
- `equipment`
- `free`
- `template`

## 7.3 Operaciones soportadas
El administrador debe poder:

- crear dashboard
- editar dashboard
- duplicar dashboard
- renombrar dashboard
- cambiar descripción
- eliminar dashboard
- guardar dashboard como template
- asignar dashboard a nodo
- desasignar dashboard de nodo
- previsualizar dashboard
- guardar borrador
- publicar dashboard
- revertir a versión anterior

## 7.4 Duplicación de dashboard
La duplicación debe permitir:

- copiar estructura visual completa;
- copiar widgets y layout;
- conservar o resetear bindings según opción elegida;
- reasignar nombre;
- reasignar nodo o equipo;
- reutilizar dashboard en otra máquina cambiando solo variables.

## 7.5 Uso esperado
Esta funcionalidad debe ser una de las principales herramientas de escalabilidad del sistema.

---

## 8. Editor visual de dashboard

## 8.1 Objetivo
Permitir que el administrador diseñe visualmente un dashboard sin escribir código.

## 8.2 Capacidades principales
El administrador debe poder:

- seleccionar layout base;
- agregar widgets desde una biblioteca;
- posicionar widgets en una grilla;
- mover widgets;
- redimensionar widgets;
- duplicar widgets;
- eliminar widgets;
- editar propiedades visuales;
- editar contenido;
- editar bindings;
- guardar cambios;
- previsualizar dashboard.

## 8.3 Modelo de layout
Se recomienda un layout basado en:
- grilla;
- filas/columnas;
- zonas;
- snap visual;
- restricciones de tamaño mínimo/máximo por widget.

## 8.4 Restricción recomendada
No debe ser un lienzo totalmente libre tipo diseño gráfico absoluto.  
Debe haber una estructura de composición gobernada por grilla y componentes compatibles.

## 8.5 Estados del editor
El editor debe contemplar:
- modo edición;
- modo previsualización;
- modo borrador;
- modo publicado;
- indicador de cambios sin guardar.

---

## 9. Biblioteca de widgets

## 9.1 Objetivo
Ofrecer una biblioteca de componentes reutilizables que el administrador pueda insertar en dashboards.

## 9.2 Tipos mínimos de widget
La biblioteca debe incluir, como mínimo:

- KPI numérico
- Tarjeta de valor principal
- Estado / status
- Badge semántico
- Gauge
- Semáforo
- Sparkline
- Trend chart
- Tabla simple
- Lista de alertas
- Tarjeta de texto/resumen
- Widget de conexión/last update
- Widget de múltiples métricas
- Widget de resumen IA descriptivo
- Separador / título de sección

## 9.3 Operaciones sobre widget
El administrador debe poder:

- insertar widget
- mover widget
- redimensionar widget
- duplicar widget
- borrar widget
- ocultar widget
- cambiar orden visual
- editar configuración
- guardar widget como preset si aplica

## 9.4 Reglas
- cada tipo de widget debe tener un set de propiedades compatibles;
- no todos los widgets deben aceptar cualquier tipo de dato;
- el sistema debe validar compatibilidad entre widget y binding.

---

## 10. Configuración de widget

## 10.1 Objetivo
Permitir configurar comportamiento, apariencia y fuente de información de cada widget.

## 10.2 Propiedades generales
Todo widget debería poder tener, según tipo:

- `title`
- `subtitle`
- `description`
- `size`
- `position`
- `styleVariant`
- `icon`
- `unit`
- `precision`
- `thresholds`
- `showLastUpdated`
- `showConnectionState`
- `fallbackMode`
- `emptyStateMessage`

## 10.3 Propiedades visuales
El administrador debe poder definir, según corresponda:

- título visible
- subtítulo
- color semántico
- variante de estilo
- formato numérico
- unidad
- cantidad de decimales
- comportamiento sin dato
- comportamiento en stale/offline
- ícono si aplica

## 10.4 Propiedades funcionales
El administrador debe poder definir:

- fuente de dato
- modo de binding
- variable asignada
- valor simulado
- thresholds
- modo de actualización visible
- reglas de formato

---

## 11. Gestor de bindings

## 11.1 Objetivo
Vincular cada widget con una fuente de dato compatible.

## 11.2 Modos de binding
Cada widget debe poder configurarse en al menos uno de estos modos:

- `real_variable`
- `simulated_value`

Opcionalmente, en el futuro:
- `derived_value`
- `aggregate_value`

## 11.3 Binding a variable real
El administrador debe poder seleccionar:

- activo/equipo origen
- variable lógica o key
- unidad si corresponde
- formateador
- política de fallback
- política de stale data si aplica

## 11.4 Binding a valor simulado
El administrador debe poder:

- ingresar valor fijo;
- definir valor manual editable;
- definir rango o mock simple si en el futuro se permite simulación dinámica;
- rotular claramente que se trata de un valor simulado.

## 11.5 Validaciones
El sistema debe validar:
- compatibilidad entre tipo de widget y tipo de dato;
- compatibilidad entre unidad/formato y dato;
- consistencia entre variable seleccionada y dashboard/equipo si aplica.

## 11.6 Restricción importante
El binding debe apuntar a una **variable lógica del sistema**, no directamente a un tag crudo industrial cuando eso rompa la abstracción del dominio.

---

## 12. Dashboard principal y dashboards por equipo

## 12.1 Dashboard principal
El administrador debe poder construir un dashboard principal completamente personalizado.

Ejemplos de contenido posible:
- temperatura de planta;
- estado general de sectores;
- resumen de alertas;
- KPIs globales;
- tarjetas de equipos destacados;
- resúmenes IA descriptivos.

## 12.2 Dashboard por equipo
El administrador debe poder construir dashboards particulares para cada equipo, eligiendo:

- qué widgets mostrar;
- qué variables mostrar;
- qué layout usar;
- qué unidad/formato aplicar;
- si el valor será real o simulado.

## 12.3 Reutilización
El administrador debe poder:
- duplicar un dashboard de una máquina;
- cambiar nombre;
- cambiar bindings;
- asignarlo a otro equipo;
- reutilizar la estructura sin reconstruirla desde cero.

---

## 13. Templates

## 13.1 Objetivo
Permitir reutilizar configuraciones estándar para acelerar la creación de dashboards similares.

## 13.2 Tipos de template
Deben existir, al menos:

- template de dashboard
- template de widget
- template por tipo de equipo

## 13.3 Caso de uso principal
Ejemplo:
- template “Comprimidora estándar”
- incluye widgets de presión, temperatura, estado, tendencia y alertas
- el administrador crea nueva máquina
- aplica template
- reasigna variables
- publica

## 13.4 Operaciones soportadas
El administrador debe poder:

- guardar como template
- aplicar template
- duplicar template
- editar template
- eliminar template
- convertir dashboard en template
- convertir widget en preset/template si aplica

---

## 14. Relación entre jerarquía y dashboards

## 14.1 Concepto funcional
Los dashboards deben poder comportarse como si fueran “archivos” asignados a nodos del árbol.

## 14.2 Capacidades
Un nodo puede:
- tener dashboard asignado;
- contener subnodos;
- contener un equipo asociado;
- actuar solo como contenedor;
- tener uno o más dashboards visibles según diseño futuro.

## 14.3 Experiencia esperada
El administrador debe sentir que:
- crea estructura;
- navega carpetas;
- coloca dashboards donde corresponden;
- asigna equipos a esa estructura;
- construye una navegación lógica del sistema.

---

## 15. Gestión de publicación y versionado

## 15.1 Objetivo
Evitar que cualquier cambio en edición impacte inmediatamente en el entorno visible por usuarios finales.

## 15.2 Estados mínimos
Todo dashboard debería poder estar en alguno de estos estados:

- `draft`
- `published`
- `archived`

Opcionalmente:
- `review`
- `deprecated`

## 15.3 Acciones mínimas
El administrador o publicador debe poder:

- guardar borrador
- publicar
- despublicar
- duplicar versión
- restaurar versión previa
- ver historial de cambios

## 15.4 Alcance
Este versionado debe aplicar al menos a:
- dashboards
- templates
- posiblemente estructura, según complejidad elegida

---

## 16. Simulación de datos

## 16.1 Objetivo
Permitir al administrador mostrar dashboards aunque todavía no exista una conexión real o cuando se necesite una demo/mock.

## 16.2 Casos de uso
- prototipado
- demos comerciales
- desarrollo inicial
- pruebas de layout
- validación de UX

## 16.3 Reglas
Los widgets simulados deben identificarse claramente en modo administrador.

Opcionalmente, el runtime final podría ocultar esa marca si el objetivo es una demo controlada, según política de producto.

## 16.4 Restricción
La simulación no debe confundirse con dato productivo real.

---

## 17. Búsqueda y selección de variables

## 17.1 Objetivo
Facilitar al administrador la asignación de datos sin navegar estructuras complejas manualmente cada vez.

## 17.2 Capacidades deseadas
El selector de variable debería permitir buscar por:

- nombre de equipo
- nombre visible
- tipo de equipo
- nombre de variable
- alias
- área
- nodo jerárquico

## 17.3 UX recomendada
- búsqueda con filtro;
- árbol navegable;
- vista de variables por equipo;
- metadata visible;
- confirmación clara de variable seleccionada.

---

## 18. Permisos y seguridad funcional

## 18.1 Reglas básicas
No todos los usuarios del sistema deben acceder al Modo Administrador.

## 18.2 Permisos sugeridos
Permisos separados para:
- editar jerarquía
- editar dashboards
- editar bindings
- usar valores simulados
- crear templates
- publicar
- restaurar versiones
- eliminar elementos

## 18.3 Restricción clave
El Modo Administrador no debe exponer ninguna capacidad de control sobre equipos, incluso para usuarios absolutos.

---

## 19. Casos de uso principales

## 19.1 Crear estructura de planta
Como administrador, quiero crear una estructura tipo:
Planta > Área > Compresión > Box 1 > Comprimidora A  
para organizar dashboards y equipos.

## 19.2 Crear dashboard principal
Como administrador, quiero crear un dashboard principal agregando tarjetas y vinculándolas a variables globales o simuladas.

## 19.3 Crear dashboard de equipo
Como administrador, quiero diseñar un dashboard para una máquina específica seleccionando widgets y variables.

## 19.4 Duplicar dashboard
Como administrador, quiero duplicar un dashboard existente y cambiar sus bindings para reutilizarlo en otra máquina.

## 19.5 Crear template
Como administrador, quiero guardar un dashboard como template para aplicarlo luego a equipos similares.

## 19.6 Usar valor simulado
Como administrador, quiero mostrar un valor simulado cuando aún no exista dato real o necesite una demo.

## 19.7 Publicar cambios
Como administrador/publicador, quiero guardar y publicar una versión estable del dashboard para que la vea el usuario final.

---

## 20. Restricciones de producto recomendadas

Para mantener orden y consistencia, se recomienda que el builder tenga estas restricciones:

- composición sobre grilla, no libertad absoluta;
- biblioteca de widgets aprobados, no elementos arbitrarios;
- binding sobre variables lógicas, no acoplamiento directo crudo cuando pueda evitarse;
- templates reutilizables como patrón principal;
- publicación controlada;
- validaciones de compatibilidad;
- consistencia visual semántica obligatoria.

---

## 21. Entidades funcionales mínimas

## 21.1 Node
Representa un nodo del árbol.

Campos sugeridos:
- `id`
- `name`
- `type`
- `parentId`
- `order`
- `linkedDashboardId?`
- `linkedAssetId?`

## 21.2 Dashboard
Representa una composición visual.

Campos sugeridos:
- `id`
- `name`
- `description`
- `dashboardType`
- `layout`
- `widgets`
- `ownerNodeId?`
- `templateId?`
- `isTemplate`
- `version`
- `status`

## 21.3 WidgetConfig
Representa un widget configurado.

Campos sugeridos:
- `id`
- `type`
- `title`
- `position`
- `size`
- `styleVariant`
- `displayOptions`
- `binding`
- `thresholds`
- `fallbackMode`
- `simulatedValue?`

## 21.4 WidgetBinding
Representa el vínculo entre widget y dato.

Campos sugeridos:
- `mode`
- `assetId?`
- `variableKey?`
- `formatter?`
- `unit?`
- `lastKnownValueAllowed?`
- `staleTimeout?`
- `simulatedValue?`

## 21.5 Template
Representa una configuración reutilizable.

Campos sugeridos:
- `id`
- `name`
- `type`
- `sourceDashboardId?`
- `widgetPresets`
- `layoutPreset`
- `status`

---

## 22. Flujo funcional recomendado del administrador

### Flujo A — Crear estructura
1. Entrar al Editor de jerarquía  
2. Crear Planta  
3. Crear áreas/subniveles  
4. Crear nodos de equipo o carpetas  
5. Asociar equipos o dashboards  

### Flujo B — Crear dashboard principal
1. Crear dashboard  
2. Elegir layout  
3. Agregar widgets  
4. Configurar títulos/estilo  
5. Asignar bindings reales o simulados  
6. Guardar borrador  
7. Previsualizar  
8. Publicar  

### Flujo C — Crear dashboard por equipo
1. Elegir equipo o nodo  
2. Crear nuevo dashboard o duplicar uno existente  
3. Ajustar widgets  
4. Reasignar variables  
5. Guardar/publicar  

### Flujo D — Crear template
1. Abrir dashboard existente  
2. Guardar como template  
3. Nombrar template  
4. Reutilizarlo luego en nuevas máquinas/nodos  

---

## 23. Criterios de éxito

El Modo Administrador estará bien resuelto si permite que un administrador pueda:

- construir la jerarquía completa del sistema sin tocar código;
- crear dashboards globales y por equipo sin ayuda de desarrollo;
- reutilizar configuraciones entre múltiples máquinas;
- asignar variables reales o simuladas fácilmente;
- mantener orden visual y funcional;
- publicar cambios de forma controlada;
- escalar el sistema a nuevos equipos sin rediseñar todo.

---

## 24. Conclusión

El Modo Administrador no es una función secundaria: es uno de los cimientos principales de la plataforma.

Su rol es transformar la solución en una plataforma configurable y escalable, donde la organización de la planta, la composición de dashboards y la asignación de datos puedan ser administradas sin rehacer pantallas en código cada vez.

La base funcional del Modo Administrador debe apoyarse en tres pilares:

1. **Editor de jerarquía**
2. **Builder de dashboards**
3. **Gestor de bindings y templates**

Con esta base, la plataforma podrá crecer de forma ordenada, reusable y adaptable a distintos clientes, plantas, equipos y escenarios de visualización.