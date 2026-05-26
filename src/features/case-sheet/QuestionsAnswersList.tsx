import type { QuestionAnswer } from '@shared/types';

interface Props { items: QuestionAnswer[] }

export function QuestionsAnswersList({ items }: Props) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum par pergunta→resposta registrado.</p>;
  }
  return (
    <ol className="space-y-3">
      {items.map((qa, i) => (
        <li key={i} className="border-l-2 border-muted pl-3">
          <p className="text-xs text-muted-foreground">Pergunta da IA:</p>
          <p className="font-medium text-sm">{qa.question}</p>
          <p className="text-xs text-muted-foreground mt-1">Resposta do lead:</p>
          <p className="text-sm">{qa.answer}</p>
        </li>
      ))}
    </ol>
  );
}
