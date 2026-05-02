interface Props {
  qrCode: string;
}

export function QrDisplay({ qrCode }: Props) {
  // qrCode pode vir como "data:image/png;base64,..." ou só base64 puro.
  const src = qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`;
  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <div className="rounded-lg border-2 border-border p-3 bg-white">
        <img src={src} alt="QR Code WhatsApp" className="w-64 h-64" />
      </div>
      <div className="text-center max-w-md">
        <h3 className="text-sm font-semibold mb-2">Escaneie no WhatsApp do celular</h3>
        <ol className="text-xs text-muted-foreground space-y-1 text-left list-decimal list-inside">
          <li>Abra o WhatsApp no seu celular</li>
          <li>Toque em <strong>Configurações &gt; Aparelhos conectados</strong></li>
          <li>Toque em <strong>Conectar um aparelho</strong></li>
          <li>Aponte a câmera pra esse QR</li>
        </ol>
        <p className="text-[11px] text-muted-foreground mt-3">
          QR atualiza automaticamente. Não feche essa tela durante o pareamento.
        </p>
      </div>
    </div>
  );
}
