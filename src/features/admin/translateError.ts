const MAP: Record<string, string> = {
  'Cannot modify your own role or status': 'Você não pode modificar sua própria conta.',
  'User already activated': 'Esse usuário já completou o cadastro.',
  'Email already in use': 'Já existe um usuário com esse email.',
  'User not found': 'Usuário não encontrado.',
};

export function translateError(message: string): string {
  return MAP[message] ?? message;
}
