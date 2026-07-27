-- Migration 036: URL da imagem de header dos templates HSM.
--
-- Templates com header de mídia (imagem) precisam de DUAS referências à mídia:
--   1. example.header_handle (dentro de `components`) — amostra que a Meta usa
--      para APROVAR o template (gerado via Resumable Upload API).
--   2. header_media_url — URL pública persistente (Supabase Storage) usada no
--      DISPARO, passada ao WhatsApp como link do header. Fica fora de `components`
--      porque a Meta não aceita esse campo no payload de criação do template.
--
-- Opcional: só templates com header de imagem preenchem.

ALTER TABLE whatsapp_hsm_templates
  ADD COLUMN header_media_url TEXT;
