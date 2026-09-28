-- Migration 048: motivo de perda "campanha_encerrada".
--
-- Card de campanha que encerra (fim da vigência ou botão "Encerrar campanha")
-- vira perdido com este motivo, gravado pelo sistema. Separado de "sem_retorno"
-- de propósito: é o fim da janela comercial, não uma avaliação de vendedor.
--
-- Arquivo próprio porque o runner envolve cada migration numa transação, e um
-- valor novo de enum não pode ser usado na mesma transação em que nasce.

ALTER TYPE loss_reason ADD VALUE IF NOT EXISTS 'campanha_encerrada';
