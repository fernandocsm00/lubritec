import { ApiError } from '@/lib/apiClient';

const CODE_MAP: Record<string, string> = {
  EMAIL_SEND_FAILED: 'Servidor de e-mail não configurado. Avise o administrador.',
};

const MESSAGE_MAP: Record<string, string> = {
  'Cannot modify your own role or status': 'Você não pode modificar sua própria conta.',
  'User already activated': 'Esse usuário já completou o cadastro.',
  'Email already in use': 'Já existe um usuário com esse email.',
  'User not found': 'Usuário não encontrado.',
};

// 'Request failed' vem do apiClient com o status junto ("Request failed (HTTP 502)")
// quando a resposta não é JSON. Mantém o status visível pra não perder o
// diagnóstico, mas com texto legível na frente.
function translateMessage(message: string): string {
  if (MESSAGE_MAP[message]) return MESSAGE_MAP[message];
  if (message.startsWith('Request failed')) {
    const status = message.match(/HTTP (\d{3})/)?.[1];
    return `Falha de conexão com o servidor${status ? ` (HTTP ${status})` : ''}. Tente novamente em instantes.`;
  }
  return message;
}

export function translateError(input: unknown): string {
  if (input instanceof ApiError) {
    const code = (input.body as { code?: string } | undefined)?.code;
    if (code && CODE_MAP[code]) return CODE_MAP[code];
    return translateMessage(input.message);
  }
  if (input instanceof Error) {
    return translateMessage(input.message);
  }
  if (typeof input === 'string') {
    return translateMessage(input);
  }
  return 'Erro inesperado.';
}
