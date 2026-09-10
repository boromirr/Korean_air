import { expect, it } from 'vitest';
import { sasRestriction } from '../src/sas/status.js';
it('recognizes the actual denied boarding screen instead of asking for login',()=>{
 expect(sasRestriction('YOU ARE NOT ALLOWED TO BOARD\nAccess Restricted\nYour request has been blocked by our security system')).toBe('restricted');
 expect(sasRestriction('Please verify you are human')).toBe('action_required');
 expect(sasRestriction('Log in to use EuroBonus points')).toBe(null);
 expect(sasRestriction('We could not find any flights')).toBe(null);
});
