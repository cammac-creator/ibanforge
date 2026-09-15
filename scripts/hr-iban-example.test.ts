import { describe, expect, it } from 'vitest';
import { reviewEmployeeIban } from './hr-iban-example.js';
const request =
  (data: unknown, status = 200): typeof fetch =>
  async () =>
    new Response(JSON.stringify(data), { status });
describe('recette RH', () => {
  it('lit valid même sur une réponse HTTP 200', async () => {
    expect(await reviewEmployeeIban('exemple', 'cle-fictive', request({ valid: false }))).toEqual({
      status: 'invalid_input',
    });
  });
  it('ne rejette pas un format valide parce que le BIC manque', async () => {
    expect(
      await reviewEmployeeIban('exemple', 'cle-fictive', request({ valid: true, bic: null })),
    ).toEqual({ status: 'format_valid', bic: null, bankCodeStatus: null });
  });
  it.each([401, 402, 429, 503])('ne transforme pas HTTP %i en IBAN invalide', async (status) => {
    expect(await reviewEmployeeIban('exemple', 'cle-fictive', request({}, status))).toEqual({
      status: 'check_unavailable',
      httpStatus: status,
    });
  });
  it('traite un résultat incomplet et une coupure réseau comme des contrôles non réalisés', async () => {
    expect((await reviewEmployeeIban('exemple', 'cle-fictive', request({}))).status).toBe(
      'check_unavailable',
    );
    expect(
      (
        await reviewEmployeeIban('exemple', 'cle-fictive', async () => {
          throw new Error('coupure');
        })
      ).status,
    ).toBe('check_unavailable');
  });
  it('garde la clé dans les en-têtes et l’IBAN dans le corps de la requête', async () => {
    await reviewEmployeeIban('exemple', 'cle-fictive', async (url, options) => {
      expect(url).toBe('https://api.ibanforge.com/v1/iban/validate');
      expect(options?.body).toBe('{"iban":"exemple"}');
      expect(options?.headers).toMatchObject({ Authorization: 'Bearer cle-fictive' });
      return new Response('{"valid":true}');
    });
    await expect(reviewEmployeeIban('exemple', '')).rejects.toThrow('Clé API requise');
  });
});
