# V3.1 — Directiva Maestra del Proyecto HMI Industrial Web
## Sistema de visualización premium para datos de proceso industriales

> **Estado:** Histórico — no normativo (estado original: Activo)\
> **Versión:** 3.1  
> **Tipo de documento:** Directiva maestra de producto, diseño y arquitectura  
> **Naturaleza del sistema:** Observador / Visualizador / Asistivo  
> **Restricción crítica:** No actuador, no controlador, no sistema de mando, no sistema de seguridad  
> **Tecnologías base aprobadas:** React + Vite + TypeScript + Tailwind CSS + CSS custom  
> **Objetivo del documento:** Servir como marco rector para que cualquier agente IA, desarrollador o sistema de generación implemente el producto sin desviarse del alcance, del lenguaje visual ni de las restricciones operativas del proyecto

> **Aviso histórico — no normativo.**
> Este documento es un antecedente histórico del proyecto **interfaz HMI**. Registra decisiones de una etapa anterior del proyecto y puede contener información obsoleta o superada. No es fuente de requisitos ni de verdad de implementación vigente.
> Para el estado actual, consultá [`../AGENTS.md`](../AGENTS.md) y la documentación activa en `../docs/`.

---

# 1. Propósito del proyecto

Diseñar e implementar una interfaz HMI web de estética industrial premium, futurista y altamente profesional, orientada a la visualización clara, robusta y jerárquica de variables de proceso provenientes de equipos industriales conectados a infraestructura de edge computing.

La interfaz debe permitir observar el estado de los equipos, interpretar rápidamente su condición operativa, navegar variables relevantes, visualizar tendencias y detectar anomalías visuales, pero **sin intervenir sobre la máquina ni ejecutar acciones de control**.

Este sistema no reemplaza un PLC, no reemplaza un SCADA de control, no reemplaza una lógica de seguridad y no debe asumir jamás funciones de comando operativo sobre los equipos.

---

# 2. Definición estructural del sistema

## 2.1 Qué es este sistema

Este producto es una interfaz HMI web de nueva generación orientada a:

- visualizar datos industriales en tiempo real o casi real;
- presentar estados de proceso con jerarquía visual alta;
- ofrecer una experiencia visual premium y tecnológica;
- facilitar lectura rápida, comprensión situacional y monitoreo;
- incorporar eventualmente una capa IA asistiva de observación e interpretación;
- servir como base reusable para múltiples clientes o múltiples equipos con adaptación de branding y configuración.

## 2.2 Qué no es este sistema

Este sistema **no es**:

- una central de control;
- una consola de mando de maquinaria;
- un reemplazo de PLC;
- un reemplazo de SCADA de control operativo;
- un sistema de seguridad funcional;
- un sistema con potestad para accionar equipos;
- un entorno para disparar paradas, arranques o maniobras;
- un backend de automatización industrial;
- una capa que escriba lógica de control sobre planta.

---

# 3. Restricción principal inviolable

## 3.1 Regla absoluta

La interfaz HMI diseñada en este proyecto es **solamente observadora, informativa y asistiva**.

## 3.2 Implicancias obligatorias

Por diseño, la interfaz:

- no puede activar paradas de emergencia;
- no puede disparar comandos de arranque;
- no puede modificar consignas críticas;
- no puede cambiar parámetros operativos de máquina;
- no puede escribir estados sobre equipos de campo;
- no puede actuar sobre actuadores, motores, válvulas, compresores o enclavamientos;
- no puede tomar decisiones automáticas sobre la planta;
- no puede ejecutar acciones físicas ni lógicas sobre el proceso.

## 3.3 Regla para cualquier IA incorporada

Si se incorpora IA, su rol debe ser exclusivamente:

- observador;
- analista;
- resumidor;
- explicador;
- detector asistivo de patrones;
- generador de insights descriptivos;
- apoyo a interpretación humana.

La IA **nunca** debe:

- enviar comandos a máquinas;
- ejecutar acciones de control;
- cerrar lazos operativos;
- sustituir protecciones;
- tomar control del proceso.

---

# 4. Objetivo general de experiencia

La experiencia del sistema debe transmitir simultáneamente:

- precisión industrial;
- sofisticación tecnológica;
- claridad operacional;
- robustez visual;
- lectura jerárquica inmediata;
- sensación premium;
- identidad técnica contemporánea.

La interfaz no debe parecer una demo genérica, una app SaaS común ni un dashboard administrativo estándar. Debe sentirse como un sistema industrial de alto valor, diseñado con criterio técnico, estético y estratégico.

---

# 5. Objetivos funcionales

## 5.1 Objetivo principal

Construir una interfaz web capaz de mostrar con claridad y elegancia el estado operativo de uno o múltiples equipos industriales conectados a una fuente de datos proveniente de edge computing.

## 5.2 Objetivos específicos

- permitir selección de equipo o activo;
- mostrar variables relevantes del proceso;
- representar estados operativos con claridad inmediata;
- visualizar tendencias y evolución temporal;
- exponer alertas o desvíos de forma visualmente priorizada;
- mantener consistencia estética y funcional entre vistas;
- tolerar estados de datos incompletos sin colapsar visualmente;
- ofrecer una base escalable para nuevas pantallas, nuevos equipos y nuevas integraciones.

---

# 6. Principios rectores del producto

## 6.1 Claridad antes que ornamentación

La estética premium es importante, pero nunca debe sacrificar legibilidad, comprensión del estado del sistema ni jerarquía informativa.

## 6.2 Estado antes que dato aislado

La interfaz debe comunicar contexto operativo y condición general, no solo números sueltos.

## 6.3 Jerarquía visual estricta

No todos los datos tienen el mismo peso. El diseño debe ordenar qué se ve primero, qué segundo y qué tercero.

## 6.4 Consistencia sistémica

Todos los módulos, tarjetas, paneles, tablas, indicadores y gráficos deben compartir reglas comunes de espaciado, tipografía, color, densidad, contraste y comportamiento.

## 6.5 Robustez frente a datos imperfectos

La interfaz debe seguir siendo útil aunque haya variables nulas, latencia, desconexión parcial, datos fuera de rango o ausencia momentánea de actualización.

## 6.6 Escalabilidad estructural

El sistema debe poder crecer por módulos sin degradar coherencia.

## 6.7 Asistencia, no automatización de control

Toda inteligencia agregada debe amplificar lectura e interpretación humana, nunca reemplazar operación segura ni autoridad de control industrial.

---

# 7. Tipo de producto a construir

Se trata de una **HMI web premium industrial**, no de una landing page, ni de una app comercial genérica, ni de un panel administrativo tradicional.

Su diseño debe combinar:

- lenguaje industrial;
- refinamiento visual;
- densidad informativa controlada;
- estética dark-tech;
- indicadores de estado claros;
- componentes modulares;
- foco en observación de proceso.

---

# 8. Enfoque tecnológico aprobado

## 8.1 Stack principal

- **Frontend:** React
- **Build tool:** Vite
- **Lenguaje:** TypeScript
- **Base de estilos:** Tailwind CSS
- **Capa visual adicional:** CSS custom para terminación premium
- **Arquitectura UI:** modular, componible, escalable
- **Integración de datos:** desacoplada mediante adapters o servicios tipados

## 8.2 Criterio sobre estilos

No se utilizará Vanilla CSS puro como estrategia principal del proyecto.

Se utilizará:

- Tailwind CSS para velocidad, consistencia y escalabilidad;
- CSS custom para detalles visuales finos, identidad premium, microacabados, texturas sutiles, overlays, bordes, brillo, sombras, profundidad, tratamiento de paneles y elementos industriales.

## 8.3 Motivo de la decisión

Este enfoque equilibra:

- velocidad de construcción;
- mantenibilidad;
- consistencia sistémica;
- capacidad de iteración rápida con IA;
- y calidad visual suficiente para lograr un resultado premium no genérico.

---

# 9. Restricciones de implementación

## 9.1 Restricciones funcionales

- no implementar botones de acción crítica;
- no modelar flujos de control de máquina;
- no diseñar UX de comando operativo;
- no incluir acciones que impliquen envío de órdenes a equipos;
- no introducir features que confundan al usuario respecto al alcance del sistema.

## 9.2 Restricciones visuales

- no usar estética infantil, gamer, caricaturesca o excesivamente sci-fi;
- no saturar la pantalla con efectos innecesarios;
- no usar colores sin criterio semántico;
- no usar glow excesivo que afecte legibilidad;
- no sacrificar contraste ni lectura por “verse futurista”.

## 9.3 Restricciones de arquitectura

- no acoplar componentes visuales directamente a fuentes de datos sin capa intermedia;
- no mezclar lógica de transformación con presentación;
- no dejar tipados ambiguos en variables críticas;
- no depender de mocks para lógica real de producción;
- no construir una UI rígida que solo sirva para una pantalla fija.

---

# 10. Personalidad visual objetivo

La interfaz debe transmitir:

- precisión;
- control visual;
- confianza;
- modernidad industrial;
- solidez;
- tecnología de alto nivel;
- limpieza técnica;
- tensión visual refinada;
- sensación de producto serio y premium.

Debe sentirse cercana a:

- sistemas de monitoreo industrial avanzados;
- software técnico de alto valor;
- paneles operativos contemporáneos de nivel corporativo;
- dashboards dark premium con lenguaje industrial y espacial contenido.

---

# 11. Lenguaje visual

## 11.1 Estética general

- dark industrial UI;
- premium technical interface;
- futurismo sobrio;
- paneles con profundidad contenida;
- brillo puntual y controlado;
- bordes definidos;
- acentos lumínicos sutiles;
- composición limpia;
- espacialidad consistente;
- foco en legibilidad y estado.

## 11.2 Reglas de forma

- esquinas limpias o suavemente redondeadas según sistema;
- paneles claramente delimitados;
- uso consistente de cards/panels/modules;
- contenedores con jerarquía y separación nítida;
- grillas con alineación exacta;
- márgenes generosos pero no vacíos;
- densidad visual media-alta controlada.

## 11.3 Reglas de iluminación visual

- usar highlights sutiles, no neones dominantes;
- aplicar overlays discretos;
- sombras suaves y profundas donde aporten capa;
- líneas o acentos luminosos solo para reforzar foco, estado o división.

---

# 12. Principios de UX industrial

## 12.1 La información crítica debe verse primero

Estados globales, anomalías, alarmas visuales, condición del equipo y KPIs primarios deben dominar la pantalla.

## 12.2 El usuario debe orientarse sin esfuerzo

Cada vista debe dejar claro:

- qué equipo está viendo;
- en qué estado se encuentra;
- qué variables son relevantes;
- si hay algo anómalo;
- qué cambió recientemente.

## 12.3 El dato debe tener contexto

No mostrar números aislados sin etiquetas, unidad, rango o interpretación visual.

## 12.4 Cada componente debe comunicar su rol

Un panel debe ser identificable como:

- estado;
- tendencia;
- variable instantánea;
- alerta;
- resumen;
- comparación;
- histórico;
- diagnóstico visual.

## 12.5 El sistema debe soportar escaneo rápido

La interfaz debe permitir lectura en segundos, no exigir análisis lento de toda la pantalla.

---

# 13. Arquitectura conceptual de pantallas

## 13.1 Pantalla de overview / dashboard general

Debe concentrar:

- identificación del equipo;
- estado general;
- KPIs principales;
- variables críticas;
- alertas resumidas;
- tendencia breve;
- acceso a vistas más detalladas.

## 13.2 Pantalla de detalle de equipo

Debe profundizar en:

- estado operativo;
- variables agrupadas por categoría;
- series temporales;
- indicadores derivados;
- historial corto;
- eventos visuales relevantes;
- estado de comunicación / actualización de datos.

## 13.3 Pantalla de tendencias

Debe permitir:

- seguimiento temporal;
- comparación de variables;
- foco en evolución;
- lectura clara de escalas y unidades;
- separación entre variables compatibles e incompatibles.

## 13.4 Pantalla de alertas / incidencias visuales

Debe mostrar:

- alertas activas;
- criticidad;
- hora de detección;
- equipo afectado;
- severidad visual;
- agrupación clara;
- diferenciación entre advertencia y error.

## 13.5 Pantalla asistiva IA (si se implementa)

Debe limitarse a:

- resumen del estado observable;
- explicación de patrones;
- detección de comportamientos atípicos;
- interpretación descriptiva;
- sugerencias de revisión humana.

Nunca debe incluir:

- acciones automáticas;
- recomendaciones presentadas como órdenes de control;
- decisiones operativas ejecutables;
- comandos sobre el proceso.

---

# 14. Modelo de componentes UI

## 14.1 Componentes esperables

- app shell;
- top bar;
- lateral navigation;
- selector de equipo;
- panel de estado global;
- cards de KPIs;
- paneles de variables;
- charts;
- tablas compactas;
- badges de estado;
- timeline o log visual;
- alert list;
- módulos de resumen;
- módulos de interpretación asistiva;
- empty states;
- error states;
- skeleton loaders.

## 14.2 Regla de diseño para componentes

Todo componente debe responder visualmente a cinco estados mínimos:

- loading;
- success / normal;
- warning;
- error;
- no-data.

No deben existir componentes “mudos” frente a ausencia o falla de datos.

---

# 15. Sistema de estados

## 15.1 Estado visual semántico

Cada estado debe tener tratamiento visual consistente en:

- color;
- iconografía;
- tipografía;
- contraste;
- borde;
- fondo;
- acento;
- comportamiento animado, si aplica.

## 15.2 Estados mínimos del sistema

- normal;
- informativo;
- advertencia;
- crítico;
- desconectado;
- sin datos;
- actualizando;
- degradado.

## 15.3 Regla crítica

Los colores deben comunicar semántica operativa, no decoración.

---

# 16. Tratamiento de datos industriales

## 16.1 Principio general

Los datos deben llegar a la UI mediante una capa desacoplada que permita:

- adaptación de formato;
- normalización;
- tipado;
- validación;
- manejo de errores;
- evolución futura sin romper la vista.

## 16.2 Reglas obligatorias

- no consumir datos crudos directamente en componentes visuales;
- usar adapters, services o transformers;
- definir tipos fuertes para entidades principales;
- contemplar timestamps, unidades, calidad del dato y rangos esperables;
- manejar nulls, undefined, NaN y formatos inesperados.

## 16.3 Casos borde obligatorios

La UI debe contemplar explícitamente:

- falta de conexión;
- latencia;
- endpoint inaccesible;
- valores nulos;
- valores congelados;
- timestamps desactualizados;
- variables fuera de rango;
- estructura de payload cambiante;
- respuestas parciales;
- equipo sin datos disponibles.

---

# 17. Integración con datos reales

## 17.1 Contexto de origen

Los datos provendrán de una infraestructura industrial con edge computing y acceso a variables de equipos conectados a través de conversión RTU/TCP o mecanismos equivalentes expuestos mediante red interna, VPN o capa de acceso definida por infraestructura técnica.

## 17.2 Regla de proyecto

La HMI debe diseñarse asumiendo integración real, no como simple ejercicio estético.

## 17.3 Implicancia

La arquitectura visual y técnica debe prever:

- fuentes reales de datos;
- disponibilidad parcial;
- polling o actualización periódica;
- validación de estructura;
- mapeo de variables;
- posible crecimiento del catálogo de señales.

---

# 18. Reglas para IA generativa aplicada al desarrollo

## 18.1 Uso permitido de IA en el proyecto

La programación del sistema puede desarrollarse intensivamente con IA, siempre que se mantengan reglas estrictas de alcance, consistencia y validación.

## 18.2 Rol esperado de Antigravity o agentes IA

- acelerar construcción;
- generar estructura;
- proponer componentes;
- mantener consistencia con directivas;
- refinar implementación;
- asistir documentación;
- iterar diseño y código.

## 18.3 Límites obligatorios

La IA no debe:

- inventar funcionalidades fuera del alcance;
- convertir la interfaz en sistema de control;
- introducir features no autorizadas;
- degradar la identidad visual definida;
- romper consistencia arquitectónica.

---

# 19. Reglas operativas para cualquier agente IA que implemente este proyecto

## 19.1 Antes de generar código

Debe verificar:

- alcance exacto del módulo;
- naturaleza observadora del sistema;
- lenguaje visual definido;
- stack aprobado;
- restricciones funcionales;
- criterio de integración de datos;
- consistencia con esta directiva maestra.

## 19.2 Durante la implementación

Debe respetar:

- modularidad;
- tipado fuerte;
- consistencia de naming;
- separación de responsabilidades;
- reutilización inteligente;
- jerarquía visual clara;
- estados de UI completos;
- accesibilidad mínima razonable;
- limpieza estructural.

## 19.3 Está prohibido

- inventar automatizaciones de control;
- agregar botones de acción crítica;
- mezclar experimentalismo visual sin criterio;
- implementar componentes sin estados de error/no-data;
- improvisar arquitectura sin base tipada;
- usar soluciones visuales genéricas sin acabado premium.

---

# 20. Criterios de calidad visual

## 20.1 Un resultado aceptable debe verse

- técnico;
- caro;
- limpio;
- robusto;
- moderno;
- industrial;
- serio;
- deliberado;
- consistente.

## 20.2 Un resultado no aceptable se verá

- genérico;
- improvisado;
- excesivamente plano;
- demasiado brillante o “gaming”;
- pobre en jerarquía;
- confuso;
- sobrecargado;
- sin narrativa visual de estado;
- parecido a un panel administrativo común.

---

# 21. Criterios de calidad técnica

Un resultado técnicamente aceptable debe cumplir:

- estructura modular clara;
- tipado en TypeScript;
- componentes reutilizables;
- estilos sistematizados;
- datos desacoplados de la vista;
- manejo robusto de estados;
- facilidad de expansión;
- mantenibilidad;
- coherencia entre diseño y arquitectura.

---

# 22. Criterios de éxito del proyecto

El proyecto será exitoso si logra simultáneamente:

1. una estética premium dark industrial convincente;
2. una lectura clara del estado del equipo;
3. una arquitectura frontend sólida y escalable;
4. una integración realista con datos industriales;
5. una separación estricta entre visualización y control;
6. una base reusable para futuros clientes o equipos;
7. una implementación consistente aún trabajando con IA.

---

# 23. Anti-objetivos

El proyecto fracasa si deriva hacia cualquiera de estas situaciones:

- una UI linda pero vacía de criterio técnico;
- una UI técnica pero visualmente pobre o genérica;
- una pseudo-HMI que parezca un panel SaaS normal;
- una experiencia visual sobrecargada e ilegible;
- una arquitectura improvisada y difícil de crecer;
- una confusión entre monitoreo y control;
- una IA que proponga o implemente acciones actuadoras;
- una pantalla sin jerarquía ni estados claros.

---

# 24. Reglas de composición

## 24.1 Layout

- usar estructura clara por regiones;
- evitar amontonamiento;
- sostener alineación rigurosa;
- mantener ritmo vertical y horizontal;
- permitir respiración visual sin perder densidad técnica.

## 24.2 Jerarquía

La pantalla debe responder a tres niveles:

- nivel 1: estado crítico / identidad del equipo / KPIs primarios;
- nivel 2: variables clave / tendencias / alertas importantes;
- nivel 3: detalle secundario / contexto / datos ampliados.

## 24.3 Escalabilidad de layout

El layout debe poder adaptarse a:

- un equipo;
- varios equipos;
- distintas resoluciones;
- futuras vistas sin rehacerse por completo.

---

# 25. Reglas tipográficas

- tipografía clara, contemporánea y técnica;
- contraste suficiente;
- escalas coherentes;
- pesos diferenciados por jerarquía;
- etiquetas compactas y legibles;
- números y unidades con tratamiento visual consistente.

Los números críticos deben destacar sin romper armonía.

---

# 26. Reglas cromáticas

La paleta debe basarse en:

- fondos oscuros profundos;
- capas diferenciadas;
- acentos tecnológicos controlados;
- semántica de estados;
- contraste legible.

Los colores deben utilizarse para:

- jerarquía;
- foco;
- severidad;
- categorías funcionales;
- feedback de sistema.

No para decoración arbitraria.

---

# 27. Reglas para gráficos y visualización de series

Los gráficos deben ser:

- legibles;
- limpios;
- coherentes con la estética general;
- claros en unidades y escalas;
- visualmente integrados a la HMI.

No deben:

- ser recargados;
- usar colores ambiguos;
- competir con el estado general;
- parecer widgets pegados sin integración visual.

---

# 28. Reglas para alertas y anomalías visuales

Las alertas deben:

- priorizarse por severidad;
- distinguir advertencia de crítico;
- ser visibles sin invadir toda la pantalla;
- mantener consistencia visual;
- incluir referencia temporal si aplica;
- estar agrupadas con criterio.

La interfaz no debe caer en alarmismo visual permanente.

---

# 29. Reglas para navegación

La navegación debe ser:

- simple;
- clara;
- estable;
- con nombres comprensibles;
- coherente con la jerarquía del sistema.

Debe favorecer acceso rápido a:

- overview;
- detalle por equipo;
- tendencias;
- alertas;
- análisis asistivo, si existe.

---

# 30. Reglas de modularidad

Cada módulo funcional importante debe poder documentarse y construirse como unidad relativamente independiente, por ejemplo:

- módulo shell;
- módulo selección de equipo;
- módulo dashboard overview;
- módulo variable cards;
- módulo charts;
- módulo alertas;
- módulo data adapters;
- módulo estado de conexión;
- módulo IA asistiva.

Esto permite iteración controlada con IA sin perder orden sistémico.

---

# 31. Reglas de documentación del proyecto

Toda evolución relevante debe dejar claro:

- qué se cambió;
- por qué se cambió;
- qué problema resuelve;
- qué impacto tiene en alcance, diseño o arquitectura.

La documentación debe ayudar a que nuevas iteraciones no contradigan decisiones ya tomadas.

---

# 32. Regla especial sobre determinismo de resultados con IA

Para obtener resultados más consistentes al trabajar con agentes IA, toda generación futura debe respetar estas prioridades:

1. esta directiva maestra;
2. el documento de arquitectura técnica;
3. las directivas específicas de módulo o pantalla;
4. los criterios de diseño definidos por el proyecto;
5. la implementación previa ya validada.

No se deben introducir reinterpretaciones libres si contradicen este marco.

---

# 33. Directriz de adaptación a cliente futuro

El sistema debe poder reutilizarse como base para otros clientes o proyectos similares mediante:

- cambio de branding;
- ajuste de variables;
- cambio de fuentes de datos;
- adaptación de módulos visibles;
- personalización de layout y nomenclatura.

La base no debe depender de una única implementación cerrada.

---

# 34. Declaración final de alcance

Este proyecto consiste en el diseño e implementación de una HMI web premium industrial de observación y visualización, desarrollada con un stack frontend moderno, pensada para mostrar datos reales de proceso con claridad, robustez y estética de alto nivel.

Toda decisión futura debe evaluarse contra esta pregunta:

**¿Esto refuerza una interfaz observadora, premium, industrial, clara y escalable?**

Si la respuesta es no, esa decisión no pertenece al proyecto.

---

# 35. Resumen ejecutivo operativo

## Sí debe hacer

- visualizar datos industriales;
- mostrar estado de equipos;
- ofrecer experiencia premium dark industrial;
- estructurarse con React + Vite + TypeScript + Tailwind + CSS custom;
- integrar datos mediante capa desacoplada;
- escalar por módulos;
- permitir IA asistiva solo observadora.

## No debe hacer

- controlar máquinas;
- enviar comandos;
- ejecutar acciones operativas;
- reemplazar sistemas de seguridad o control;
- degradarse a dashboard genérico;
- introducir features fuera de alcance;
- permitir que una IA actúe sobre el proceso.

---

# 36. Instrucción final para cualquier sistema generativo que use este documento

Implementar este proyecto como una **HMI web observadora premium**, no como un sistema de control.

Priorizar:

- claridad;
- jerarquía;
- estética industrial premium;
- modularidad;
- robustez técnica;
- consistencia visual;
- respeto absoluto por la restricción de no actuación.

Toda propuesta, pantalla, componente, integración o capa IA debe alinearse con esta base sin excepciones.