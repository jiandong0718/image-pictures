import { describe, expect, it } from 'vitest'
import { buildApiUrl, normalizeBaseUrl } from './devProxy'

describe('normalizeBaseUrl', () => {
  it('keeps same-origin API paths as same-origin paths', () => {
    expect(normalizeBaseUrl('/api/full-playground-proxy')).toBe('/api/full-playground-proxy')
  })
})

describe('buildApiUrl', () => {
  it('uses the same-origin proxy prefix when API proxy is enabled', () => {
    expect(buildApiUrl('http://api.example.com/v1', 'images/edits', null, true)).toBe(
      '/api-proxy/images/edits',
    )
  })

  it('leaves API versioning to the proxy target when proxying', () => {
    expect(buildApiUrl('http://api.example.com', 'images/generations', null, true)).toBe(
      '/api-proxy/images/generations',
    )
  })

  it('uses a configured proxy prefix when one is available', () => {
    expect(
      buildApiUrl(
        'http://api.example.com/v1',
        'responses',
        {
          enabled: true,
          prefix: '/openai-proxy',
          target: 'http://api.example.com/v1',
          changeOrigin: true,
          secure: false,
        },
        true,
      ),
    ).toBe('/openai-proxy/responses')
  })

  it('uses the configured API URL directly when API proxy is disabled', () => {
    expect(buildApiUrl('http://api.example.com/v1', 'responses', null, false)).toBe(
      'http://api.example.com/v1/responses',
    )
  })

  it('uses same-origin API paths directly without adding v1', () => {
    expect(buildApiUrl('/api/full-playground-proxy', 'images/generations', null, false)).toBe(
      '/api/full-playground-proxy/images/generations',
    )
  })
})
