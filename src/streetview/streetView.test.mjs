import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  kartaViewUrl,
  googleStreetViewUrl,
  formatLatLng,
} from './streetView.js';

test('kartaViewUrl builds the embed URL', () => {
  const url = kartaViewUrl(29.7604, -95.3698);
  assert.equal(url, 'https://kartaview.org/map/@29.760400,-95.369800,18z');
});

test('googleStreetViewUrl builds the universal pano URL (no key)', () => {
  const url = googleStreetViewUrl(29.7604, -95.3698);
  assert.equal(
    url,
    'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=29.760400,-95.369800',
  );
  assert.doesNotMatch(url, /key=/);
});

test('formatLatLng renders compass labels', () => {
  assert.equal(formatLatLng(29.7604, -95.3698), '29.7604° N, 95.3698° W');
  assert.equal(formatLatLng(-33.8688, 151.2093), '33.8688° S, 151.2093° E');
});
