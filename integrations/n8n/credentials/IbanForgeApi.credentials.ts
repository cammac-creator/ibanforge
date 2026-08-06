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
      description:
        'Free key: 200 requests/month, no card — POST your email to https://api.ibanforge.com/v1/keys/generate or use the dialog at https://ibanforge.com?src=n8n',
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
