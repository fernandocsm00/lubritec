import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Smile } from 'lucide-react';

const EMOJIS = [
  '😀','😅','😉','😊','😍','🥰','😎','🤔','🙏','👍','👎','👌','💪','🙌','👏','🔥',
  '❤️','✨','🎉','✅','❌','⚠️','📞','📱','🚗','🛢️','🛠️','💰','🕒','📅','📍','💬',
];

interface Props { onPick: (emoji: string) => void }

export function EmojiPicker({ onPick }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setOpen((v) => !v)}
        title="Emoji"
      >
        <Smile className="h-5 w-5" />
      </Button>
      {open && (
        <div
          className="absolute bottom-12 left-0 w-max bg-popover border border-border rounded-md shadow-lg p-2 grid grid-cols-8 gap-1 z-10"
          onMouseLeave={() => setOpen(false)}
        >
          {EMOJIS.map((e) => (
            <button
              key={e}
              className="hover:bg-muted rounded p-1 text-xl"
              onClick={() => { onPick(e); setOpen(false); }}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
