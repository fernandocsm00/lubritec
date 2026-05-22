import { useState } from 'react';
import { X } from 'lucide-react';
import type { ProviderKind } from '@shared/types';
import { ProviderPickerStep } from './ProviderPickerStep';
import { UazapiSetupStep } from './UazapiSetupStep';
import { MetaCloudSetupStep } from './MetaCloudSetupStep';
import { WebhookInfoStep } from './WebhookInfoStep';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}

type WizardStep =
  | { kind: 'pick' }
  | { kind: 'uazapi' }
  | { kind: 'meta' }
  | { kind: 'webhook-info'; instanceId: string };

export function AddInstanceWizard({ open, onClose, onCreated }: Props) {
  const [step, setStep] = useState<WizardStep>({ kind: 'pick' });

  if (!open) return null;

  const handleSelect = (kind: ProviderKind) => {
    if (kind === 'uazapi') setStep({ kind: 'uazapi' });
    else setStep({ kind: 'meta' });
  };

  const handleClose = () => {
    setStep({ kind: 'pick' });
    onClose();
  };

  const handleUazapiCreated = (id: string) => {
    onCreated(id);
    handleClose();
  };

  const handleMetaCreated = (id: string) => {
    setStep({ kind: 'webhook-info', instanceId: id });
    onCreated(id);
  };

  const titles: Record<WizardStep['kind'], string> = {
    'pick': 'Adicionar número de WhatsApp',
    'uazapi': 'Configurar UazAPI',
    'meta': 'Configurar Meta Cloud API',
    'webhook-info': 'Configurar webhook na Meta',
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <h2 className="text-lg font-semibold">{titles[step.kind]}</h2>
          <button onClick={handleClose} className="p-1 hover:bg-zinc-100 rounded">
            <X size={20} />
          </button>
        </header>
        <main className="p-6">
          {step.kind === 'pick' && <ProviderPickerStep onSelect={handleSelect} />}
          {step.kind === 'uazapi' && (
            <UazapiSetupStep onCreated={handleUazapiCreated} onCancel={() => setStep({ kind: 'pick' })} />
          )}
          {step.kind === 'meta' && (
            <MetaCloudSetupStep onCreated={handleMetaCreated} onCancel={() => setStep({ kind: 'pick' })} />
          )}
          {step.kind === 'webhook-info' && (
            <WebhookInfoStep instanceId={step.instanceId} onDone={handleClose} />
          )}
        </main>
      </div>
    </div>
  );
}
