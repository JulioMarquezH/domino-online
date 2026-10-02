# Torneo

Una liga privada para **cuatro jugadores fijos**. Se juega a lo largo de varios días (por ejemplo,
los miércoles), el avance se guarda solo y al terminar el partido 12 el torneo se cierra con su
campeón. Esta es la regla completa; el código que la aplica está en `shared/src/tournament.ts`
(funciones puras con tests) y `server/src/`.

## Crear y entrar

1. En el inicio, **Torneo**. El creador escribe **exactamente cuatro nombres distintos** (1–20
   caracteres). Dos nombres son el mismo si solo cambian mayúsculas, tildes o espacios
   (`José` = `jose` = ` JOSE`).
2. Una pantalla de confirmación avisa: _"Estos nombres no se pueden cambiar después."_
3. **El servidor sortea las letras A, B, C y D** (una permutación al azar con el generador
   criptográfico) y las guarda para siempre. El navegador solo anima el resultado; nunca decide.
4. El torneo recibe un **ID de 12 caracteres** al azar (alfabeto sin 0/O/1/I/L, ~59 bits). El ID es
   **el único secreto**: el enlace es `/torneo/<ID>`. El servidor nunca lista torneos.
5. Para entrar, cada jugador **escribe su nombre**. Si coincide (sin importar mayúsculas ni tildes)
   con uno de los cuatro, entra; si no: _"Ese nombre no está en este torneo"_. ID desconocido:
   _"El torneo no existe"_. **No hay PIN ni cuentas** y no se muestra una lista de nombres.
6. El servidor entrega un token aleatorio que el dispositivo guarda (`localStorage`,
   `tournament:<ID>`) para no volver a preguntar. El mismo nombre se puede reclamar desde otro
   dispositivo (recibe su propio token). Ver la tabla y jugar exigen una identidad válida.
7. El creador no tiene poderes especiales: si es uno de los cuatro, entra escribiendo su nombre.
8. Los intentos fallidos (ID o nombre incorrectos) tienen límite por IP y por conexión; pasado el
   límite se muestra _"Demasiados intentos"_ con el tiempo de espera.

En el inicio, **Tus torneos** lista los torneos que ese dispositivo abrió (guardados en su
`localStorage`); el servidor los valida y los que ya no existen desaparecen sin avisar.

## Calendario

12 partidos = **4 jornadas × 3 partidos**. Cada jornada tiene las tres formas de armar parejas:

| Partido | Pareja 1 | Pareja 2 |
| ------- | -------- | -------- |
| AB-CD   | A + B    | C + D    |
| AC-BD   | A + C    | B + D    |
| AD-BC   | A + D    | B + C    |

Así cada jugador es compañero de cada otro una vez por jornada y **los cuatro juegan todos los
partidos** (siempre tienen el mismo PJ). El **orden** de los tres partidos de una jornada lo sortea
el servidor cuando esa jornada empieza (la 1 al crear el torneo; la N+1 apenas se guarda el tercer
partido de la N) y queda guardado: todos ven el mismo orden. No se crea una jornada 5.

Siempre hay **un solo "siguiente partido"**: el primer cupo sin terminar. Solo ese tiene el botón
**Jugar**. Una jornada puede partirse entre varios días.

## Jugar un partido

- **Jugar** abre la sala privada del cupo (o devuelve la ya abierta: doble clic o cuatro personas
  pulsando a la vez crean **una sola** sala).
- Las parejas vienen del calendario (compañeros frente a frente), la meta es **100** (constante del
  servidor; el cliente no la elige) y el sorteo de quién sale (levantar ficha) se mantiene.
- La sala está **bloqueada**: solo entran los cuatro jugadores registrados con su identidad; no hay
  IA, ni reemplazos, ni cambio de meta o de parejas, ni revancha. Si alguien se desconecta, rige la
  pausa de 2 minutos y puede volver con su identidad.
- Al terminar: _"Partido guardado"_ y **Volver al torneo**.

### Cuándo cuenta un partido

**Solo** cuando una pareja llega a la meta y la sala llega a su fin normal. Si la sala muere, el
anfitrión elige **Terminar partida**, el servidor se reinicia o falta alguien, **no se guarda nada**
y el cupo sigue pendiente: se juega de nuevo desde cero.

## Puntos

Por partido terminado, cada una de las dos personas ganadoras suma **1 punto**; si fue **zapatero**
(la pareja perdedora terminó con **0** puntos en el marcador del partido) cada ganadora suma
**1,5**. Las dos perdedoras suman 0. Los puntos son **individuales**, no por pareja. El máximo
posible es 18.

## Tabla

| Columna | Significado                                                               |
| ------- | ------------------------------------------------------------------------- |
| PJ      | partidos jugados                                                          |
| PG      | partidos ganados                                                          |
| Zap     | zapateros ganados                                                         |
| ZapR    | zapateros recibidos (columna secundaria; se oculta en pantallas angostas) |
| Pts     | puntos                                                                    |
| Avg     | Pts ÷ PJ, con 2 decimales (0,00 si PJ = 0)                                |

**Orden:** más Pts; si empatan, (1) mayor Avg, (2) más zapateros ganados, (3) menos zapateros
recibidos. Si aun así empatan, **quedan empatados** (mismo puesto). No hay desempate 1 contra 1 ni
resolución manual. Como el PJ es igual para los cuatro, el Avg empata exactamente cuando empatan
los Pts; igual se aplica primero, como se pidió.

Al terminar el partido 12, el torneo queda **cerrado**: aparece el banner de campeón (o
_"Campeones empatados"_ con todos los primeros puestos) y la tabla final. Un torneo terminado se
puede ver siempre (solo lectura) y ya no tiene **Jugar**.

La tabla **nunca se guarda**: siempre se calcula a partir de los partidos registrados.

## Extras

- **Copiar tabla**: texto listo para WhatsApp, ordenado por puesto:

  ```
  📊 *TABLA*
  Jugador | PJ | PG | Zap | Pts | Avg
  1. Ana (A) | 1 | 1 | 1 | 1.5 | 1.50
  1. Caro (D) | 1 | 1 | 1 | 1.5 | 1.50
  3. Beto (B) | 1 | 0 | 0 | 0 | 0.00
  3. Dani (C) | 1 | 0 | 0 | 0 | 0.00
  Partidos: 1/12
  ```

- **Descargar respaldo**: un JSON con jugadores, calendario y **todos** los partidos (también los
  anulados), con sus horas en UTC. Es un extra: la copia automática diaria a Google Drive sigue
  siendo la protección principal.
- **Historial**: cada partido terminado con sus dos parejas, marcador, marca de zapatero,
  jornada/partido y fecha (en la hora local de quien mira).
- **Actualización en vivo**: cuando se guarda un partido (o se abre/cierra su sala), el servidor
  empuja el estado nuevo a todos los que están mirando ese torneo por su conexión Socket.IO, sin
  consultas periódicas.

## Cómo se guarda (y por qué no se pierde)

- Base **SQLite** (`node:sqlite`) en `DATABASE_PATH`, modo `WAL`, `synchronous=FULL`,
  `foreign_keys=ON`, migraciones versionadas al arrancar (`schema_migrations`). En producción vive
  en el volumen `/opt/domino/data` y sobrevive a `docker compose up -d --build`.
- El resultado se escribe **antes** de mostrar _"Partido guardado"_, en una transacción. Si la
  escritura falla, el servidor lo registra en el log como `CRITICAL`, reintenta con espera creciente
  (1 s, 2 s, 4 s… hasta 30 s, sin límite) y **mantiene viva la sala** hasta lograrlo; mientras tanto
  la pantalla dice _"Guardando el resultado…"_.
- Los registros de partidos son **inmutables**: triggers de SQLite rechazan cualquier `DELETE` y
  cualquier `UPDATE` salvo anular (`voided_at` + `voided_reason`). Un índice único parcial
  `(torneo, jornada, cupo) WHERE voided_at IS NULL` hace que un cupo no se pueda registrar dos veces
  y a la vez permite volver a jugar uno anulado.
- Un reinicio del servidor pierde las **salas en curso** (están en memoria) pero jamás lo ya
  registrado: torneos, identidades, calendarios y resultados sobreviven.
- Copia diaria consistente (`VACUUM INTO`) a `/opt/domino/backups` y a Google Drive; ver
  [DEPLOY.md](DEPLOY.md).

## Correcciones (solo el administrador, en el servidor)

No hay edición desde la aplicación. El script de administración corre dentro del contenedor y deja
cada acción en `admin_audit` (tabla de solo agregar):

```bash
# en el droplet
alias torneo='docker exec domino node server/dist/admin.js'

torneo list                                   # torneos y avance
torneo show <ID>                              # jugadores, calendario y tabla
torneo void-match <ID> <jornada> <cupo> --reason "se anotó mal"
torneo rename-player <ID> <letra> "Nombre nuevo"
torneo delete-tournament <ID>                 # solo si nunca tuvo partidos
torneo audit                                  # últimas acciones
```

En local: `npm run admin -w server -- list` (usa `server/data/domino.db`).

- **Anular** conserva la fila y deja el cupo pendiente otra vez (y reabre el torneo si estaba
  terminado). Hay que dar un motivo. Quienes ya tienen la página abierta ven el cambio al recargar.
- **Renombrar** conserva la letra; el nombre nuevo no puede coincidir con el de otro jugador.
- **Borrar** solo funciona si el torneo nunca tuvo un registro de partido (ni anulado).
