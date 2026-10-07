import { NodeConnectionTypes } from 'n8n-workflow';
import type { INodeType, INodeTypeDescription } from 'n8n-workflow';

/**
 * Declarative (routing-style) node: every operation maps straight onto the
 * REST API, no execute() code and zero runtime dependencies, the shape the
 * n8n verified-community-node programme requires (MIT + no deps + one
 * package per service).
 */
export class IbanForge implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'IBANforge',
    name: 'ibanForge',
    icon: { light: 'file:ibanforge.svg', dark: 'file:ibanforge.svg' },
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description:
      'Validate IBANs and check the bank code against national bank registers, resolve BIC/SWIFT codes, look up Swiss clearing data and run compliance pre-checks',
    defaults: {
      name: 'IBANforge',
    },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [
      {
        name: 'ibanForgeApi',
        required: true,
      },
    ],
    requestDefaults: {
      baseURL: 'https://api.ibanforge.com',
      headers: {
        'Content-Type': 'application/json',
      },
    },
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Validate IBAN',
            value: 'validateIban',
            action: 'Validate IBAN',
            description:
              'Structure + checksum + issuing bank, bank-code check against the national register, SEPA and VoP reachability',
            routing: {
              request: {
                method: 'POST',
                url: '/v1/iban/validate',
                body: {
                  iban: '={{$parameter.iban}}',
                },
              },
            },
          },
          {
            name: 'Look Up BIC',
            value: 'lookupBic',
            action: 'Look up BIC or SWIFT code',
            description: 'Resolve a BIC/SWIFT code into bank name, city, country and LEI',
            routing: {
              request: {
                method: 'GET',
                url: '=/v1/bic/{{$parameter.bic}}',
              },
            },
          },
          {
            name: 'Look Up Swiss Clearing',
            value: 'lookupChClearing',
            action: 'Look up BC number or IID',
            description:
              'Swiss BC-Nummer / IID: institution, seat address, SIC/euroSIC/instant participation, QR-IID semantics',
            routing: {
              request: {
                method: 'GET',
                url: '=/v1/ch/clearing/{{$parameter.iid}}',
              },
            },
          },
          {
            name: 'Compliance Check',
            value: 'complianceCheck',
            action: 'Run compliance check on IBAN',
            description:
              'Bank-level sanctions (OFAC + EU), FATF lists, SEPA/VoP reachability, 0-100 risk score, at bank level and not by name',
            routing: {
              request: {
                method: 'POST',
                url: '/v1/iban/compliance',
                body: {
                  iban: '={{$parameter.iban}}',
                },
              },
            },
          },
        ],
        default: 'validateIban',
      },
      {
        displayName: 'IBAN',
        name: 'iban',
        type: 'string',
        required: true,
        default: '',
        placeholder: 'e.g. DE89370400440532013000',
        description: 'The IBAN to check (spaces are tolerated)',
        displayOptions: {
          show: {
            operation: ['validateIban', 'complianceCheck'],
          },
        },
      },
      {
        displayName: 'BIC / SWIFT Code',
        name: 'bic',
        type: 'string',
        required: true,
        default: '',
        placeholder: 'e.g. COBADEFF',
        description: 'BIC8 or BIC11 to resolve',
        displayOptions: {
          show: {
            operation: ['lookupBic'],
          },
        },
      },
      {
        displayName: 'IID / BC-Nummer',
        name: 'iid',
        type: 'string',
        required: true,
        default: '',
        placeholder: 'e.g. 230',
        description: 'Swiss institution identifier (3-5 digits) or QR-IID (30000-31999)',
        displayOptions: {
          show: {
            operation: ['lookupChClearing'],
          },
        },
      },
    ],
  };
}
