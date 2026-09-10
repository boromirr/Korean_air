import { describe, expect, it } from 'vitest';
import { parseSasRow as parse } from '../src/sas/parser.js';
const row = '06:55 - 08:10\nDirect, 1h 15m\nAMS\nCDG\nOperated by TEST (AMS-CDG)\neconomy\n24,000 p\nbusiness\n48,000 p';
describe('SAS visible award cards',()=>{
  it('keeps fares separate from unknown seat counts',()=>{
    const result=parse(row);
    expect(result.fares).toEqual([{cabin:'economy',points:24000,availableSeatCount:null},{cabin:'business',points:48000,availableSeatCount:null}]);
    expect(result.departureTime).toBe('06:55');
  });
  it('does not turn unavailable business into an available fare',()=>{
    expect(parse(row.replace('business\n48,000 p','Not available')).fares).toHaveLength(1);
  });
  it('rejects price-format changes instead of silently losing inventory',()=>{
    expect(()=>parse(row.replace('48,000 p','£48,000'))).toThrow('UNRECOGNIZED_RESULT');
    expect(()=>parse('Loading your flights')).toThrow('UNRECOGNIZED_RESULT');
  });
});
