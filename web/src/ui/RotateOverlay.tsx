import { ExpandIcon, RotatePhoneIcon } from './icons';
import { canFullscreen, enterFullscreen, isTouch } from './landscape';

/** Shown in portrait during the game (CSS decides when). */
export function RotateOverlay() {
  return (
    <div className="rotate-overlay" role="alert">
      <div className="rotate-icon">
        <RotatePhoneIcon size={88} />
      </div>
      <h2>Gira tu teléfono</h2>
      <p>La mesa se juega en horizontal.</p>
      {isTouch() && canFullscreen() && (
        <button type="button" className="btn secondary" onClick={() => void enterFullscreen()}>
          <ExpandIcon size={18} /> Pantalla completa
        </button>
      )}
    </div>
  );
}
