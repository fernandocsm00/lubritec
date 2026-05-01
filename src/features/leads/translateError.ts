const MAP: Record<string, string> = {
  'Phone already in use': 'Telefone já cadastrado.',
  'Phone cannot be edited': 'Telefone não pode ser alterado.',
  'Phone must have at least 8 digits': 'Telefone precisa ter pelo menos 8 dígitos.',
  'Lead not found': 'Lead não encontrado.',
  'File too large': 'Arquivo maior que 5MB.',
  'Invalid file type': 'Tipo de arquivo inválido. Envie .csv.',
  'Validation error': 'Dados inválidos. Confira os campos.',
};

export function translateError(msg: string): string {
  if (msg.startsWith('Missing required column')) {
    return `Coluna obrigatória ausente no CSV: ${msg.split(': ')[1]}.`;
  }
  return MAP[msg] ?? msg;
}
