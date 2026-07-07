# Data Contract — Integración de datos en tiempo real

> **Frase rectora**: La HMI no consume Node-RED ni RabbitMQ; consume un contrato JSON estable.

---

## 1. Principio rector

La HMI se desacopla del origen real de datos. Hoy la cadena es `Edge -> Node-RED -> API -> HMI`, mañana puede ser `Edge -> RabbitMQ -> API -> HMI`. Mientras el contrato se mantenga, la HMI no cambia.

### Responsabilidades

| Capa | Responsabilidad |
|------|----------------|
| **Adquisicion / API / Adaptador** | Leer datos reales, normalizar, resolver health, definir timestamps, exponer JSON estable |
| **HMI** | Consumir el contrato, renderizar widgets, resolver `machineId + variableKey`, mostrar estados y tiempos |

### La HMI NO debe

- Decodificar Modbus ni interpretar registros crudos
- Calcular health de bajo nivel en widgets
- Depender de detalles internos del origen (`address`, `fc`, `quantity`, etc.)
- Acoplar nombres de archivos/tipos a tecnologias concretas (Node-RED, RabbitMQ)

---

## 2. Configuracion de conexion

| Campo | Ejemplo |
|-------|---------|
| `baseUrl` | `https://node-red.example.local` |
| `endpoint` | `/api/hmi-data` |
| **URL final** | `baseUrl + endpoint` (construida internamente) |

### Reglas

- `baseUrl` y `endpoint` se almacenan por separado
- Manejar barras faltantes o duplicadas
- Si `endpoint` esta vacio y existe default interno, usar el default
- Si `baseUrl` no existe, la integracion queda deshabilitada sin romper UI

---

## 3. Contrato JSON

### 3.1 Estructura completa

```json
{
  "contractVersion": "1.0",
  "timestamp": "2026-04-21T18:04:54Z",
  "connection": {
    "globalStatus": "online",
    "lastSuccess": "2026-04-21T18:04:54Z",
    "ageMs": 1200,
    "healthSource": "timestamp"
  },
  "machines": [
    {
      "unitId": 10,
      "name": "FT2000",
      "status": "online",
      "lastSuccess": "2026-04-21T18:04:54Z",
      "ageMs": 950,
      "healthSource": "timestamp",
      "values": {
        "Total kW": {
          "value": 0.83,
          "unit": "kW",
          "timestamp": "2026-04-21T18:04:54Z",
          "displayName": "Potencia Total"
        }
      }
    }
  ]
}
```

### 3.2 Campos obligatorios

| Nivel | Campo | Tipo |
|-------|-------|------|
| Raiz | `contractVersion` | `string` |
| Raiz | `timestamp` | `string` (ISO 8601) |
| Raiz | `connection` | `object` |
| Raiz | `machines` | `array` |
| `connection` | `globalStatus` | `"online" \| "degradado" \| "offline" \| "unknown"` |
| `connection` | `lastSuccess` | `string \| null` |
| `connection` | `ageMs` | `number \| null` |
| `machines[]` | `unitId` | `number` |
| `machines[]` | `name` | `string` |
| `machines[]` | `status` | `"online" \| "degradado" \| "offline" \| "unknown"` |
| `machines[]` | `lastSuccess` | `string \| null` |
| `machines[]` | `ageMs` | `number \| null` |
| `machines[]` | `values` | `Record<string, MetricValue>` |
| `MetricValue` | `value` | `number \| null` |
| `MetricValue` | `unit` | `string \| null` |
| `MetricValue` | `timestamp` | `string \| null` |

### 3.3 Campos opcionales

Se pueden agregar sin romper contrato: `quality`, `source`, `register`, `meta`, `warning`, `displayName`, `category`, `healthSource`. La HMI no depende de ellos para funcionar.

`healthSource` indica como se resolvio el estado (`timestamp`, `heartbeat`, `adapter`, `backend`, `mixed`). La HMI puede mostrarlo o ignorarlo.

---

## 4. Estados oficiales

| Estado | Significado |
|--------|-------------|
| `online` | Dato valido y fresco |
| `degradado` | Existe dato pero esta viejo o la fuente esta reintentando |
| `offline` | No hay dato utilizable reciente o la fuente fallo |
| `unknown` | No se puede determinar (sin configurar, sin datos, maquina no vinculada) |

Estos estados significan siempre lo mismo, sin importar la fuente real de datos.

---

## 5. Health global vs health por maquina

| Nivel | Pregunta que responde | Uso |
|-------|----------------------|-----|
| **Global** (`connection.globalStatus`) | "La HMI esta pudiendo hablar con la capa de datos?" | Indicador global, widget connection-status scope=global |
| **Maquina** (`machines[].status`) | "La capa de datos esta pudiendo leer esta maquina?" | Dashboard por maquina, indicadores locales |

**Regla**: La conexion global correcta NO garantiza que todas las maquinas esten correctas.

---

## 6. Identificadores estables y resolucion

### Reglas

- Una maquina se resuelve por `unitId` (number)
- Una variable se resuelve por `variableKey` (string, la clave dentro de `values`)
- Nunca resolver por nombres visibles (`displayName` es solo presentacion)

### Ejemplo de resolucion

```
machineId = 10, variableKey = "Total kW"
machines.find(m => m.unitId === 10)?.values["Total kW"]
```

### Binding oficial del widget

```json
{
  "mode": "real_variable",
  "machineId": 10,
  "variableKey": "Total kW",
  "bindingVersion": "real-variable-v1"
}
```

`bindingVersion` no debe referenciar tecnologias concretas.

---

## 7. Acceso centralizado a datos

- Una unica capa centralizada de acceso (service -> adapter -> query/hook)
- Cero fetchs dispersos por componentes
- Todo componente que necesite datos reales consume desde la misma fuente compartida
- Si cambia la fuente, solo cambia el adapter

---

## 8. Fallbacks

| Situacion | Comportamiento |
|-----------|---------------|
| Sin dato | Mostrar `--` o `Sin dato` |
| Fuente falla | UI no rompe |
| Dato viejo | Mostrar valor anterior con estado `degradado` |
| Sin configuracion | Integracion deshabilitada sin crash |

---

## 9. Compatibilidad y versionado

### Cambios permitidos sin romper HMI

- Cambiar Node-RED por RabbitMQ
- Cambiar backend interno
- Agregar campos, maquinas o variables

### Cambios que requieren nuevo `contractVersion`

- Eliminar `unitId` o `variableKey`
- Cambiar semantica de estados
- Cambiar tipos de campos obligatorios
- Romper estructura `machines[].values`

Version actual: `"contractVersion": "1.0"`

---

## 10. Dashboard snapshot export sink

La HMI puede **emitir** un POST del dashboard visible hacia un endpoint externo configurable. Ese flujo es solo un **telemetry snapshot sink** y NO cambia el límite de solo lectura del producto.

### Reglas

- Está **deshabilitado por default**. Un admin debe habilitarlo explícitamente.
- El endpoint es **configurable** y usa la misma `baseUrl` de integración. No hardcodear IPs de producción.
- Este POST es **solo observación**: no envía comandos de planta, no escribe setpoints y no controla actuadores.
- Si falta `baseUrl`, el endpoint está vacío o el toggle sigue deshabilitado, la HMI no envía nada.
- El receptor externo debe tratar el payload como un contrato versionado y tolerar datos faltantes.

### Payload esperado

| Campo | Regla |
|------|-------|
| `timestamp` | ISO 8601 del snapshot emitido |
| `screen` | Contexto de pantalla/dashboard visible |
| `machine` | Puede ser `null` si no hay máquina resoluble |
| `dashboard` | Metadatos del dashboard/render activo |
| `widgets` | Lista serializada de widgets visibles |

### Notas de compatibilidad

- Los campos derivados de telemetría **pueden ser `null`** cuando la fuente no tiene dato disponible.
- El sink externo debe aceptar payloads parciales sin asumir completitud total.
- Este POST complementa el contrato de lectura principal; no reemplaza `contractVersion: "1.0"` del feed que consume la HMI.
