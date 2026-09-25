import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

export class IbanForgeApi implements ICredentialType {
  name = 'ibanForgeApi';

  displayName = 'IBANforge API';

  documentationUrl = 'https://ibanforge.com/docs/api-keys?src=n8n';

  properties: INodeProperties[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      // 24/09/2026 : l'ancien texte n'offrait que la clé avec adresse (« POST
      // your email »). La clé sans e-mail passe en premier ; `source: n8n`
      // garde l'attribution de la porte d'entrée (src/lib/key-origins.ts).
      description:
        'A key that needs no e-mail and no card: POST https://api.ibanforge.com/v1/keys/generate with {"source":"n8n"} returns an ifk_ key worth 25 requests a month, raised to 200 a month once claimed at /v1/keys/claim. Or use the dialog at https://ibanforge.com?src=n8n',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{$credentials.apiKey}}',
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: 'https://api.ibanforge.com',
      url: '/v1/demo',
      method: 'GET',
    },
  };
}
