import { describe, it, expect } from 'vitest';
import { needsAudioConversion, ensureSendableAudio } from '../lib/audioConvert';

describe('needsAudioConversion', () => {
  it('webm e wav precisam converter', () => {
    expect(needsAudioConversion('audio/webm')).toBe(true);
    expect(needsAudioConversion('audio/wav')).toBe(true);
  });
  it('formatos aceitos pela Meta passam direto', () => {
    for (const m of ['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr']) {
      expect(needsAudioConversion(m)).toBe(false);
    }
  });
  it('não-áudio nunca converte', () => {
    expect(needsAudioConversion('image/png')).toBe(false);
    expect(needsAudioConversion('application/pdf')).toBe(false);
  });
});

describe('ensureSendableAudio', () => {
  it('formato aceito passa direto (sem chamar ffmpeg)', async () => {
    const r = await ensureSendableAudio({ path: '/tmp/x.ogg', filename: 'x.ogg', mimetype: 'audio/ogg' });
    expect(r).toEqual({ filename: 'x.ogg', mimetype: 'audio/ogg' });
  });
  it('não-áudio passa direto', async () => {
    const r = await ensureSendableAudio({ path: '/tmp/a.png', filename: 'a.png', mimetype: 'image/png' });
    expect(r).toEqual({ filename: 'a.png', mimetype: 'image/png' });
  });
});
