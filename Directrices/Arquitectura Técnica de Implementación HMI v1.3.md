> **Aviso histórico — no normativo.**
> Este documento es un antecedente histórico del proyecto **interfaz HMI**. Registra decisiones de una etapa anterior del proyecto y puede contener información obsoleta o superada. No es fuente de requisitos ni de verdad de implementación vigente.
> Para el estado actual, consultá [`../AGENTS.md`](../AGENTS.md) y la documentación activa en `../docs/`.

---

# 0. Objetivo del documento

Este documento define la Arquitectura Técnica de Implementación HMI v1.3

Su propósito es transformar la Directiva Maestra v3.1 en una base técnica clara, consistente y ejecutable para el desarrollo de la plataforma HMI web industrial.

Esta arquitectura asume explícitamente que la plataforma es:

- read-only respecto a planta;
- orientada a observación, análisis y visualización;
- preparada para escalar a 200+ equipos;
- apta para incorporar IA observadora y asistente, nunca actuadora;
- diseñada como frontend industrial modular, tipado, reusable y preparado para integración futura con datos reales.

---

# 1. Principios rectores de implementación

## 1.1 Read-only por diseño

La plataforma no debe incluir ninguna capacidad técnica que implique escritura sobre planta o sistemas de control industrial.

Quedan expresamente fuera de alcance:

- comandos;
- setpoints;
- reconocimientos que impliquen acción de proceso;
- automatismos;
- triggers de actuación;
- endpoints de escritura;
- módulos de control operativo;
- lógica de intervención sobre máquinas.

La arquitectura debe impedir estas capacidades por diseño, no solo por intención funcional.

## 1.2 Desacople entre fuente de datos y visualización

La UI nunca debe consumir directamente estructuras crudas provenientes de PLCs, RTUs, edge computing, gateways, conversores de protocolo o APIs externas.

Todo dato debe recorrer una cadena técnica controlada:

fuente externa → servicio de acceso → adapter/mapper → modelo tipado interno → capa de consulta/estado → componente UI

## 1.3 Dominio interno estable

La aplicación no debe organizarse alrededor de respuestas ad hoc ni de JSONs “tal como llegan”.
Debe operar sobre un modelo de dominio interno estable, tipado y consistente, independiente del origen técnico del dato.

## 1.4 Escalabilidad modular

La arquitectura debe permitir crecer sin reestructuración traumática en:

- cantidad de pantallas;
- cantidad de activos;
- cantidad de componentes;
- templates y variantes de equipo;
- complejidad visual;
- reglas analíticas;
- integración de nuevas fuentes;
- funcionalidades de asistencia e IA.

## 1.5 UI industrial viva, no maqueta estática

Aunque las primeras etapas usen mocks, la arquitectura debe asumir desde el inicio que la interfaz representa un sistema vivo:

- datos que cambian;
- alertas que aparecen y desaparecen;
- estados que se degradan;
- fuentes que pueden quedar offline;
- timestamps que vencen;
- tendencias que se actualizan.

## 1.6 IA estrictamente no actuadora

Toda capacidad IA deberá limitarse a:

- describir;
- resumir;
- correlacionar;
- detectar patrones o anomalías;
- asistir la navegación o interpretación.

No podrá:

- accionar;
- ejecutar;
- recomendar acciones en tono imperativo;
- intervenir sobre proceso;
- modificar configuraciones automáticamente;
- operar como sustituto del sistema de control.

---

# 2. Stack técnico aprobado

La implementación base se define sobre:

- React
- Vite
- TypeScript
- Tailwind CSS
- CSS custom complementario
- React Router
- TanStack Query (React Query)
- Zustand
- Recharts
- Lucide React

## 2.1 Criterios de uso

React + TypeScript
Base principal para composición de interfaz, tipado fuerte y escalabilidad.

Tailwind CSS
Base de construcción rápida, consistente y reusable.

CSS custom
Capa complementaria para:
- tokens extendidos;
- detalles visuales premium;
- superficies complejas;
- estilo dark industrial;
- branding y refinamiento fino.

React Router
Gestión de navegación principal y composición de rutas.

React Query
Responsable de:
- fetching remoto;
- cache;
- polling controlado;
- revalidación;
- sincronización con fuentes dinámicas;
- manejo de estados de carga y error.

Zustand
Reservado para:
- estado global de UI;
- filtros transversales;
- selección global de planta/línea/área/equipo;
- preferencias de layout;
- navegación contextual.

Recharts
Base para trends y visualización de series históricas o semi-históricas.

Lucide React
Iconografía consistente y sobria.

---

# 3. Alcance técnico de la arquitectura

Esta arquitectura cubre principalmente la construcción de una base frontend escalable preparada para:

- dashboard general;
- detalle de equipo;
- tendencias;
- alertas/eventos;
- búsqueda global;
- asistente IA descriptivo;
- navegación por activos y contexto;
- integración futura con datos reales.

No cubre todavía la implementación total de un backend productivo, pero sí define las capas e interfaces necesarias para integrarlo sin refactorización profunda del frontend.

---

# 4. Arquitectura general del frontend

## 4.1 Enfoque arquitectónico

La aplicación debe estructurarse como una frontend architecture modular, con separación explícita entre:

- app shell y routing;
- pages;
- modules;
- componentes UI reutilizables;
- dominio interno;
- servicios de acceso a datos;
- adapters;
- queries y sincronización;
- estado global de UI;
- sistema visual y tokens.

## 4.2 App Shell

La app shell es la estructura persistente principal de la plataforma y debe contener, como mínimo:

- sidebar de navegación;
- topbar/header contextual;
- contenedor central de vistas;
- soporte para omnibar o búsqueda global;
- espacio para indicadores persistentes de estado general.

La shell no debe contener lógica de negocio específica de una pantalla.

## 4.3 Arquitectura por capas

La implementación debe respetar estas capas:

1. Presentación
2. Composición de páginas
3. Módulos funcionales
4. Dominio interno
5. Servicios/adapters
6. Orquestación de consultas y cache
7. Estado global liviano

Esto evita acoplamiento indebido entre UI, datos y reglas de transformación.

---

# 5. Modelo de dominio base

Se define un conjunto mínimo de entidades internas obligatorias.

## 5.1 Equipment

Representa un activo individual.

Campos sugeridos:

- id: string
- name: string
- type: EquipmentType
- status: EquipmentStatus
- areaId: string
- lineId: string
- plantId: string
- templateId?: string
- criticality?: "low" | "medium" | "high"
- lastUpdateAt?: string
- connectionState: ConnectionState
- tags?: string[]

## 5.2 EquipmentSummary

Versión resumida para dashboard y navegación.

Campos sugeridos:

- id: string
- name: string
- type: EquipmentType
- status: EquipmentStatus
- primaryMetrics: MetricValue[]
- alertCount?: number
- lastUpdateAt?: string
- connectionState: ConnectionState

## 5.3 TelemetryPoint

Representa una variable o muestra puntual.

Campos sugeridos:

- metricId: string
- equipmentId: string
- label: string
- value: number | string | boolean | null
- unit?: string
- quality?: DataQuality
- timestamp: string
- status?: "normal" | "warning" | "critical"

## 5.4 MetricTrendPoint

Para series temporales.

Campos sugeridos:

- timestamp: string
- value: number | null

## 5.5 AlertEvent

Representa una alerta, evento o condición relevante observada.

Campos sugeridos:

- id: string
- equipmentId: string
- title: string
- description?: string
- severity: "info" | "warning" | "critical"
- status: "active" | "acknowledged" | "resolved"
- createdAt: string
- updatedAt?: string
- source?: string

## 5.6 EquipmentStatus

Debe modelarse de forma explícita y limitada.
Estados sugeridos:

- running
- idle
- warning
- critical
- offline
- maintenance
- unknown

## 5.7 ConnectionState

Separado del estado operacional.
Valores sugeridos:

- online
- degraded
- offline
- stale
- unknown

## 5.8 DataQuality

Valores sugeridos:

- good
- estimated
- stale
- invalid
- unknown

---

# 6. Contratos, adapters y anti-corruption layer

## 6.1 Principio obligatorio

Toda fuente externa debe ser traducida a contratos internos mediante adapters explícitos.

Nunca se debe propagar hacia la UI:

- naming de tags crudos;
- estructuras de origen industrial;
- IDs ambiguos;
- respuestas heterogéneas sin normalización;
- timestamps sin parseo o validación.

## 6.2 Responsabilidades del adapter

Cada adapter debe:

- validar presencia mínima de campos;
- normalizar tipos;
- convertir unidades si corresponde;
- resolver nulls y faltantes;
- mapear estados a enums internos;
- enriquecer, cuando aplique, con metadatos útiles para UI;
- descartar o marcar datos inválidos.

## 6.3 Beneficios estructurales

El uso de adapters protege al frontend frente a:

- cambios de proveedor;
- cambios de protocolo;
- inconsistencias del edge;
- reestructuración futura del backend;
- coexistencia de múltiples fuentes simultáneas.

---

# 7. Organización recomendada del proyecto

Estructura sugerida:

src/
  app/
  pages/
  modules/
  components/
  domain/
  services/
  adapters/
  queries/
  store/
  hooks/
  utils/
  styles/
  assets/
  config/
  mocks/

## 7.1 app/

Contiene:
- bootstrap;
- providers;
- router;
- layout raíz;
- app shell.

## 7.2 pages/

Define vistas de primer nivel, por ejemplo:

- DashboardPage
- EquipmentDetailPage
- AlertsPage
- TrendsPage
- SearchPage
- AssistantPage

## 7.3 modules/

Agrupa lógica funcional reutilizable por dominio, por ejemplo:

- equipment
- alerts
- trends
- assistant
- navigation
- overview

## 7.4 components/

Biblioteca reusable puramente visual o visual+interacción simple.

Ejemplos:

- cards
- charts
- status
- indicators
- panels
- tables
- empty-states
- skeletons
- dialogs
- inputs

## 7.5 domain/

Tipos, entidades, enums y contratos internos.

## 7.6 services/

Acceso a fuentes remotas o mocks.

## 7.7 adapters/

Mapeos entre respuestas externas y dominio interno.

## 7.8 queries/

Hooks y definiciones de consulta con React Query.

## 7.9 store/

Estado global liviano con Zustand.

## 7.10 mocks/

JSONs, factories y escenarios simulados.

---

# 8. Sistema de diseño y capa visual

## 8.1 Principio general

La UI debe construirse sobre un design system interno consistente, no sobre estilos aislados por pantalla.

## 8.2 Tokens mínimos requeridos

Debe definirse una base de tokens para:

- colores;
- backgrounds;
- superficies;
- bordes;
- sombras;
- tipografía;
- espaciado;
- radios;
- z-index;
- motion;
- estados semánticos;
- densidad visual.

## 8.3 Semántica cromática

La arquitectura visual debe diferenciar claramente:

- fondo global;
- superficie base;
- superficie elevada;
- superficie crítica;
- acentos interactivos;
- estados de health;
- estados de conectividad;
- estados de alarma.

## 8.4 Tailwind + CSS custom

La estrategia recomendada es:

- Tailwind para layout, spacing, composición y velocidad de construcción;
- CSS custom para tokens, gradientes sutiles, glass industrial, glow controlado, líneas técnicas, tratamiento premium y microacabados.

## 8.5 Consistencia transversal

Todo componente reusable debe consumir tokens, no valores hardcodeados dispersos.

---

# 9. Componentes base obligatorios

La plataforma debe contemplar como mínimo la construcción de estos componentes base:

## 9.1 StatusBadge

Para estado operacional.

## 9.2 ConnectionBadge

Para estado de conectividad/frescura del dato.

## 9.3 MetricCard

Tarjeta de métrica principal con valor, unidad, tendencia y timestamp.

## 9.4 EquipmentCard

Card resumida para dashboard y navegación.

## 9.5 AlertCard / AlertRow

Representación de eventos y alertas.

## 9.6 TrendChart

Componente wrapper sobre Recharts, estandarizado.

## 9.7 TimestampIndicator

Muestra la vigencia del dato.

## 9.8 EmptyState

Estado vacío estándar.

## 9.9 ErrorState

Error visual consistente.

## 9.10 LoadingSkeleton

Skeletons coherentes con layout real.

## 9.11 SectionPanel

Contenedor visual estándar de bloques funcionales.

## 9.12 SearchInput / Omnibar

Entrada centralizada para búsqueda o navegación rápida.

---

# 10. Navegación y routing

## 10.1 Enfoque

La navegación debe permitir crecimiento futuro sin rediseño total.

## 10.2 Rutas mínimas sugeridas

- /
- /dashboard
- /equipment
- /equipment/:equipmentId
- /alerts
- /trends
- /assistant
- /search

## 10.3 Routing desacoplado de labels visuales

Los labels visibles pueden cambiar sin alterar contratos de ruta.

## 10.4 Breadcrumbs y contexto

Las pantallas de detalle deberían exponer breadcrumbs o contexto navegable:

Planta > Línea > Área > Equipo

---

# 11. Estrategia de datos con React Query

## 11.1 Regla general

Todo dato remoto o simulación remota debe gestionarse mediante React Query, no con useEffect disperso en componentes de pantalla.

## 11.2 Responsabilidades

React Query debe centralizar:

- fetching;
- cache;
- refetch;
- polling;
- invalidación;
- retries controlados;
- sincronización de estados remotos.

## 11.3 Claves de query

Las query keys deben ser estables, predecibles y componibles.

Ejemplos:

- ["equipment-list"]
- ["equipment-summary", filters]
- ["equipment-detail", equipmentId]
- ["equipment-trend", equipmentId, metricId, range]
- ["alerts", filters]

## 11.4 Polling controlado

Cuando aplique “casi tiempo real”, el polling debe ser intencional y parametrizable.

No debe implementarse refresh agresivo innecesario.

## 11.5 select y transformación

La normalización principal debe suceder antes, en adapter.
React Query puede complementar con select para shape de consumo puntual.

---

# 12. Estado global con Zustand

## 12.1 Qué sí debe ir en Zustand

- selección de planta/línea/área;
- filtros globales persistentes en sesión;
- preferencias de visualización;
- estado UI de sidebar/paneles;
- contexto de navegación.

## 12.2 Qué no debe ir en Zustand

- datos remotos cacheables;
- listas descargadas del backend;
- detalles remotos de equipo;
- series temporales.

Eso pertenece a React Query.

## 12.3 Principio de minimalismo

El store global debe ser pequeño, explícito y fácil de inspeccionar.

---

# 13. Modelado de estados de UI

Cada pantalla y componente relevante debe contemplar explícitamente:

- loading inicial;
- background refetch;
- empty;
- partial data;
- stale data;
- error recuperable;
- error no recuperable;
- offline/degraded source.

No modelar estos estados produce interfaces frágiles y poco creíbles.

---

# 14. Manejo temporal y timestamps

## 14.1 Regla general

Todo dato observable relevante debe tener timestamp o indicación explícita de ausencia.

## 14.2 Reglas recomendadas

- almacenar internamente timestamps normalizados;
- distinguir hora de evento vs hora de lectura;
- mostrar frescura del dato cuando sea importante;
- detectar stale data;
- evitar ambigüedad temporal.

## 14.3 Expresión visual

La UI debe poder representar situaciones como:

- actualizado hace 12 s
- última lectura hace 4 min
- sin actualización reciente
- fuente sin datos
- timestamp desconocido

---

# 15. Mocks, simulación y desarrollo progresivo

## 15.1 Principio

La arquitectura debe permitir avanzar en frontend sin depender desde el inicio del acceso definitivo a planta.

## 15.2 Requisitos

Debe existir una capa de mocks consistente con el dominio interno, no simples JSONs arbitrarios.

## 15.3 Escenarios mínimos a simular

- equipo normal;
- equipo warning;
- equipo crítico;
- equipo offline;
- datos stale;
- tendencia estable;
- tendencia degradada;
- ausencia de datos;
- múltiples alertas activas.

## 15.4 Beneficio

Esto permite diseñar y testear UX realista antes de la integración final.

---

# 16. Estrategia de componentes por nivel

Se recomienda dividir los componentes en cuatro niveles:

## 16.1 Base UI

Botones, inputs, paneles, badges, tipografía, overlays.

## 16.2 Shared industrial components

MetricCard, StatusBadge, TrendChart, TimestampIndicator, etc.

## 16.3 Domain components

EquipmentOverviewPanel, AlertsSummaryPanel, HealthDistributionPanel, etc.

## 16.4 Page compositions

Composición final por pantalla.

---

# 17. Pantallas objetivo mínimas

## 17.1 Dashboard general

Debe mostrar una visión resumida del sistema:
- KPIs globales;
- resumen de estados;
- equipos destacados;
- alertas recientes;
- distribución por criticidad;
- accesos rápidos.

## 17.2 Detalle de equipo

Debe permitir observar:
- estado actual;
- métricas principales;
- tendencias;
- alertas asociadas;
- conectividad;
- contexto del activo.

## 17.3 Vista de alertas/eventos

Listado filtrable por:
- severidad;
- equipo;
- estado;
- rango temporal.

## 17.4 Vista de tendencias

Comparación y exploración de métricas históricas o recientes.

## 17.5 Asistente IA

Panel descriptivo y explicativo sobre datos visibles y contexto actual.

---

# 18. Asistente IA: alcance técnico y límites

## 18.1 Naturaleza

El asistente debe ser una capa adicional de interpretación, no el núcleo operativo del sistema.

## 18.2 Capacidades válidas

- resumir estado del equipo o del sistema;
- describir tendencias visibles;
- explicar relaciones observables;
- priorizar atención en lenguaje no operativo;
- responder preguntas descriptivas sobre la interfaz.

## 18.3 Restricciones obligatorias

El asistente no debe:

- emitir comandos;
- accionar lógica de planta;
- modificar estados;
- redactar instrucciones operativas imperativas;
- simular autoridad de control;
- ocultar incertidumbre.

## 18.4 Transparencia

Debe quedar claro cuándo una conclusión es:
- dato directo;
- inferencia;
- correlación probable;
- falta de información.

---

# 19. Accesibilidad, legibilidad y ergonomía industrial

## 19.1 Reglas mínimas

La estética premium no debe comprometer legibilidad operativa.

## 19.2 Requisitos

- contraste suficiente;
- tamaños legibles;
- jerarquía visual clara;
- semántica no dependiente solo de color;
- hit areas razonables;
- consistencia de íconos y labels.

## 19.3 Principio

La interfaz debe poder leerse rápido, incluso en entornos exigentes o con atención parcial.

---

# 20. Performance frontend

## 20.1 Objetivo

La arquitectura debe sostener crecimiento en componentes y activos sin degradación innecesaria.

## 20.2 Medidas recomendadas

- memoización donde tenga sentido;
- segmentación de queries;
- evitar renders masivos;
- virtualización si aparecen tablas largas;
- lazy loading de rutas pesadas;
- charts optimizados;
- separación entre layout persistente y vistas variables.

## 20.3 Precaución

No sobreoptimizar prematuramente, pero sí evitar decisiones que escalen mal.

---

# 21. Estrategia de errores y resiliencia

## 21.1 Errores esperables

La arquitectura debe contemplar fallas como:

- fuente inaccesible;
- timeout;
- dato incompleto;
- dato inválido;
- backend caído;
- edge sin respuesta;
- conectividad degradada.

## 21.2 Comportamiento esperado

La UI no debe colapsar ni mostrar información engañosa.
Debe degradar con elegancia y comunicar estado real.

## 21.3 Recomendaciones

- boundaries de error por zonas relevantes;
- mensajes claros;
- fallback visual consistente;
- posibilidad de retry donde corresponda.

---

# 22. Observabilidad del frontend

Incluso siendo una plataforma read-only, es conveniente prever capacidad futura para:

- logging de errores UI;
- métricas de performance;
- trazabilidad de fallos de consulta;
- registro de estados de conectividad;
- diagnóstico de adapters.

Esto no implica instrumentación completa desde día uno, pero sí diseño compatible.

---

# 23. Seguridad y postura funcional

## 23.1 Postura central

La seguridad de esta arquitectura no depende solo de autenticación, sino de limitar funcionalmente lo que el sistema puede hacer.

## 23.2 Requisito estructural

Aunque en el futuro exista backend o autenticación, el frontend no debe incorporar features de acción sobre planta.

## 23.3 Implicancia

La ausencia de capacidades actuadoras es parte del diseño de seguridad.

---

# 24. Testing recomendado

## 24.1 Niveles sugeridos

- tests de adapters;
- tests de utilidades críticas;
- tests de componentes clave;
- tests de flujos de pantalla;
- tests visuales/regresión si el proyecto madura.

## 24.2 Prioridad realista

Si hay que priorizar, primero testear:

- adapters;
- mapping de estados;
- componentes críticos de estatus;
- render de escenarios edge.

---

# 25. Convenciones de implementación

## 25.1 Reglas sugeridas

- tipado estricto;
- evitar any salvo justificación excepcional;
- componentes pequeños y composables;
- props explícitas;
- lógica de transformación fuera de la vista;
- separación entre visual y acceso a datos;
- nombres consistentes con dominio interno;
- evitar hardcode caótico.

## 25.2 Criterio de legibilidad

El código debe ser fácilmente ampliable por humanos y por flujos asistidos con IA.

---

# 26. Capacidad multi-equipo y templates

## 26.1 Requisito

La arquitectura no debe asumir un único tipo de máquina.

## 26.2 Debe permitir

- templates por tipo de equipo;
- componentes configurables por metadata;
- vistas reutilizables;
- crecimiento por catálogo de activos.

## 26.3 Beneficio

Esto habilita escalar a múltiples clientes/equipos sin reescritura total.

---

# 27. Estrategia de integración futura con backend real

## 27.1 Principio

El frontend debe poder comenzar con mocks y migrar progresivamente a servicios reales.

## 27.2 Recomendación

Mantener interfaces de servicio estables, por ejemplo:

- getEquipmentList()
- getEquipmentDetail(id)
- getEquipmentTrends(id, metric, range)
- getAlerts(filters)

## 27.3 Regla

Cambiar la fuente no debe implicar reescribir componentes de presentación.

---

# 28. Fases de implementación sugeridas

## 28.1 Fase 1 — Fundación técnica

Incluye:
- bootstrap del proyecto;
- stack base;
- app shell;
- router;
- tokens iniciales;
- componentes base;
- dominio interno;
- mocks principales.

## 28.2 Fase 2 — Dashboard funcional

Incluye:
- dashboard;
- cards principales;
- estado global mínimo;
- queries mockeadas;
- alertas resumidas;
- navegación inicial.

## 28.3 Fase 3 — Detalle de equipo y tendencias

Incluye:
- pantalla de detalle;
- tendencias;
- métricas;
- eventos asociados;
- estados de conectividad/frescura.

## 28.4 Fase 4 — Alertas y búsqueda

Incluye:
- vista de alertas;
- filtros;
- búsqueda global;
- navegación contextual ampliada.

## 28.5 Fase 5 — Asistente IA descriptivo

Incluye:
- panel IA;
- resúmenes;
- explicación contextual;
- integración no actuadora.

## 28.6 Fase 6 — Integración real progresiva

Incluye:
- reemplazo parcial de mocks;
- adapters reales;
- tuning de polling;
- robustecimiento de estados de error.

---

# 29. Criterios de aceptación arquitectónica

Se considerará correctamente implementada la arquitectura si:

- el frontend está desacoplado de formatos crudos externos;
- existe dominio interno tipado;
- la UI funciona con mocks coherentes;
- los componentes base son reutilizables;
- las pantallas principales están compuestas sobre capas limpias;
- React Query y Zustand tienen responsabilidades bien separadas;
- la plataforma expresa claramente estados, conectividad y temporalidad;
- el asistente IA respeta el límite observador/no actuador;
- la base permite crecimiento a múltiples activos y futuras fuentes reales.

---

# 30. Conclusión

La Arquitectura Técnica de Implementación HMI v1.3 define una base frontend robusta, escalable y coherente para construir una plataforma web industrial read-only, visualmente premium y preparada para integración progresiva con datos reales.

Su valor principal no está solo en elegir un stack moderno, sino en establecer una estructura disciplinada donde:

- la UI permanece desacoplada del origen técnico del dato;
- el dominio interno actúa como núcleo de estabilidad;
- los componentes pueden reutilizarse y escalar;
- la visualización industrial se trata como sistema vivo;
- la IA se incorpora como asistencia interpretativa y nunca como control.

Esta versión v1.3 consolida una dirección técnica madura, apta para iniciar implementación real con IA asistiendo el desarrollo y con capacidad de evolucionar hacia un producto industrial sólido.

---

# 31. Anexo técnico: tipologías de componentes recomendadas

Para asegurar escalabilidad, consistencia y reutilización real, la implementación debería clasificar los componentes en familias explícitas.

## 31.1 Layout components

Responsables de estructura, distribución y persistencia del marco de aplicación.

Ejemplos:
- AppShell
- Sidebar
- Topbar
- MainContent
- PageContainer
- SectionGrid
- ResponsivePanelLayout

## 31.2 UI primitives

Piezas elementales reutilizables y agnósticas del dominio.

Ejemplos:
- Button
- IconButton
- Input
- Select
- Tabs
- Tooltip
- Modal
- Drawer
- Divider
- Badge
- Skeleton

## 31.3 Industrial semantic components

Componentes ya cargados de semántica HMI.

Ejemplos:
- StatusBadge
- ConnectionBadge
- MetricCard
- KPIBlock
- AlertCard
- HealthIndicator
- TimestampIndicator
- TrendChartCard
- EquipmentSummaryCard
- AlarmCounter

## 31.4 Domain composites

Agrupaciones funcionales asociadas al dominio industrial.

Ejemplos:
- EquipmentOverviewPanel
- EquipmentHealthPanel
- EquipmentMetricsPanel
- EquipmentTrendSection
- RecentAlertsPanel
- FleetStatusDistribution
- AreaHealthMatrix
- CriticalEquipmentList

## 31.5 Screen assemblies

Composición final por página.

Ejemplos:
- DashboardOverviewSection
- EquipmentDetailHeader
- EquipmentOperationalSummary
- AlertsExplorer
- TrendsWorkspace
- AssistantInsightPanel

Esta taxonomía ayuda a evitar:
- duplicación de componentes similares;
- crecimiento caótico;
- mezcla entre estilo, semántica y lógica de dominio;
- rigidez futura ante nuevos tipos de equipo.

---

# 32. Anexo técnico: criterios de naming y convenciones de dominio

Una de las principales fuentes de deuda técnica en HMIs web es la mezcla entre nombres de tags industriales, labels improvisados de UI y nombres arbitrarios en código.

La v1.3 debe evitar eso definiendo convenciones claras desde el inicio.

## 32.1 Principio general

Los nombres internos deben responder al dominio de producto, no al accidente técnico del origen del dato.

Ejemplo correcto:
- equipment.status
- connectionState
- lastUpdateAt
- alertSeverity
- metricValue

Ejemplo a evitar:
- plcTag23
- var_a1
- pressure_data_new
- machine_state_v2_final

## 32.2 Convenciones sugeridas

- tipos y entidades en PascalCase;
- variables y propiedades en camelCase;
- enums con vocabulario limitado y explícito;
- nombres de componentes alineados con semántica real;
- nombres de queries basados en intención de uso;
- nombres de adapters asociados al origen y al target.

## 32.3 Beneficio

Esto mejora:
- mantenibilidad;
- claridad para trabajo asistido con IA;
- trazabilidad;
- consistencia entre frontend, mocks y backend futuro.

---

# 33. Anexo técnico: estrategia de variantes visuales por severidad y estado

La UI industrial no puede depender solo de texto para expresar criticidad.
Deben existir reglas visuales consistentes.

## 33.1 Estados semánticos mínimos

- neutral
- info
- success
- warning
- critical
- offline
- unknown

## 33.2 Aplicaciones

Estas variantes deben impactar de forma consistente en:

- badges;
- bordes;
- íconos;
- glow sutil;
- indicadores laterales;
- fondos acentuados;
- gráficos cuando corresponda.

## 33.3 Restricción

El uso de color no debe ser estridente ni decorativo.
Debe ser:
- sobrio;
- consistente;
- semántico;
- compatible con dark industrial UI;
- complementado por iconografía o texto.

---

# 34. Anexo técnico: criterios para tablas, listas y densidad informativa

A medida que escale la cantidad de equipos, alertas y eventos, la arquitectura debe soportar vistas densas sin perder legibilidad.

## 34.1 Tablas industriales

Las tablas o listas densas deben contemplar:
- columnas priorizadas;
- estados visibles sin exceso de ruido;
- filtros rápidos;
- ordenamiento claro;
- filas clickeables cuando tenga sentido;
- consistencia de alineación numérica y temporal.

## 34.2 Regla de diseño

No toda vista densa debe resolverse como tabla tradicional.
En muchos casos conviene:
- cards compactas;
- listas jerárquicas;
- paneles comparativos;
- matrices visuales.

## 34.3 Decisión arquitectónica

La arquitectura de componentes debe soportar ambas estrategias:
- exploración visual tipo dashboard;
- inspección densa tipo lista o tabla.

---

# 35. Anexo técnico: futuro soporte para configuraciones y metadata de activo

Aunque la plataforma sea read-only, es conveniente prever un espacio de metadata estable por activo.

## 35.1 Metadata sugerida por equipo

- tipo de equipo;
- área;
- línea;
- planta;
- criticidad;
- template visual;
- métricas asociadas;
- unidades esperadas;
- límites semánticos;
- alias legibles;
- tags de clasificación.

## 35.2 Motivo

Esto permite:
- personalizar vistas por tipo de activo;
- reutilizar layouts;
- definir prioridades;
- alimentar asistentes IA con contexto;
- evitar hardcode de comportamiento por pantalla.

## 35.3 Regla

La metadata debe integrarse al dominio interno, no quedar dispersa en componentes.

---

# 36. Anexo técnico: preparación para evolución hacia arquitectura enterprise

Aunque la primera implementación pueda ser acotada, la base técnica debería ser compatible con evolución hacia una plataforma más madura.

## 36.1 Posibles evoluciones futuras

- autenticación y perfiles;
- multi-tenant o multi-cliente;
- feature flags;
- backend BFF;
- sistema de permisos por vistas;
- auditoría de navegación;
- observabilidad avanzada;
- internacionalización;
- catálogos dinámicos de activos;
- motores analíticos más complejos.

## 36.2 Criterio de compatibilidad

La v1.3 no necesita implementar todo eso ahora, pero sí evitar decisiones que bloqueen esa evolución.

## 36.3 Principio final

Una buena arquitectura inicial no es la que intenta resolver todo desde el día uno, sino la que establece límites correctos, separaciones limpias y capacidad real de crecer sin romperse.