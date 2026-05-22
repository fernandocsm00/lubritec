import { useState } from 'react';
import { X } from 'lucide-react';
import type { ProviderKind } from '@shared/types';
import { ProviderPickerStep } from './ProviderPickerStep';
import { UazapiSetupStep } from './UazapiSetupStep';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}

export function AddInstanceWizard({ open, onClose, onCreated }: Props) {
  const [step, setStep] = useState<'pick' | 'uazapi'>('pick');

  if (!open) return null;

  const handleSelect = (kind: ProviderKind) => {
    if (kind === 'uazapi') setStep('uazapi');
    // meta_cloud is disabled in Plan A
  };

  const reset = () => {
    setStep('pick');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <h2 className="text-lg font-semibold">
            {step === 'pick' ? 'Adicionar número de WhatsApp' : 'Configurar UazAPI'}
          </h2>
          <button onClick={reset} className="p-1 hover:bg-zinc-100 rounded">
            <X size={20} />
          </button>
        </header>
        <main className="p-6">
          {step === 'pick' && <ProviderPickerStep onSelect={handleSelect} />}
          {step === 'uazapi' && (
            <UazapiSetupStep
              onCreated={(id) => {
                onCreated(id);
                reset();
              }}
              onCancel={() => setStep('pick')}
            />
          )}
        </main>
      </div>
    </div>
  );
}
