const MAP: Record<string, string> = {
  'CNPJ já cadastrado': 'CNPJ já cadastrado.',
  'CNPJ inválido': 'CNPJ inválido (dígitos verificadores não conferem).',
  'CNPJ cannot be edited': 'CNPJ não pode ser alterado.',
  'Phone cannot be edited': 'Telefone não pode ser alterado.',
  'Phone must have at least 8 digits': 'Telefone precisa ter pelo menos 8 dígitos.',
  'Lead not found': 'Lead não encontrado.',
  'File too large': 'Arquivo maior que 5MB.',
  'Invalid file type': 'Tipo de arquivo inválido. Envie .csv.',
  'Validation error': 'Dados inválidos. Confira os campos.',
};

export function translateError(msg: string): string {
  if (msg.startsWith('Coluna obrigatória ausente')) return msg;
  if (msg.startsWith('Importação limitada')) return msg;
  return MAP[msg] ?? msg;
}
