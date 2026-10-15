import { setChatOpen, useFun } from '../../net/fun';
import { ChatIcon } from '../../ui/icons';

export function ChatButton() {
  const { open, unread } = useFun();
  return (
    <button
      type="button"
      className={`icon-btn compact chat-btn ${open ? 'is-on' : ''}`}
      onClick={() => setChatOpen(!open)}
      aria-label={unread ? `Chat (${unread} sin leer)` : 'Chat'}
      title="Chat"
    >
      <ChatIcon size={18} />
      {unread > 0 && <span className="chat-badge">{unread > 9 ? '9+' : unread}</span>}
    </button>
  );
}
