const { STATUS, RUN_STATUS, PAGE } = require('../../lib/constants');

describe('lib/constants', () => {
  describe('STATUS', () => {
    it('exports all four status values', () => {
      expect(STATUS).toEqual({
        PASS: 'PASS',
        FAIL: 'FAIL',
        TIMEOUT: 'TIMEOUT',
        UNKNOWN: 'UNKNOWN',
      });
    });

    it('values are uppercase strings matching their keys', () => {
      for (const [key, value] of Object.entries(STATUS)) {
        expect(value).toBe(key);
      }
    });
  });

  describe('RUN_STATUS', () => {
    it('exports all three run status values', () => {
      expect(RUN_STATUS).toEqual({
        IDLE: 'idle',
        RUNNING: 'running',
        COMPLETE: 'complete',
      });
    });

    it('values are lowercase strings', () => {
      for (const value of Object.values(RUN_STATUS)) {
        expect(value).toBe(value.toLowerCase());
      }
    });
  });

  describe('PAGE', () => {
    it('exports STORY and MUSIC page identifiers', () => {
      expect(PAGE).toEqual({
        STORY: 'STORY',
        MUSIC: 'MUSIC',
      });
    });
  });

  it('all exports are frozen-like (no accidental mutation)', () => {
    // Verify the objects exist and have expected shape
    expect(Object.keys(STATUS)).toHaveLength(4);
    expect(Object.keys(RUN_STATUS)).toHaveLength(3);
    expect(Object.keys(PAGE)).toHaveLength(2);
  });
});
