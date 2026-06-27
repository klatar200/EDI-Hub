import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preferredLanOrigin } from '@edi/shared';
import { buildApplicationMenuTemplate } from '../src/menu.js';

test('preferredLanOrigin prefers non-localhost address', () => {
  assert.equal(
    preferredLanOrigin(['http://127.0.0.1:3000', 'http://192.168.1.50:3000']),
    'http://192.168.1.50:3000',
  );
});

test('help menu includes Whats New and Copy LAN URL', () => {
  const template = buildApplicationMenuTemplate();
  const help = template.find((item) => item.label === 'Help');
  assert.ok(help && Array.isArray(help.submenu));
  const labels = (help.submenu as Array<{ label?: string }>).map((i) => i.label);
  assert.ok(labels.includes("What's New"));
  assert.ok(labels.includes('Copy LAN URL'));
});
