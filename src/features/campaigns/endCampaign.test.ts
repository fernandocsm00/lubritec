import { describe, it, expect } from 'vitest';
import { canEndCampaign, endCampaignConfirmText, endCampaignResultMessage } from './endCampaign';

describe('canEndCampaign', () => {
  it('só campanha comum com disparo terminado', () => {
    expect(canEndCampaign({ isContinuous: false, status: 'completed' })).toBe(true);
    expect(canEndCampaign({ isContinuous: false, status: 'cancelled' })).toBe(true);
    expect(canEndCampaign({ isContinuous: false, status: 'running' })).toBe(false);
    expect(canEndCampaign({ isContinuous: false, status: 'paused' })).toBe(false);
    expect(canEndCampaign({ isContinuous: true, status: 'completed' })).toBe(false);
  });
});

describe('endCampaignConfirmText', () => {
  it('diz quantos cards vão fechar, no singular e no plural', () => {
    expect(endCampaignConfirmText(12)).toContain('12 cards abertos vão para Perdido');
    expect(endCampaignConfirmText(1)).toContain('1 card aberto vai para Perdido');
    expect(endCampaignConfirmText(12)).toContain('Campanha encerrada');
  });

  it('sem card aberto, avisa que só a vigência termina', () => {
    expect(endCampaignConfirmText(0)).toBe('Nenhum card aberto desta campanha. A vigência termina agora.');
  });
});

describe('endCampaignResultMessage', () => {
  it('resume o que foi fechado', () => {
    expect(endCampaignResultMessage(3)).toBe('Campanha encerrada. 3 cards fechados.');
    expect(endCampaignResultMessage(1)).toBe('Campanha encerrada. 1 card fechado.');
    expect(endCampaignResultMessage(0)).toBe('Campanha encerrada.');
  });
});
