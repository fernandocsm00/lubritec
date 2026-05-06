import { ApiError } from '@/lib/apiClient';

const CODE_MAP: Record<string, string> = {
  EMAIL_SEND_FAILED: 'Servidor de e-mail não configurado. Avise o administrador.',
};

const MESSAGE_MAP: Record<string, string> = {
  'Cannot modify your own role or status': 'Você não pode modificar sua própria conta.',
  'User already activated': 'Esse usuário já completou o cadastro.',
  'Email already in use': 'Já existe um usuário com esse email.',
  'User not found': 'Usuário não encontrado.',
  'Request failed': 'Falha de conexão com o servidor. Tente novamente em instantes.',
};

export function translateError(input: unknown): string {
  if (input instanceof ApiError) {
    const code = (input.body as { code?: string } | undefined)?.code;
    if (code && CODE_MAP[code]) return CODE_MAP[code];
    return MESSAGE_MAP[input.message] ?? input.message;
  }
  if (input instanceof Error) {
    return MESSAGE_MAP[input.message] ?? input.message;
  }
  if (typeof input === 'string') {
    return MESSAGE_MAP[input] ?? input;
  }
  return 'Erro inesperado.';
}
