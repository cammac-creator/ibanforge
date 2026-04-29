'use client';

import { ApiReferenceReact } from '@scalar/api-reference-react';
import '@scalar/api-reference-react/style.css';

export function ApiReferenceClient() {
  return (
    <ApiReferenceReact
      configuration={{
        url: 'https://api.ibanforge.com/openapi.json',
        theme: 'default',
        darkMode: true,
        hideClientButton: false,
        hideTestRequestButton: false,
        hideDownloadButton: false,
        layout: 'modern',
        defaultHttpClient: {
          targetKey: 'shell',
          clientKey: 'curl',
        },
        metaData: {
          title: 'IBANforge API Reference',
          description: 'IBAN validation, BIC lookup, Swiss BC-Nummer, compliance — REST API for AI agents and developers.',
        },
      }}
    />
  );
}
