# Dominó online

Dominó 2 contra 2 en tiempo real, en el navegador, con salas privadas (por código o enlace) y
**chat de voz siempre abierto** entre los cuatro jugadores. Funciona en el teléfono (en horizontal)
y en el computador. Sin cuentas, sin base de datos.

- `shared/` — motor del juego puro en TypeScript (reglas, sorteo, jugadas, tranque, puntaje). RNG
  inyectable para tests deterministas.
- `server/` — Node + Socket.IO. Servidor autoritativo (el cliente solo manda intenciones) y
  relevo de señalización WebRTC. Las salas viven en memoria.
- `web/` — React + Vite. Voz WebRTC en malla (máx. 6 conexiones).

## Reglas de la casa

Son las reglas de Julio, **no** las "estándar":

- Juego doble seis (28 fichas), parejas sentadas frente a frente. El turno gira **a la derecha**.
- **Sorteo para salir**: cada uno levanta una ficha boca abajo. Gana la mayor **suma**; si empatan,
  la que tenga el **lado más alto** (6-1 le gana a 5-2). En modo _Sortear_, las dos fichas más
  altas forman pareja; en modo _Elegir asientos_ el sorteo solo decide quién sale. Hay sorteo al
  empezar cada partida, también en la revancha.
- Se reparten las 28 fichas (7 cada uno); nadie roba.
- Quien sale puede tirar **cualquier ficha** (no hace falta el doble seis).
- En cada mano nueva sale el jugador **a la derecha** del que salió en la anterior (no el ganador).
- **Pasar es manual**: el botón "Pasar" solo se activa cuando no tienes jugada.
- No se resaltan las fichas jugables. Si intentas una ficha que no va, tiembla y vuelve a la mano.
- **Dominó**: la pareja del que se queda sin fichas gana y suma los puntos de las fichas de **los
  dos rivales**.
- **Tranque** (nadie puede jugar; se detecta solo): se suman las fichas de cada pareja y gana la
  pareja con **menos** puntos, que se anota lo de los rivales. Si las parejas empatan, la mano
  queda **0–0** y se sigue con la siguiente.
- Gana la partida la primera pareja en llegar a la meta: **100**, 150 o 200.

## Correr en local

Requisitos: Node 24 (ver `.nvmrc`).

```bash
nvm use
npm install
npm run dev
```

Abre <http://localhost:5173>. El servidor corre en el puerto 3001 y Vite le hace de proxy a
Socket.IO.

| Comando             | Qué hace                                           |
| ------------------- | -------------------------------------------------- |
| `npm test`          | Tests (motor, sala, integración Socket.IO, layout) |
| `npm run lint`      | ESLint + Prettier                                  |
| `npm run typecheck` | TypeScript estricto en los 3 paquetes              |
| `npm run build`     | Build del web y bundle del servidor                |
| `npm start`         | Producción: un solo puerto sirve web + Socket.IO   |
| `npm run e2e`       | Partida completa con 4 navegadores (ver abajo)     |

Variables de entorno del servidor (ver `.env.example`): `PORT`, `ICE_SERVERS` (JSON con
servidores STUN/TURN; por defecto solo el STUN público de Google) y, opcionalmente, `TURN_URLS` +
`TURN_SECRET` para un coturn con credenciales temporales. `PAUSE_MS` cambia la espera por
desconexión (2 minutos por defecto; solo para pruebas).

## Probar con 4 jugadores

Cada jugador necesita su propio **perfil de navegador**: las pestañas de un mismo perfil
comparten `localStorage` y se quitarían el puesto entre ellas. Usa por ejemplo una ventana normal,
una de incógnito, otro navegador y el teléfono, o perfiles distintos de Chrome.

1. En la primera ventana: escribe tu nombre → **Crear sala** → **Copiar enlace**.
2. Abre el enlace en las otras tres y pon un nombre en cada una.
3. El anfitrión elige meta y modo de parejas y pulsa **Empezar**.

Prueba automática (Playwright con el micrófono falso de Chrome; usa el Google Chrome instalado):

```bash
npm run dev               # en una terminal
npm run e2e               # en otra; capturas en e2e-artifacts/
E2E_PAUSE=1 npm run e2e   # incluye las pausas reales de 2 minutos y el reemplazo
```

## Probar desde el teléfono (misma Wi-Fi)

El micrófono solo funciona en un **contexto seguro**: `localhost` sirve, pero una IP de la red
local (`http://192.168.x.x:5173`) **no**. Para eso hay un modo HTTPS de desarrollo con un
certificado autofirmado:

```bash
npm run dev:https
```

Vite muestra la dirección de red (por ejemplo `https://192.168.1.14:5173`). Ábrela en el teléfono,
acepta la advertencia del certificado ("Avanzado → continuar") y entra a la sala. Sin HTTPS igual
puedes jugar y escuchar, pero no hablar.

## Producción

Ver [docs/DEPLOY.md](docs/DEPLOY.md): una imagen Docker pequeña (un proceso Node que sirve el web
y Socket.IO en un solo puerto) detrás de Caddy.
