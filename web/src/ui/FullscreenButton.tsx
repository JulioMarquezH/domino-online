import { useEffect, useRef, useState } from 'react';
import { ExpandIcon } from './icons';
import {
  canFullscreen,
  enterFullscreen,
  isIOS,
  isStandalone,
  isTouch,
  useIsFullscreen,
} from './landscape';

/**
 * Phones only. Android: goes fullscreen. iPhone (no Fullscreen API in Safari): explains how to
 * add the game to the home screen, which opens it without any browser bars.
 */
export function FullscreenButton() {
  const full = useIsFullscreen();
  const [help, setHelp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!help) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setHelp(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [help]);

  if (!isTouch() || isStandalone() || full) return null;
  const native = canFullscreen();
  return (
    <div className="fs-wrap" ref={ref}>
      <button
        type="button"
        className="icon-btn compact fs-btn"
        onClick={() => (native ? void enterFullscreen() : setHelp((h) => !h))}
        aria-label="Pantalla completa"
        title="Pantalla completa"
      >
        <ExpandIcon size={18} />
      </button>
      {help && (
        <div className="voice-pop fs-help" role="dialog" aria-label="Pantalla completa">
          <InstallSteps />
        </div>
      )}
    </div>
  );
}

export function InstallSteps() {
  return isIOS() ? (
    <>
      <p>
        En iPhone, Safari no deja ocultar sus barras. Toca <strong>Compartir</strong> →{' '}
        <strong>Agregar a inicio</strong> y abre Dominó desde ese ícono: se juega a pantalla
        completa.
      </p>
      <p>
        Si prefieres seguir en Safari: <strong>Ajustes → Apps → Safari</strong> y desactiva la{' '}
        <strong>barra de pestañas en horizontal</strong> para ganar espacio.
      </p>
    </>
  ) : (
    <p>
      Abre el menú del navegador → <strong>Agregar a la pantalla principal</strong> y entra desde
      ese ícono para jugar sin barras.
    </p>
  );
}
