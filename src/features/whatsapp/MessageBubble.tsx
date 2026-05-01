import type { PublicMessage } from './types';

export function MessageBubble({ msg }: { msg: PublicMessage }) {
  const isOut = msg.direction === 'out';
  const time = new Date(msg.sentAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'} mb-1`}>
      <div
        className={`max-w-[65%] px-3 py-1.5 shadow-sm ${
          isOut
            ? 'bg-emerald-900/40 rounded-lg rounded-tr-none'
            : 'bg-card border border-border/40 rounded-lg rounded-tl-none'
        }`}
      >
        {msg.kind === 'image' && msg.mediaUrl && (
          <img
            src={msg.mediaUrl}
            alt="imagem"
            className="rounded mb-1 max-w-full max-h-64 object-cover"
          />
        )}
        {msg.kind === 'audio' && msg.mediaUrl && (
          <audio controls src={msg.mediaUrl} className="mb-1 max-w-full" />
        )}
        {msg.kind === 'video' && msg.mediaUrl && (
          <video controls src={msg.mediaUrl} className="rounded mb-1 max-w-full max-h-64" />
        )}
        {msg.kind === 'document' && msg.mediaUrl && (
          <a
            href={msg.mediaUrl}
            target="_blank"
            rel="noreferrer"
            className="block text-xs underline mb-1"
          >
            Abrir documento
          </a>
        )}
        {msg.body && <p className="text-sm whitespace-pre-wrap break-words leading-snug">{msg.body}</p>}
        <div className="text-[10px] text-muted-foreground/80 text-right mt-0.5">
          {time}
          {isOut && <span className="ml-1 text-sky-400">✓✓</span>}
        </div>
      </div>
    </div>
  );
}
